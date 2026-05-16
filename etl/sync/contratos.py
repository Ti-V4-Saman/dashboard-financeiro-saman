"""
etl/sync/contratos.py
Sincroniza contratos recorrentes do Conta Azul:
  - /v1/contrato → ca.contratos + ca.itens_contrato
"""

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import psycopg2.extensions

from etl.client import ContaAzulClient
from etl.db import log_sync_end, log_sync_start, upsert

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

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
    """Extrai id de um objeto ou string, retorna None se vazio."""
    if isinstance(obj, dict):
        v = obj.get("id") or obj.get("uuid")
    else:
        v = obj
    return _str(v) or None


def _get_sync_params(mode: str = "incremental") -> Dict[str, str]:
    today = date.today()
    year_end = date(today.year, 12, 31)
    if mode == "full":
        start_date = "2015-01-01"
    else:
        start_date = (today - timedelta(days=60)).strftime("%Y-%m-%d")
    return {
        "data_inicio": start_date,
        "data_fim":    year_end.strftime("%Y-%m-%d"),
    }


# ── Mapeadores ────────────────────────────────────────────────────────────────

def _map_contrato(raw: Dict[str, Any]) -> Dict[str, Any]:
    termos = raw.get("termos") or raw.get("terms") or {}

    return {
        "id":                    _str(raw.get("id") or raw.get("uuid") or ""),
        "numero":                _int(raw.get("numero") or raw.get("number") or 0) or None,
        "cliente_id":            _id(raw.get("cliente") or raw.get("id_cliente") or raw.get("customer")),
        "vendedor_id":           _id(raw.get("vendedor") or raw.get("id_vendedor") or raw.get("seller")),
        "categoria_id":          _id(raw.get("categoria") or raw.get("id_categoria") or raw.get("category")),
        "centro_custo_id":       _id(raw.get("centro_de_custo") or raw.get("id_centro_custo") or raw.get("cost_center")),
        "data_emissao":          _str(raw.get("data_emissao") or raw.get("date") or raw.get("created_at") or "") or None,
        "tipo_frequencia":       _str(termos.get("tipo_frequencia") or termos.get("frequency_type") or "") or None,
        "intervalo_frequencia":  _int(termos.get("intervalo_frequencia") or termos.get("interval") or 0) or None,
        "data_inicio":           _str(termos.get("data_inicio") or termos.get("start_date") or "") or None,
        "data_fim":              _str(termos.get("data_fim") or termos.get("end_date") or "") or None,
        "tipo_expiracao":        _str(termos.get("tipo_expiracao") or termos.get("expiration_type") or "") or None,
        "status":                _str(raw.get("status") or raw.get("situacao") or "") or None,
        "valor_total":           _float(raw.get("valor_total") or raw.get("total") or raw.get("totalValue") or 0),
        "observacoes":           _str(raw.get("observacoes") or raw.get("notes") or "") or None,
        "observacoes_pagamento": _str(raw.get("observacoes_pagamento") or raw.get("payment_notes") or "") or None,
        "id_contrato_origem":    _id(raw.get("id_contrato_origem") or raw.get("origin_contract_id")),
        "data_criacao":          _str(raw.get("data_criacao") or raw.get("created_at") or "") or None,
        "data_atualizacao":      _str(raw.get("data_atualizacao") or raw.get("updated_at") or "") or None,
        "synced_at":             datetime.now(timezone.utc),
    }


def _map_item_contrato(item: Dict[str, Any], contrato_id: str, index: int) -> Dict[str, Any]:
    produto = item.get("produto") or item.get("product") or {}
    if isinstance(produto, str):
        produto = {"id": produto}

    item_id = _str(item.get("id") or item.get("uuid") or "")
    if not item_id:
        item_id = f"{contrato_id}_{index}"

    return {
        "id":             item_id,
        "contrato_id":    contrato_id,
        "produto_id":     _id(produto),
        "descricao":      _str(item.get("descricao") or item.get("description") or "") or None,
        "quantidade":     _float(item.get("quantidade") or item.get("quantity") or 1),
        "valor_unitario": _float(item.get("valor_unitario") or item.get("unit_price") or item.get("price") or 0),
        "valor_desconto": _float(item.get("valor_desconto") or item.get("discount") or 0),
        "valor_total":    _float(item.get("valor_total") or item.get("total") or 0),
        "tipo":           _str(item.get("tipo") or item.get("type") or "") or None,
        "synced_at":      datetime.now(timezone.utc),
    }


# ── Função pública ────────────────────────────────────────────────────────────

def sync_contratos(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
    mode: str = "incremental",
) -> int:
    """
    Sincroniza contratos e seus itens.
    Retorna total de contratos sincronizados.
    """
    api_path = "/contratos"
    log_id = log_sync_start(conn, api_path)
    records = 0

    try:
        params = _get_sync_params(mode)
        if not client.probe(api_path):
            logger.info("sync_contratos: endpoint /contratos indisponivel (404), pulando.")
            log_sync_end(conn, log_id, 0, status="ok")
            return 0
        raw_list = client.get_all(api_path, extra_params=params)

        contratos_mapped: List[Dict[str, Any]] = []
        itens_mapped:     List[Dict[str, Any]] = []

        for raw in raw_list:
            if not isinstance(raw, dict):
                continue

            row = _map_contrato(raw)
            if not row.get("id"):
                continue

            contratos_mapped.append(row)

            # Extrai itens do contrato
            itens_raw = raw.get("itens") or raw.get("items") or []
            for idx, item in enumerate(itens_raw):
                if not isinstance(item, dict):
                    continue
                item_row = _map_item_contrato(item, row["id"], idx)
                itens_mapped.append(item_row)

        # Upsert contratos
        if contratos_mapped:
            records = upsert(conn, "ca.contratos", contratos_mapped, conflict_col="id")
            conn.commit()
            logger.info("%-30s -> %d contrato(s) em ca.contratos", api_path, records)
        else:
            logger.warning("Nenhum contrato válido retornado de %s", api_path)

        # Upsert itens
        if itens_mapped:
            itens_count = upsert(conn, "ca.itens_contrato", itens_mapped, conflict_col="id")
            conn.commit()
            logger.info("%-30s -> %d item(ns) em ca.itens_contrato", api_path, itens_count)

        log_sync_end(conn, log_id, records, status="ok")

    except Exception as exc:
        conn.rollback()
        logger.error("Erro em %s: %s", api_path, exc)
        log_sync_end(conn, log_id, records, status="erro", error_msg=str(exc))

    return records
