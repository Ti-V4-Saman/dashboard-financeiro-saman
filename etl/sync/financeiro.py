"""
etl/sync/financeiro.py
Sincroniza lançamentos financeiros do ano corrente:
  - /v1/contas-receber → ca.contas_receber
  - /v1/contas-pagar   → ca.contas_pagar
  - /v1/vendas         → ca.vendas
"""

import logging
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

import psycopg2.extensions

from etl.client import ContaAzulClient
from etl.db import log_sync_end, log_sync_start, upsert

logger = logging.getLogger(__name__)


def _get_sync_params(mode: str = "incremental", style: str = "finance") -> Dict[str, str]:
    """
    Retorna filtro de data baseado no modo e no estilo do endpoint:
    - style='finance': data_vencimento_de / data_vencimento_ate
    - style='sales': data_inicio / data_fim
    """
    from datetime import timedelta
    today = date.today()
    year_end = date(today.year, 12, 31)
    
    if mode == "full":
        start_date = "2015-01-01"
    else:
        start_dt = today - timedelta(days=30)
        start_date = start_dt.strftime("%Y-%m-%d")

    end_date = year_end.strftime("%Y-%m-%d")

    if style == "sales":
        return {"data_inicio": start_date, "data_fim": end_date}
    else:
        return {"data_vencimento_de": start_date, "data_vencimento_ate": end_date}


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


def _map_status(s: Any) -> str:
    s = str(s).upper() if s else ""
    mapping = {
        # API v2 Termos
        "PAID": "Quitado",
        "ACQUITTED": "Quitado",
        "OPEN": "Aberto",
        "PENDING": "Aberto",
        "OVERDUE": "Atrasado",
        "PARTIAL": "Parcial",
        "PARTIALLY_PAID": "Parcial",
        "CANCELLED": "Cancelado",
        "LOST": "Cancelado",
        # Termos em PT
        "VENCIDO": "Atrasado",
        "QUITADO": "Quitado",
        "ABERTO": "Aberto",
    }
    return mapping.get(s, s)


def _map_conta_receber(raw: Dict[str, Any]) -> Dict[str, Any]:
    # Estrutura real da API v2 (confirmada em 2026-04-21)
    total = _float(raw.get("total") or 0)
    pago  = _float(raw.get("pago") or 0)
    nao_pago = _float(raw.get("nao_pago") or (total - pago))

    # Categorias vem como lista
    cats = raw.get("categorias") or []
    cat_id = cats[0].get("id") if (isinstance(cats, list) and cats) else None

    # Centros de custo vem como lista
    ccs = raw.get("centros_de_custo") or []
    cc_id = ccs[0].get("id") if (isinstance(ccs, list) and ccs) else None

    # Cliente vem como objeto
    cliente = raw.get("cliente") or {}
    pessoa_id = cliente.get("id")

    return {
        "id":                _str(raw.get("id")),
        "descricao":         _str(raw.get("descricao")),
        "data_vencimento":   _str(raw.get("data_vencimento")) or None,
        "data_competencia":  _str(raw.get("data_competencia")) or None,
        "status":            _map_status(raw.get("status")),
        "total":             total,
        "valor_pago":        pago,
        "valor_aberto":      nao_pago,
        "pessoa_id":         _str(pessoa_id) or None,
        "categoria_id":      _str(cat_id) or None,
        "centro_custo_id":   _str(cc_id) or None,
        "conta_financeira_id": None,
        "numero_documento":  _str(raw.get("numero_documento") or ""),
        "observacao":        _str(raw.get("observacao") or ""),
        "id_venda":          _str(raw.get("id_venda")) or None,
        "synced_at":         datetime.now(timezone.utc)
    }


def _map_conta_pagar(raw: Dict[str, Any]) -> Dict[str, Any]:
    # Estrutura real da API v2 (confirmada em 2026-04-21)
    total = _float(raw.get("total") or 0)
    pago  = _float(raw.get("pago") or 0)
    nao_pago = _float(raw.get("nao_pago") or (total - pago))

    cats = raw.get("categorias") or []
    cat_id = cats[0].get("id") if (isinstance(cats, list) and cats) else None

    ccs = raw.get("centros_de_custo") or []
    cc_id = ccs[0].get("id") if (isinstance(ccs, list) and ccs) else None

    fornecedor = raw.get("fornecedor") or {}
    pessoa_id = fornecedor.get("id")

    return {
        "id":                _str(raw.get("id")),
        "descricao":         _str(raw.get("descricao")),
        "data_vencimento":   _str(raw.get("data_vencimento")) or None,
        "data_competencia":  _str(raw.get("data_competencia")) or None,
        "status":            _map_status(raw.get("status")),
        "total":             total,
        "valor_pago":        pago,
        "valor_aberto":      nao_pago,
        "pessoa_id":         _str(pessoa_id) or None,
        "categoria_id":      _str(cat_id) or None,
        "centro_custo_id":   _str(cc_id) or None,
        "conta_financeira_id": None,
        "numero_documento":  _str(raw.get("numero_documento") or ""),
        "observacao":        _str(raw.get("observacao") or ""),
        "synced_at":         datetime.now(timezone.utc)
    }


