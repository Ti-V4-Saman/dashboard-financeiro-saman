"""
etl/sync/financeiro.py
Sincroniza lançamentos financeiros do ano corrente:
  - /v1/contas-receber → ca.contas_receber
  - /v1/contas-pagar   → ca.contas_pagar
  - /v1/vendas         → ca.vendas
"""

import logging
from datetime import date
from typing import Any, Dict, List, Optional

import psycopg2.extensions

from etl.client import ContaAzulClient
from etl.db import log_sync_end, log_sync_start, upsert

logger = logging.getLogger(__name__)


def _year_params() -> Dict[str, str]:
    """Retorna filtro de data para o ano corrente (01/01 até 31/12)."""
    year = date.today().year
    return {
        "dataInicio": f"{year}-01-01",
        "dataFim":    f"{year}-12-31",
    }


def _str(v: Any) -> str:
    return str(v) if v is not None else ""


def _float(v: Any) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _map_conta_receber(raw: Dict[str, Any]) -> Dict[str, Any]:
    vencimento = raw.get("dueDate") or raw.get("dataVencimento") or raw.get("vencimento")
    competencia = raw.get("competenceDate") or raw.get("dataCompetencia") or raw.get("competencia")
    baixa = raw.get("paymentDate") or raw.get("dataBaixa") or raw.get("pagamento")

    return {
        "id":                _str(raw.get("id") or raw.get("uuid")),
        "descricao":         _str(raw.get("description") or raw.get("descricao")),
        "valor":             _float(raw.get("value") or raw.get("valor")),
        "valor_recebido":    _float(raw.get("amountReceived") or raw.get("valorRecebido")),
        "data_vencimento":   _str(vencimento),
        "data_competencia":  _str(competencia),
        "data_recebimento":  _str(baixa),
        "situacao":          _str(raw.get("situation") or raw.get("situacao") or raw.get("status")),
        "categoria_id":      _str((raw.get("category") or {}).get("id") or raw.get("categoriaId")),
        "conta_id":          _str((raw.get("financialAccount") or {}).get("id") or raw.get("contaId")),
        "pessoa_id":         _str((raw.get("customer") or raw.get("person") or {}).get("id") or raw.get("pessoaId")),
        "centro_custo_id":   _str((raw.get("costCenter") or {}).get("id") or raw.get("centroCustoId")),
        "numero_documento":  _str(raw.get("documentNumber") or raw.get("numeroDocumento")),
        "observacao":        _str(raw.get("notes") or raw.get("observacao") or raw.get("obs")),
        "payload_json":      raw,
    }


def _map_conta_pagar(raw: Dict[str, Any]) -> Dict[str, Any]:
    vencimento  = raw.get("dueDate") or raw.get("dataVencimento") or raw.get("vencimento")
    competencia = raw.get("competenceDate") or raw.get("dataCompetencia") or raw.get("competencia")
    baixa       = raw.get("paymentDate") or raw.get("dataBaixa") or raw.get("pagamento")

    return {
        "id":               _str(raw.get("id") or raw.get("uuid")),
        "descricao":        _str(raw.get("description") or raw.get("descricao")),
        "valor":            _float(raw.get("value") or raw.get("valor")),
        "valor_pago":       _float(raw.get("amountPaid") or raw.get("valorPago")),
        "data_vencimento":  _str(vencimento),
        "data_competencia": _str(competencia),
        "data_pagamento":   _str(baixa),
        "situacao":         _str(raw.get("situation") or raw.get("situacao") or raw.get("status")),
        "categoria_id":     _str((raw.get("category") or {}).get("id") or raw.get("categoriaId")),
        "conta_id":         _str((raw.get("financialAccount") or {}).get("id") or raw.get("contaId")),
        "pessoa_id":        _str((raw.get("supplier") or raw.get("person") or {}).get("id") or raw.get("pessoaId")),
        "centro_custo_id":  _str((raw.get("costCenter") or {}).get("id") or raw.get("centroCustoId")),
        "numero_documento": _str(raw.get("documentNumber") or raw.get("numeroDocumento")),
        "observacao":       _str(raw.get("notes") or raw.get("observacao") or raw.get("obs")),
        "payload_json":     raw,
    }


def _map_venda(raw: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id":              _str(raw.get("id") or raw.get("uuid")),
        "numero":          _str(raw.get("number") or raw.get("numero")),
        "data_emissao":    _str(raw.get("emissionDate") or raw.get("dataEmissao") or raw.get("emissao")),
        "data_previsao":   _str(raw.get("scheduledDate") or raw.get("dataPrevisao")),
        "situacao":        _str(raw.get("status") or raw.get("situacao")),
        "valor_total":     _float(raw.get("totalValue") or raw.get("valorTotal") or raw.get("total")),
        "desconto":        _float(raw.get("discount") or raw.get("desconto") or 0),
        "cliente_id":      _str((raw.get("customer") or {}).get("id") or raw.get("clienteId")),
        "observacao":      _str(raw.get("notes") or raw.get("observacoes") or raw.get("obs")),
        "payload_json":    raw,
    }


def _sync_financeiro(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
    api_path: str,
    table: str,
    mapper: Any,
    extra_params: Optional[Dict[str, Any]] = None,
) -> int:
    log_id = log_sync_start(conn, api_path)
    records = 0

    try:
        params = _year_params()
        if extra_params:
            params.update(extra_params)

        raw_list = client.get_all(api_path, extra_params=params)
        mapped: List[Dict[str, Any]] = []

        for raw in raw_list:
            if not isinstance(raw, dict):
                continue
            row = mapper(raw)
            if not row.get("id"):
                continue
            mapped.append(row)

        if mapped:
            records = upsert(conn, table, mapped, conflict_col="id")
            conn.commit()
            logger.info("✓ %-30s → %d registro(s) em %s", api_path, records, table)
        else:
            logger.warning("Nenhum registro válido retornado de %s", api_path)

        log_sync_end(conn, log_id, records, status="ok")

    except Exception as exc:
        conn.rollback()
        logger.error("✗ Erro em %s: %s", api_path, exc)
        log_sync_end(conn, log_id, records, status="erro", error_msg=str(exc))

    return records


def sync_contas_receber(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
) -> int:
    return _sync_financeiro(conn, client, "/v1/contas-receber", "ca.contas_receber", _map_conta_receber)


def sync_contas_pagar(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
) -> int:
    return _sync_financeiro(conn, client, "/v1/contas-pagar", "ca.contas_pagar", _map_conta_pagar)


def sync_vendas(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
) -> int:
    return _sync_financeiro(conn, client, "/v1/vendas", "ca.vendas", _map_venda)
