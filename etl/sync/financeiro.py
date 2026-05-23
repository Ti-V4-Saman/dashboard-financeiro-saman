"""
etl/sync/financeiro.py
Sincroniza lançamentos financeiros:
  - /v1/contas-receber                           → ca.contas_receber
  - /v1/contas-pagar                             → ca.contas_pagar
  - /v1/vendas                                   → ca.vendas
  - /v1/financeiro/eventos-financeiros/parcelas  → ca.parcelas_receber + ca.parcelas_pagar
  - /v1/financeiro/transferencias                → ca.transferencias
  - /v1/financeiro/baixas                        → ca.baixas
  - /v1/venda/{id}/itens                         → ca.itens_venda
  - /v1/nota-fiscal                              → ca.notas_fiscais
"""

import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import psycopg2.extensions

from etl.client import ContaAzulClient
from etl.db import log_sync_end, log_sync_start, upsert, ensure_connection

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_sync_params(mode: str = "incremental", style: str = "finance") -> Dict[str, str]:
    """
    Constrói filtros de data para chamadas à API do Conta Azul.

    ESTRATÉGIA (refatorada em 22/mai/2026 — fix definitivo Bug #1):

      • Filtros de DATA DE VENCIMENTO (contas-a-receber/pagar) ou DATA DA
        VENDA (vendas) são OBRIGATÓRIOS pela API. Passamos range AMPLO
        (2000-01-01 a 2099-12-31) para não excluir nada por essas chaves.

      • Em modo INCREMENTAL: adicionamos data_alteracao_de/ate
        (últimos 30 dias em ISO 8601 GMT-3) — esse é o filtro que de fato
        define o que entra no sync. Captura QUALQUER mudança recente:
        - vendas novas
        - alterações de vencimento, valor, categoria
        - baixas (pagamentos), incluindo retroativos e antecipados
        - cancelamentos, renegociações

      • Em modo FULL: sem filtro de data_alteracao — varre tudo.

    Documentado em docs/conta-azul-api-guia.md §1.2:
      "data_vencimento_de/ate são obrigatórios. Use range amplo (2000-01-01
       a 2099-12-31) quando o foco for outra data."
    """
    today = date.today()

    # Range amplo para os filtros obrigatórios (vencimento ou data da venda)
    wide_start = "2000-01-01"
    wide_end   = "2099-12-31"

    params: Dict[str, str] = {}

    if style == "sales":
        params["data_inicio"] = wide_start
        params["data_fim"]    = wide_end
    else:
        params["data_vencimento_de"]  = wide_start
        params["data_vencimento_ate"] = wide_end

    # Em incremental, adiciona janela de 30 dias por data_alteracao —
    # capturar TUDO que mudou (criado, editado, pago, cancelado, etc).
    if mode != "full":
        # Formato ISO 8601 SEM timezone, em horário GMT-3 (horário oficial CA).
        # A API rejeita offset (-0300 ou -03:00) — exige formato naive como
        # "2025-10-20T07:59:59". Convertemos UTC → GMT-3 e strippamos o tzinfo.
        gmt3      = timezone(timedelta(hours=-3))
        alt_ate   = datetime.now(timezone.utc).astimezone(gmt3).replace(tzinfo=None)
        alt_de    = alt_ate - timedelta(days=30)
        params["data_alteracao_de"]  = alt_de.strftime("%Y-%m-%dT%H:%M:%S")
        params["data_alteracao_ate"] = alt_ate.strftime("%Y-%m-%dT%H:%M:%S")

    return params


def _get_date_chunks(start_date_str: str, end_date_str: str, max_days: int = 360):
    """Divide um intervalo de datas em pedaços de no máximo 'max_days'."""
    try:
        start = datetime.strptime(start_date_str, "%Y-%m-%d").date()
        end = datetime.strptime(end_date_str, "%Y-%m-%d").date()
    except Exception:
        # Fallback se a data vier em formato datetime
        if " " in start_date_str:
            start_date_str = start_date_str.split(" ")[0]
        if " " in end_date_str:
            end_date_str = end_date_str.split(" ")[0]
        start = datetime.strptime(start_date_str, "%Y-%m-%d").date()
        end = datetime.strptime(end_date_str, "%Y-%m-%d").date()
    
    current = start
    while current < end:
        chunk_end = min(current + timedelta(days=max_days), end)
        yield current.strftime("%Y-%m-%d"), chunk_end.strftime("%Y-%m-%d")
        current = chunk_end + timedelta(days=1)


def _str(v: Any) -> str:
    return str(v) if v is not None else ""