def _map_venda(raw: Dict[str, Any]) -> Dict[str, Any]:
    # Estrutura real da API v2 (confirmada em 2026-04-21)
    # Campos reais: id, data, situacao, tipo, total, numero, cliente.id
    
    # Extrair status (nome se for objeto, else raw string)
    situacao = raw.get("situacao") or raw.get("status") or ""
    if isinstance(situacao, dict):
        status_final = situacao.get("nome") or situacao.get("descricao") or ""
    else:
        status_final = _map_status(situacao)

    return {
        "id":              _str(raw.get("id") or raw.get("uuid")),
        "numero":          _int(raw.get("numero") or raw.get("number") or 0),
        "status":          _str(status_final),
        "tipo":            _str(raw.get("tipo") or raw.get("type") or "VENDA"),
        "data_emissao":    _str(raw.get("data") or raw.get("data_emissao") or raw.get("emissionDate")) or None,
        "data_entrega":    _str(raw.get("data_entrega") or raw.get("scheduledDate")) or None,
        "cliente_id":      _str((raw.get("cliente") or raw.get("customer") or {}).get("id")) or None,
        "vendedor_id":     _str((raw.get("vendedor") or raw.get("seller") or {}).get("id")) or None,
        "valor_subtotal":  _float(raw.get("subtotal") or raw.get("valor_subtotal") or 0),
        "valor_desconto":  _float(raw.get("desconto") or raw.get("discount") or 0),
        "valor_frete":     _float(raw.get("frete") or raw.get("freight") or 0),
        "valor_total":     _float(raw.get("total") or raw.get("totalValue") or raw.get("valor_total") or 0),
        "forma_pagamento": _str(raw.get("forma_pagamento") or raw.get("payment_method") or ""),
        "conta_financeira_id": _str((raw.get("financialAccount") or {}).get("id")) or None,
        "observacao":      _str(raw.get("observacao") or raw.get("notes") or ""),
        "synced_at":       datetime.now(timezone.utc)
    }


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
    log_id = log_sync_start(conn, api_path)
    records = 0

    try:
        params = _get_sync_params(mode, style=style)
        if extra_params:
            params.update(extra_params)

        raw_list = client.get_all(api_path, extra_params=params)
        mapped: List[Dict[str, Any]] = []
        
        # Sincronização de 'Categorias Fantasmas' (que não aparecem no mestre mas estão nos lançamentos)
        phantom_cats: Dict[str, Dict[str, Any]] = {}

        for raw in raw_list:
            if not isinstance(raw, dict):
                continue

            # Tenta capturar categorias do item para evitar erros de FK
            cats_raw = raw.get("categorias") or []
            if isinstance(cats_raw, list):
                for c in cats_raw:
                    cid = c.get("id")
                    if cid and cid not in phantom_cats:
                        phantom_cats[cid] = {
                            "id": cid,
                            "nome": c.get("nome") or "Categoria Sistema",
                            "tipo": "OUTROS",
                            "ativo": True
                        }

            row = mapper(raw)
            if not row.get("id"):
                continue
            mapped.append(row)

        # Upsert categorias fantasmas primeiro
        if phantom_cats:
            upsert(conn, "ca.categorias", list(phantom_cats.values()), conflict_col="id")
            conn.commit()
            logger.info("Sincronizadas %d categorias 'fantasmas' de %s", len(phantom_cats), api_path)

        if mapped:
            try:
                records = upsert(conn, table, mapped, conflict_col="id")
                conn.commit()
            except Exception as fk_err:
                # FK violation: tentar novamente com pessoa_id=None para não bloquear o import
                if "foreign key" in str(fk_err).lower() or "fkey" in str(fk_err).lower():
                    conn.rollback()
                    logger.warning("FK violation em %s — nullificando pessoa_id inválidos e tentando novamente", table)
                    for row in mapped:
                        if "pessoa_id" in row:
                            row["pessoa_id"] = None
                        if "cliente_id" in row:
                            row["cliente_id"] = None
                        if "categoria_id" in row:
                            row["categoria_id"] = None
                        if "centro_custo_id" in row:
                            row["centro_custo_id"] = None
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


def sync_contas_receber(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
    mode: str = "incremental",
) -> int:
    # Endpoints corretos da API v2 Bridge conforme documentação
    return _sync_financeiro(
        conn, client, 
        "/financeiro/eventos-financeiros/contas-a-receber/buscar", 
        "ca.contas_receber", 
        _map_conta_receber, 
        mode=mode,
        style="finance"
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
        style="finance"
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
        style="sales"
    )
