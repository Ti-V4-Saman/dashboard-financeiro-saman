"""
etl/sync/pessoas.py
Sincroniza clientes e fornecedores em ca.pessoas.
  - /v1/clientes      → ca.pessoas com papel='CLIENTE'
  - /v1/fornecedores  → ca.pessoas com papel='FORNECEDOR'
"""

import logging
from typing import Any, Dict, List

import psycopg2.extensions

from etl.client import ContaAzulClient
from etl.db import log_sync_end, log_sync_start, upsert

logger = logging.getLogger(__name__)


def _extract_phone(raw: Dict[str, Any]) -> str:
    """Extrai primeiro telefone de formatos variados."""
    phones = (
        raw.get("phoneNumbers")
        or raw.get("phone_numbers")
        or raw.get("telefones")
        or []
    )
    if isinstance(phones, list) and phones:
        first = phones[0]
        if isinstance(first, dict):
            return str(first.get("number") or first.get("numero") or "")
        return str(first)
    return str(raw.get("phone") or raw.get("telefone") or "")


def _map_pessoa(raw: Dict[str, Any], papel: str) -> Dict[str, Any]:
    return {
        "id":           str(raw.get("id") or raw.get("uuid") or ""),
        "papel":        papel,
        "nome":         str(raw.get("name") or raw.get("nome") or ""),
        "email":        str(raw.get("email") or ""),
        "documento":    str(raw.get("document") or raw.get("cpf") or raw.get("cnpj") or ""),
        "tipo_pessoa":  str(raw.get("personType") or raw.get("person_type") or raw.get("tipo") or ""),
        "telefone":     _extract_phone(raw),
        "cidade":       str(
            (raw.get("address") or {}).get("city")
            or raw.get("cidade")
            or ""
        ),
        "ativo":        bool(raw.get("active", raw.get("ativo", True))),
        "payload_json": raw,
    }


def _sync_papel(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
    api_path: str,
    papel: str,
) -> int:
    log_id = log_sync_start(conn, api_path)
    records = 0

    try:
        raw_list = client.get_all(api_path)
        mapped: List[Dict[str, Any]] = []

        for raw in raw_list:
            if not isinstance(raw, dict):
                continue
            row = _map_pessoa(raw, papel)
            if not row["id"]:
                continue
            mapped.append(row)

        if mapped:
            records = upsert(conn, "ca.pessoas", mapped, conflict_col="id")
            conn.commit()
            logger.info("✓ %-30s → %d pessoa(s) [%s] em ca.pessoas", api_path, records, papel)
        else:
            logger.warning("Nenhum registro válido retornado de %s", api_path)

        log_sync_end(conn, log_id, records, status="ok")

    except Exception as exc:
        conn.rollback()
        logger.error("✗ Erro em %s: %s", api_path, exc)
        log_sync_end(conn, log_id, records, status="erro", error_msg=str(exc))

    return records


def sync_clientes(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
) -> int:
    return _sync_papel(conn, client, "/v1/clientes", "CLIENTE")


def sync_fornecedores(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
) -> int:
    return _sync_papel(conn, client, "/v1/fornecedores", "FORNECEDOR")