def _float(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0

def _int(v: Any) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0

def _id(obj: Any) -> Optional[str]:
    if isinstance(obj, dict):
        v = obj.get("id") or obj.get("uuid")
    else:
        v = obj
    return _str(v) or None

def _map_status(s: Any) -> str:
    s = str(s).upper() if s else ""
    mapping = {
        "PAID":           "Quitado",
        "ACQUITTED":      "Quitado",
        "OPEN":           "Aberto",
        "PENDING":        "Aberto",
        "OVERDUE":        "Atrasado",
        "PARTIAL":        "Parcial",
        "PARTIALLY_PAID": "Parcial",
        "CANCELLED":      "Cancelado",
        "LOST":           "Cancelado",
        "VENCIDO":        "Atrasado",
        "QUITADO":        "Quitado",
        "ABERTO":         "Aberto",
    }
    return mapping.get(s, s)


# ── Mapeadores ────────────────────────────────────────────────────────────────

def _map_conta_receber(raw: Dict[str, Any]) -> Dict[str, Any]:
    total    = _float(raw.get("total") or 0)
    pago     = _float(raw.get("pago") or 0)
    nao_pago = _float(raw.get("nao_pago") or (total - pago))

    cats    = raw.get("categorias") or []
    cat_id  = cats[0].get("id") if (isinstance(cats, list) and cats) else None

    ccs   = raw.get("centros_de_custo") or []
    cc_id = ccs[0].get("id") if (isinstance(ccs, list) and ccs) else None

    cliente   = raw.get("cliente") or {}
    pessoa_id = cliente.get("id")

    rateio_raw = raw.get("rateio") or raw.get("ratios") or None
    rateio     = json.dumps(rateio_raw) if rateio_raw else None

    return {
        "id":                  _str(raw.get("id")),
        "descricao":           _str(raw.get("descricao")),
        "data_vencimento":     _str(raw.get("data_vencimento")) or None,
        "data_competencia":    _str(raw.get("data_competencia")) or None,
        "status":              _map_status(raw.get("status")),
        "total":               total,
        "valor_pago":          pago,
        "valor_aberto":        nao_pago,
        "pessoa_id":           _str(pessoa_id) or None,
        "categoria_id":        _str(cat_id) or None,
        "centro_custo_id":     _str(cc_id) or None,
        "conta_financeira_id": _id(raw.get("conta_financeira")),
        "numero_documento":    _str(raw.get("numero_documento") or ""),
        "observacao":          _str(raw.get("observacao") or ""),
        # NÃO mapeamos id_venda: a API /contas-a-receber/buscar não retorna
        # esse campo, mapper sempre voltaria None, e o upsert sobrescreveria
        # o valor já preenchido pelo pós-processamento (pos_processamento.py
        # UPDATE 3 — cruza cr.descricao com ca.vendas.numero). Deixamos a
        # coluna fora do dict para o upsert preservar o valor existente.
        "data_recebimento":    _str(raw.get("data_recebimento") or raw.get("data_pagamento") or "") or None,
        # API CA retorna `data_alteracao` (doc §1.4). Populamos a coluna
        # `data_atualizacao` do nosso schema para o filtro incremental.
        "data_atualizacao":    _str(raw.get("data_alteracao") or raw.get("data_atualizacao") or raw.get("updated_at") or "") or None,
        "data_criacao":        _str(raw.get("data_criacao") or raw.get("created_at") or "") or None,
        "rateio":              rateio,
        "synced_at":           datetime.now(timezone.utc),
    }


def _map_conta_pagar(raw: Dict[str, Any]) -> Dict[str, Any]:
    total    = _float(raw.get("total") or 0)
    pago     = _float(raw.get("pago") or 0)
    nao_pago = _float(raw.get("nao_pago") or (total - pago))

    cats   = raw.get("categorias") or []
    cat_id = cats[0].get("id") if (isinstance(cats, list) and cats) else None

    ccs   = raw.get("centros_de_custo") or []
    cc_id = ccs[0].get("id") if (isinstance(ccs, list) and ccs) else None

    fornecedor = raw.get("fornecedor") or {}
    pessoa_id  = fornecedor.get("id")

    rateio_raw = raw.get("rateio") or raw.get("ratios") or None
    rateio     = json.dumps(rateio_raw) if rateio_raw else None

    return {
        "id":                  _str(raw.get("id")),
        "descricao":           _str(raw.get("descricao")),
        "data_vencimento":     _str(raw.get("data_vencimento")) or None,
        "data_competencia":    _str(raw.get("data_competencia")) or None,
        "status":              _map_status(raw.get("status")),
        "total":               total,
        "valor_pago":          pago,
        "valor_aberto":        nao_pago,
        "pessoa_id":           _str(pessoa_id) or None,
        "categoria_id":        _str(cat_id) or None,
        "centro_custo_id":     _str(cc_id) or None,
        "conta_financeira_id": _id(raw.get("conta_financeira")),
        "numero_documento":    _str(raw.get("numero_documento") or ""),
        "observacao":          _str(raw.get("observacao") or ""),
        "data_pagamento":      _str(raw.get("data_pagamento") or "") or None,
        # API CA retorna `data_alteracao` (doc §1.4). Populamos `data_atualizacao`.
        "data_atualizacao":    _str(raw.get("data_alteracao") or raw.get("data_atualizacao") or raw.get("updated_at") or "") or None,
        "data_criacao":        _str(raw.get("data_criacao") or raw.get("created_at") or "") or None,
        "rateio":              rateio,
        "synced_at":           datetime.now(timezone.utc),
    }


def _map_venda(raw: Dict[str, Any]) -> Dict[str, Any]:
    situacao = raw.get("situacao") or raw.get("status") or ""
    if isinstance(situacao, dict):
        status_final = situacao.get("nome") or situacao.get("descricao") or ""
    else:
        status_final = _map_status(situacao)

    nat_op = raw.get("natureza_operacao") or raw.get("nature_operation") or {}
    comp_val = raw.get("composicao_valor") or raw.get("value_composition") or {}

    contrato = raw.get("contrato") or raw.get("contract") or {}

    return {
        "id":                 _str(raw.get("id") or raw.get("uuid")),
        "numero":             _int(raw.get("numero") or raw.get("number") or 0),
        "status":             _str(status_final),
        "tipo":               _str(raw.get("tipo") or raw.get("type") or "VENDA"),
        "data_emissao":       _str(raw.get("data") or raw.get("data_emissao") or raw.get("emissionDate")) or None,
        "data_entrega":       _str(raw.get("data_entrega") or raw.get("scheduledDate")) or None,
        "cliente_id":         _id(raw.get("cliente") or raw.get("customer")),
        "vendedor_id":        _id(raw.get("vendedor") or raw.get("seller")),
        "valor_subtotal":     _float(raw.get("subtotal") or raw.get("valor_subtotal") or 0),
        "valor_desconto":     _float(raw.get("desconto") or raw.get("discount") or 0),
        "valor_frete":        _float(raw.get("frete") or raw.get("freight") or 0),
        "valor_total":        _float(raw.get("total") or raw.get("totalValue") or raw.get("valor_total") or 0),
        "forma_pagamento":    _str(raw.get("forma_pagamento") or raw.get("payment_method") or ""),
        "conta_financeira_id": _id(raw.get("financialAccount") or raw.get("conta_financeira")),
        "observacao":         _str(raw.get("observacao") or raw.get("notes") or ""),
        "id_contrato":        _id(contrato) if contrato else _str(raw.get("id_contrato") or "") or None,
        "id_legado":          _int(raw.get("id_legado") or raw.get("numero_legado") or 0) or None,
        "natureza_operacao":  json.dumps(nat_op) if nat_op else None,
        "composicao_valor":   json.dumps(comp_val) if comp_val else None,
        "data_criacao":       _str(raw.get("data_criacao") or raw.get("created_at") or "") or None,
        # API CA retorna `data_alteracao` (doc §1.6). Populamos `data_atualizacao`.
        "data_atualizacao":   _str(raw.get("data_alteracao") or raw.get("data_atualizacao") or raw.get("updated_at") or "") or None,
        "synced_at":          datetime.now(timezone.utc),
    }


def _map_parcela(raw: Dict[str, Any], tipo: str, evento_id: str) -> Dict[str, Any]:
    """
    tipo: 'pagar' ou 'receber'
    evento_id: id do evento financeiro pai
    """
    base = {
        "id":               _str(raw.get("id") or raw.get("uuid") or ""),
        "numero_parcela":   _int(raw.get("numero_parcela") or raw.get("number") or 1),
        "data_vencimento":  _str(raw.get("data_vencimento") or raw.get("due_date") or "") or None,
        "valor":            _float(raw.get("valor") or raw.get("value") or 0),
        "valor_pago":       _float(raw.get("valor_pago") or raw.get("paid_value") or 0),
        "status":           _map_status(raw.get("status")),
        "data_pagamento":   _str(raw.get("data_pagamento") or raw.get("payment_date") or "") or None,
        "conta_financeira_id": _id(raw.get("conta_financeira") or raw.get("financial_account")),
        "observacao":       _str(raw.get("observacao") or raw.get("notes") or "") or None,
        # API CA retorna `data_alteracao` (priorizamos esse campo)
        "data_alteracao":   _str(raw.get("data_alteracao") or raw.get("data_atualizacao") or raw.get("updated_at") or "") or None,
        "synced_at":        datetime.now(timezone.utc),
    }
    if tipo == "pagar":
        base["conta_pagar_id"] = evento_id
    else:
        base["conta_receber_id"] = evento_id
    return base


def _map_transferencia(raw: Dict[str, Any]) -> Dict[str, Any]:
    # A API retorna os dados de conta dentro de raw['origem'] e raw['destino']
    # Estrutura: {"origem": {"conta_financeira": {"id": "...", "nome": "..."}}}
    origem  = raw.get("origem")  or {}
    destino = raw.get("destino") or {}

    # Extrai ID da conta via estrutura aninhada ou campos legados
    def _conta_id(obj: Dict, legados) -> Optional[str]:
        if isinstance(obj, dict):
            cf = obj.get("conta_financeira") or {}
            cid = _id(cf)
            if cid:
                return cid
        # Fallback para campos no nivel raiz
        for campo in legados:
            v = _id(raw.get(campo))
            if v:
                return v
        return None

    return {
        "id":               _str(raw.get("id") or raw.get("uuid") or ""),
        "data":             _str(raw.get("data") or raw.get("date") or "") or None,
        "conta_origem_id":  _conta_id(origem,  ["conta_origem", "conta_de", "source_account"]),
        "conta_destino_id": _conta_id(destino, ["conta_destino", "conta_para", "destination_account"]),
        "valor":            _float(raw.get("valor") or raw.get("value") or
                                   (origem.get("composicao_valor") or {}).get("valor_liquido") or 0),
        "descricao":        _str(raw.get("descricao") or raw.get("description") or "") or None,
        "data_alteracao":   _str(raw.get("data_atualizacao") or raw.get("updated_at") or "") or None,
        "synced_at":        datetime.now(timezone.utc),
    }


def _map_baixa(raw: Dict[str, Any]) -> Dict[str, Any]:
    comp       = raw.get("valor_composicao") or {}
    conta_fin  = raw.get("conta_financeira") or {}
    if isinstance(conta_fin, str):
        conta_fin = {"id": conta_fin}

    return {
        "id":                  _str(raw.get("id") or raw.get("uuid") or ""),
        # evento_id: mantido exatamente como estava — vincula baixa com contas_receber/pagar
        "evento_id":           _id(raw.get("evento") or raw.get("evento_id") or raw.get("event_id")),
        "tipo":                _str(raw.get("tipo_evento_financeiro") or raw.get("tipo") or "") or None,
        "data_pagamento":      _str(raw.get("data_pagamento") or raw.get("payment_date") or "") or None,
        # valor_composicao — objeto aninhado com a decomposição do pagamento
        "valor":               _float(comp.get("valor_liquido") or 0),
        "valor_bruto":         _float(comp.get("valor_bruto")   or 0),
        "taxa":                _float(comp.get("taxa")           or 0),
        "desconto":            _float(comp.get("desconto")       or 0),
        "juros":               _float(comp.get("juros")          or 0),
        "multa":               _float(comp.get("multa")          or 0),
        "conta_financeira_id": _str(conta_fin.get("id")) or None,
        "forma_pagamento":     _str(raw.get("metodo_pagamento") or raw.get("forma_pagamento") or "") or None,
        "observacao":          _str(raw.get("observacao") or raw.get("notes") or "") or None,
        "data_criacao":        _str(raw.get("data_criacao") or raw.get("created_at") or "") or None,
        "id_reconciliacao":    _id(raw.get("id_reconciliacao")),
        "synced_at":           datetime.now(timezone.utc),
    }


def _map_item_venda(raw: Dict[str, Any], venda_id: str) -> Dict[str, Any]:
    produto = raw.get("produto") or raw.get("product") or {}
    if isinstance(produto, str):
        produto = {"id": produto}
    return {
        "id":             _str(raw.get("id") or raw.get("uuid") or ""),
        "venda_id":       venda_id,
        "produto_id":     _id(produto),
        "descricao":      _str(raw.get("descricao") or raw.get("description") or "") or None,
        "quantidade":     _float(raw.get("quantidade") or raw.get("quantity") or 1),
        "valor_unitario": _float(raw.get("valor_unitario") or raw.get("unit_price") or raw.get("price") or 0),
        "valor_desconto": _float(raw.get("valor_desconto") or raw.get("discount") or 0),
        "valor_total":    _float(raw.get("valor_total") or raw.get("total") or 0),
        "tipo":           _str(raw.get("tipo") or raw.get("type") or "") or None,
        "custo_unitario": _float(raw.get("custo_unitario") or raw.get("cost") or 0),
        "synced_at":      datetime.now(timezone.utc),
    }


def _map_nota_fiscal(raw: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id":               _str(raw.get("id") or raw.get("uuid") or ""),
        "numero":           _int(raw.get("numero") or raw.get("number") or raw.get("numero_nfse") or 0) or None,
        "serie":            _str(raw.get("serie") or raw.get("series") or "") or None,
        "status":           _str(raw.get("status") or raw.get("situacao") or "") or None,
        "chave_acesso":     _str(raw.get("chave_acesso") or raw.get("access_key") or "") or None,
        "data_emissao":     _str(raw.get("data_emissao") or raw.get("emission_date") or raw.get("data_competencia") or "") or None,
        "venda_id":         _id(raw.get("venda") or raw.get("id_venda") or raw.get("sale")),
        "cliente_id":       _id(raw.get("cliente") or raw.get("customer")),
        "valor_total":      _float(raw.get("valor_total") or raw.get("total") or raw.get("valor_total_nfse") or 0),
        "tipo":             _str(raw.get("tipo") or raw.get("type") or "") or None,
        "synced_at":        datetime.now(timezone.utc),
        # Campos extras
        "contrato_id":      _id(raw.get("id_contrato") or raw.get("contrato")),
        "numero_venda":     _str(raw.get("numero_venda") or ""),
        "numero_rps":       _int(raw.get("numero_rps")),
        "numero_nfse":      _int(raw.get("numero_nfse")),
        "data_competencia": _str(raw.get("data_competencia") or "") or None,
        "nome_cliente":     _str(raw.get("nome_cliente") or ""),
    }


# ── Função genérica financeiro ────────────────────────────────────────────────

def _sync_financeiro(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
    api_path: str,
    table: str,
    mapper: Any,
    mode: str = "incremental",
    style: str = "finance",
    extra_params: Optional[Dict[str, Any]] = None,
) -> int:
    log_id  = log_sync_start(conn, api_path)
    records = 0

    try:
        params = _get_sync_params(mode, style=style)
        if extra_params:
            params.update(extra_params)

        raw_list = client.get_all(api_path, extra_params=params)
        mapped: List[Dict[str, Any]] = []
        phantom_cats: Dict[str, Dict[str, Any]] = {}

        for raw in raw_list:
            if not isinstance(raw, dict):
                continue

            cats_raw = raw.get("categorias") or []
            if isinstance(cats_raw, list):
                for c in cats_raw:
                    cid = c.get("id")
                    if cid and cid not in phantom_cats:
                        phantom_cats[cid] = {
                            "id":    cid,
                            "nome":  c.get("nome") or "Categoria Sistema",
                            "tipo":  "OUTROS",
                            "ativo": True,
                        }

            row = mapper(raw)
            if not row.get("id"):
                continue
            mapped.append(row)

        if phantom_cats:
            upsert(conn, "ca.categorias", list(phantom_cats.values()), conflict_col="id")
            conn.commit()
            logger.info("Sincronizadas %d categorias 'fantasmas' de %s", len(phantom_cats), api_path)

        if mapped:
            try:
                records = upsert(conn, table, mapped, conflict_col="id")
                conn.commit()
            except Exception as fk_err:
                if "foreign key" in str(fk_err).lower() or "fkey" in str(fk_err).lower():
                    conn.rollback()
                    logger.warning("FK violation em %s — nullificando FKs inválidas e tentando novamente", table)
                    for row in mapped:
                        for fk in ("pessoa_id", "cliente_id", "categoria_id", "centro_custo_id", "conta_financeira_id"):
                            if fk in row:
                                row[fk] = None
                    records = upsert(conn, table, mapped, conflict_col="id")
                    conn.commit()
                else:
                    raise
            logger.info("%-30s -> %d registro(s) em %s", api_path, records, table)
        else:
            logger.warning("Nenhum registro válido retornado de %s", api_path)

        log_sync_end(conn, log_id, records, status="ok")

    except Exception as exc:
        conn.rollback()
        logger.error("Erro em %s: %s", api_path, exc)
        log_sync_end(conn, log_id, records, status="erro", error_msg=str(exc))

    return records


# ── Funções públicas ──────────────────────────────────────────────────────────

def sync_contas_receber(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
    mode: str = "incremental",
) -> int:
    return _sync_financeiro(
        conn, client,
        "/financeiro/eventos-financeiros/contas-a-receber/buscar",
        "ca.contas_receber",
        _map_conta_receber,
        mode=mode,
        style="finance",
    )


def sync_contas_pagar(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
    mode: str = "incremental",
) -> int:
    return _sync_financeiro(
        conn, client,
        "/financeiro/eventos-financeiros/contas-a-pagar/buscar",
        "ca.contas_pagar",
        _map_conta_pagar,
        mode=mode,
        style="finance",
    )


def sync_vendas(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
    mode: str = "incremental",
) -> int:
    return _sync_financeiro(
        conn, client,
        "/venda/busca",
        "ca.vendas",
        _map_venda,
        mode=mode,
        style="sales",
    )


def sync_parcelas(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
    mode: str = "incremental",
) -> int:
    """
    Para cada conta_receber e conta_pagar no período, busca as parcelas
    via GET /financeiro/eventos-financeiros/parcelas/{id}.
    Upsert feito a cada BATCH_SIZE registros para resiliência.
    """
    BATCH_SIZE = 200
    log_id  = log_sync_start(conn, "/financeiro/eventos-financeiros/parcelas")
    records = 0

    def _flush(buf: List[Dict[str, Any]], table: str) -> int:
        """Upserta buf em table e retorna o número de linhas."""
        if not buf:
            return 0
        nonlocal conn
        conn = ensure_connection(conn)
        n = upsert(conn, table, buf, conflict_col="id")
        conn.commit()
        return n

    try:
        # ESTRATÉGIA (refatorada em 22/mai/2026):
        # • FULL: processa TODAS as CRs/CPs no banco.
        # • INCREMENTAL: apenas CRs/CPs com data_atualizacao nos últimos
        #   30 dias. Como _sync_financeiro usa data_alteracao_de na API,
        #   qualquer mudança (incluindo baixas retroativas/antecipadas)
        #   atualiza data_atualizacao da CR/CP — esse filtro captura tudo.
        if mode == "full":
            alt_threshold = None
        else:
            alt_threshold = datetime.now(timezone.utc) - timedelta(days=30)

        # ── Parcelas a receber ──────────────────────────────────────────────
        conn = ensure_connection(conn)
        with conn.cursor() as cur:
            if alt_threshold is None:
                cur.execute("SELECT id FROM ca.contas_receber")
            else:
                # OR data_atualizacao IS NULL — captura CRs que ainda não tiveram
                # o campo populado (transição). Pode ser removido depois que
                # todas as CRs forem re-sincronizadas pelo menos 1 vez.
                cur.execute(
                    """SELECT id FROM ca.contas_receber
                       WHERE data_atualizacao >= %s OR data_atualizacao IS NULL""",
                    (alt_threshold,),
                )
            ids_receber = [row[0] for row in cur.fetchall()]

        logger.info("Parcelas a receber: %d eventos a processar", len(ids_receber))
        buf_receber: List[Dict[str, Any]] = []

        for i, evento_id in enumerate(ids_receber):
            if i % 100 == 0:
                conn = ensure_connection(conn)
            try:
                resp = client.get(f"/financeiro/eventos-financeiros/parcelas/{evento_id}")
                if resp is None:
                    continue
                parcelas_raw = resp if isinstance(resp, list) else (
                    resp.get("parcelas") or resp.get("items") or [resp]
                )
                for p in parcelas_raw:
                    if not isinstance(p, dict):
                        continue
                    row = _map_parcela(p, "receber", str(evento_id))
                    if row.get("id"):
                        buf_receber.append(row)
            except Exception as exc:
                logger.warning("Erro ao buscar parcelas do evento receber %s: %s", evento_id, exc)

            # Commit a cada BATCH_SIZE
            if len(buf_receber) >= BATCH_SIZE:
                n = _flush(buf_receber, "ca.parcelas_receber")
                records += n
                logger.info("  [batch] %d parcelas_receber salvas (total=%d)", n, records)
                buf_receber = []

        # Flush final
        n = _flush(buf_receber, "ca.parcelas_receber")
        records += n
        logger.info("%-30s -> %d parcela(s) em ca.parcelas_receber", "/parcelas", records)

        # ── Parcelas a pagar ────────────────────────────────────────────────
        conn = ensure_connection(conn)
        with conn.cursor() as cur:
            if alt_threshold is None:
                cur.execute("SELECT id FROM ca.contas_pagar")
            else:
                cur.execute(
                    """SELECT id FROM ca.contas_pagar
                       WHERE data_atualizacao >= %s OR data_atualizacao IS NULL""",
                    (alt_threshold,),
                )
            ids_pagar = [row[0] for row in cur.fetchall()]

        logger.info("Parcelas a pagar: %d eventos a processar", len(ids_pagar))
        buf_pagar: List[Dict[str, Any]] = []
        n_pagar = 0

        for i, evento_id in enumerate(ids_pagar):
            if i % 100 == 0:
                conn = ensure_connection(conn)
            try:
                resp = client.get(f"/financeiro/eventos-financeiros/parcelas/{evento_id}")
                if resp is None:
                    continue
                parcelas_raw = resp if isinstance(resp, list) else (
                    resp.get("parcelas") or resp.get("items") or [resp]
                )
                for p in parcelas_raw:
                    if not isinstance(p, dict):
                        continue
                    row = _map_parcela(p, "pagar", str(evento_id))
                    if row.get("id"):
                        buf_pagar.append(row)
            except Exception as exc:
                logger.warning("Erro ao buscar parcelas do evento pagar %s: %s", evento_id, exc)

            # Commit a cada BATCH_SIZE
            if len(buf_pagar) >= BATCH_SIZE:
                n = _flush(buf_pagar, "ca.parcelas_pagar")
                n_pagar += n
                records += n
                logger.info("  [batch] %d parcelas_pagar salvas (total=%d)", n, records)
                buf_pagar = []

        # Flush final
        n = _flush(buf_pagar, "ca.parcelas_pagar")
        n_pagar += n
        records += n
        logger.info("%-30s -> %d parcela(s) em ca.parcelas_pagar", "/parcelas", n_pagar)

        log_sync_end(conn, log_id, records, status="ok")

    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("Erro em sync_parcelas: %s", exc)
        log_sync_end(conn, log_id, records, status="erro", error_msg=str(exc))

    return records


def sync_transferencias(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
    mode: str = "incremental",
) -> int:
    log_id  = log_sync_start(conn, "/financeiro/transferencias")
    records = 0

    try:
        today    = date.today()
        year_end = date(today.year, 12, 31)
        if mode == "full":
            start_date = "2015-01-01"
        else:
            start_date = (today - timedelta(days=30)).strftime("%Y-%m-%d")

        # API do Conta Azul restringe busca de transferências a no máximo 1 ano por vez
        total_items = []
        for start_chunk, end_chunk in _get_date_chunks(start_date, year_end.strftime("%Y-%m-%d")):
            params = {"data_inicio": start_chunk, "data_fim": end_chunk}
            logger.info("Buscando transferências entre %s e %s...", start_chunk, end_chunk)
            chunk_list = client.get_all("/financeiro/transferencias", extra_params=params)
            total_items.extend(chunk_list)

        mapped: List[Dict[str, Any]] = []
        skipped = 0

        for raw in total_items:
            if not isinstance(raw, dict):
                continue
            row = _map_transferencia(raw)
            if not row.get("id"):
                continue
            # Ignora transferências sem conta de origem (constraint NOT NULL no banco)
            if not row.get("conta_origem_id"):
                skipped += 1
                logger.debug("Transferência %s ignorada: conta_origem_id ausente (desc: %s)",
                             row.get("id"), raw.get("descricao", "")[:60])
                continue
            mapped.append(row)

        if skipped:
            logger.warning("%d transferência(s) ignoradas por falta de conta_origem_id", skipped)

        if mapped:
            records = upsert(conn, "ca.transferencias", mapped, conflict_col="id")
            conn.commit()
            logger.info("%-30s -> %d registro(s) em ca.transferencias", "/financeiro/transferencias", records)
        else:
            logger.warning("Nenhuma transferência retornada")

        log_sync_end(conn, log_id, records, status="ok")

    except Exception as exc:
        conn.rollback()
        logger.error("Erro em sync_transferencias: %s", exc)
        log_sync_end(conn, log_id, records, status="erro", error_msg=str(exc))

    return records


def sync_baixas(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
    mode: str = "incremental",
) -> int:
    """
    Busca baixas (liquidacoes) de cada parcela via:
        GET /financeiro/eventos-financeiros/parcelas/{parcela_id}/baixa

    Roda APOS sync_parcelas. Faz commit a cada BATCH_SIZE registros.

    ESTRATÉGIA DE FILTRO (refatorada em 22/mai/2026 — fix definitivo):
      • FULL: processa TODAS as parcelas no banco — varredura completa.
      • INCREMENTAL: processa APENAS parcelas com data_alteracao nos
        últimos 30 dias. Como sync_contas_receber/pagar usa data_alteracao_de
        na API, qualquer mudança (nova venda, baixa, cancelamento, etc)
        atualiza o data_alteracao da parcela — então esse filtro captura
        tanto baixas retroativas quanto antecipadas, automaticamente.
    """
    BATCH_SIZE = 200
    ENDPOINT   = "/financeiro/eventos-financeiros/parcelas/{id}/baixa"
    log_id     = log_sync_start(conn, ENDPOINT)
    records    = 0

    try:
        if mode == "full":
            alt_threshold = None
        else:
            alt_threshold = datetime.now(timezone.utc) - timedelta(days=30)

        # Coleta IDs de parcelas a receber e a pagar
        conn = ensure_connection(conn)
        with conn.cursor() as cur:
            if alt_threshold is None:
                cur.execute("SELECT id FROM ca.parcelas_receber")
                ids_receber = [row[0] for row in cur.fetchall()]

                cur.execute("SELECT id FROM ca.parcelas_pagar")
                ids_pagar = [row[0] for row in cur.fetchall()]
            else:
                # Apenas parcelas com alteração recente OU sem data_alteracao
                # populada (transição — pode ser removido após 1ª re-sync)
                cur.execute(
                    """SELECT id FROM ca.parcelas_receber
                       WHERE data_alteracao >= %s OR data_alteracao IS NULL""",
                    (alt_threshold,),
                )
                ids_receber = [row[0] for row in cur.fetchall()]

                cur.execute(
                    """SELECT id FROM ca.parcelas_pagar
                       WHERE data_alteracao >= %s OR data_alteracao IS NULL""",
                    (alt_threshold,),
                )
                ids_pagar = [row[0] for row in cur.fetchall()]

        all_ids = ids_receber + ids_pagar
        logger.info("sync_baixas: %d parcelas a processar (%d receber + %d pagar)",
                    len(all_ids), len(ids_receber), len(ids_pagar))

        if not all_ids:
            logger.info("sync_baixas: nenhuma parcela no periodo — pulando.")
            log_sync_end(conn, log_id, 0, status="ok")
            return 0

        buf: List[Dict[str, Any]] = []

        for i, parcela_id in enumerate(all_ids):
            if i % 100 == 0:
                conn = ensure_connection(conn)
            try:
                resp = client.get(
                    f"/financeiro/eventos-financeiros/parcelas/{parcela_id}/baixa"
                )
                if resp is None:
                    continue  # parcela sem baixa (ainda nao paga)

                baixas_raw = resp if isinstance(resp, list) else [resp]
                for raw in baixas_raw:
                    if not isinstance(raw, dict):
                        continue
                    row = _map_baixa(raw)
                    if not row.get("id"):
                        continue
                    # Garante a referencia a parcela
                    if not row.get("evento_id"):
                        row["evento_id"] = str(parcela_id)
                    buf.append(row)
            except Exception as exc:
                logger.debug("Sem baixa na parcela %s: %s", parcela_id, exc)

            # Commit a cada BATCH_SIZE
            if len(buf) >= BATCH_SIZE:
                conn = ensure_connection(conn)
                n = upsert(conn, "ca.baixas", buf, conflict_col="id")
                conn.commit()
                records += n
                logger.info("  [batch] %d baixas salvas (total=%d)", n, records)
                buf = []

        # Flush final
        if buf:
            conn = ensure_connection(conn)
            n = upsert(conn, "ca.baixas", buf, conflict_col="id")
            conn.commit()
            records += n

        logger.info("%-30s -> %d registro(s) em ca.baixas", ENDPOINT, records)
        log_sync_end(conn, log_id, records, status="ok")

    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("Erro em sync_baixas: %s", exc)
        log_sync_end(conn, log_id, records, status="erro", error_msg=str(exc))

    return records


def sync_itens_venda(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
    mode: str = "incremental",
) -> int:
    """
    Para cada venda no período, busca os itens via GET /venda/{id}/itens.
    Upsert feito a cada BATCH_SIZE registros para resiliência.
    """
    BATCH_SIZE = 200
    log_id  = log_sync_start(conn, "/venda/{id}/itens")
    records = 0

    try:
        today    = date.today()
        year_end = date(today.year, 12, 31)
        if mode == "full":
            start_date = "2015-01-01"
        else:
            start_date = (today - timedelta(days=30)).strftime("%Y-%m-%d")

        conn = ensure_connection(conn)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM ca.vendas WHERE data_emissao BETWEEN %s AND %s",
                (start_date, year_end.strftime("%Y-%m-%d")),
            )
            venda_ids = [row[0] for row in cur.fetchall()]

        logger.info("Itens de venda: %d vendas a processar", len(venda_ids))
        buf: List[Dict[str, Any]] = []

        for i, venda_id in enumerate(venda_ids):
            if i % 100 == 0:
                conn = ensure_connection(conn)

            try:
                resp  = client.get(f"/venda/{venda_id}/itens")
                if resp is None:
                    continue
                itens = resp if isinstance(resp, list) else (
                    resp.get("itens") or resp.get("items") or []
                )
                for item in itens:
                    if not isinstance(item, dict):
                        continue
                    row = _map_item_venda(item, str(venda_id))
                    if row.get("id"):
                        buf.append(row)
            except Exception as exc:
                logger.warning("Erro ao buscar itens da venda %s: %s", venda_id, exc)

            # Commit a cada BATCH_SIZE
            if len(buf) >= BATCH_SIZE:
                conn = ensure_connection(conn)
                n = upsert(conn, "ca.itens_venda", buf, conflict_col="id")
                conn.commit()
                records += n
                logger.info("  [batch] %d itens_venda salvos (total=%d)", n, records)
                buf = []

        # Flush final
        if buf:
            conn = ensure_connection(conn)
            n = upsert(conn, "ca.itens_venda", buf, conflict_col="id")
            conn.commit()
            records += n

        logger.info("%-30s -> %d item(ns) em ca.itens_venda", "/venda/{id}/itens", records)
        log_sync_end(conn, log_id, records, status="ok")

    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        logger.error("Erro em sync_itens_venda: %s", exc)
        log_sync_end(conn, log_id, records, status="erro", error_msg=str(exc))

    return records


def sync_notas_fiscais(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
    mode: str = "incremental",
) -> int:
    """
    Sincroniza notas fiscais (Produtos e Serviços).
    Ambos os endpoints exigem chunks de no máximo 15 dias.
    """
    log_id  = log_sync_start(conn, "/notas-fiscais")
    records = 0

    try:
        today = date.today()
        if mode == "full":
            start_date = date(2015, 1, 1)
        else:
            start_date = today - timedelta(days=30)

        # Se for incremental, pegamos até hoje. Se for full, até o fim do ano.
        end_date = date(today.year, 12, 31) if mode == "full" else today

        # ── Detecta endpoints disponíveis ────────────────────────────────────
        probe_start = (today - timedelta(days=7)).strftime("%Y-%m-%d")
        probe_end   = today.strftime("%Y-%m-%d")

        # Ambos usam os mesmos nomes de params e limite de 15 dias
        probe_params = {
            "data_competencia_de": probe_start,
            "data_competencia_ate": probe_end,
            "pagina": 1,
            "tamanho_pagina": 10
        }

        resp_p = client._request("GET", "/notas-fiscais", params=probe_params)
        nf_produto_ok = resp_p.status_code not in (400, 404)
        
        resp_s = client._request("GET", "/notas-fiscais-servico", params=probe_params)
        nf_servico_ok = resp_s.status_code not in (400, 404)

        logger.info("Endpoints NF: Produto=%s, Servico=%s", 
                    "OK" if nf_produto_ok else "OFF", 
                    "OK" if nf_servico_ok else "OFF")

        if not nf_produto_ok and not nf_servico_ok:
            logger.info("sync_notas_fiscais: nenhum endpoint disponivel -- pulando.")
            log_sync_end(conn, log_id, 0, status="ok")
            return 0

        # ── Coleta dados em chunks de 15 dias ────────────────────────────────
        total_items: List[Dict[str, Any]] = []
        endpoints_to_sync = []
        if nf_produto_ok: endpoints_to_sync.append("/notas-fiscais")
        if nf_servico_ok: endpoints_to_sync.append("/notas-fiscais-servico")

        for endpoint in endpoints_to_sync:
            logger.info("Sincronizando %s de %s a %s...", endpoint, start_date, end_date)
            cursor = start_date
            while cursor <= end_date:
                chunk_end = min(cursor + timedelta(days=14), end_date)
                chunk = client.get_all(endpoint, extra_params={
                    "data_competencia_de":  cursor.strftime("%Y-%m-%d"),
                    "data_competencia_ate": chunk_end.strftime("%Y-%m-%d"),
                })
                if chunk:
                    total_items.extend(chunk)
                cursor = chunk_end + timedelta(days=1)

        # ── Mapeia e faz upsert ───────────────────────────────────────────────
        mapped: List[Dict[str, Any]] = []
        for raw in total_items:
            if not isinstance(raw, dict) or not raw:
                continue
            row = _map_nota_fiscal(raw)
            if row.get("id"):
                mapped.append(row)

        if mapped:
            try:
                records = upsert(conn, "ca.notas_fiscais", mapped, conflict_col="id")
                conn.commit()
            except Exception as fk_err:
                if "foreign key" in str(fk_err).lower():
                    conn.rollback()
                    logger.warning("FK violation em ca.notas_fiscais -- nullificando FKs")
                    for row in mapped:
                        row["venda_id"]   = None
                        row["cliente_id"] = None
                    records = upsert(conn, "ca.notas_fiscais", mapped, conflict_col="id")
                    conn.commit()
                else:
                    raise
            logger.info("[OK] sync_notas_fiscais -> %d registro(s) salvos", records)
        else:
            logger.info("Nenhuma nota fiscal encontrada no periodo.")

        log_sync_end(conn, log_id, records, status="ok")

    except Exception as exc:
        try: conn.rollback()
        except: pass
        logger.error("Erro em sync_notas_fiscais: %s", exc)
        log_sync_end(conn, log_id, records, status="erro", error_msg=str(exc))

    return records

