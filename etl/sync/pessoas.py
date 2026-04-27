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


def _map_pessoa(raw: dict, papel_inicial: str) -> dict:
    # Campos reais retornados pela API v2 Bridge (descobertos em 2026-04-21)
    perfis = raw.get("perfis") or raw.get("roles") or raw.get("papeis") or [papel_inicial]
    if not isinstance(perfis, list):
        perfis = [perfis]
    # Normaliza para uppercase
    perfis = [str(p).upper() for p in perfis]

    tipo = raw.get("tipo_pessoa") or raw.get("personType") or raw.get("tipo") or "LEGAL"
    # Normaliza: "Juridica" -> "LEGAL", "Fisica" -> "NATURAL"
    if tipo.lower() in ("juridica", "jurídica"):
        tipo = "LEGAL"
    elif tipo.lower() in ("fisica", "física"):
        tipo = "NATURAL"

    telefone = _extract_phone(raw)

    return {
        "id":       str(raw.get("id") or raw.get("uuid") or ""),
        "nome":     str(raw.get("nome") or raw.get("name") or ""),
        "tipo":     tipo,
        "papel":    perfis,
        "cpf_cnpj": str(raw.get("documento") or raw.get("document") or raw.get("cpf") or raw.get("cnpj") or ""),
        "email":    str(raw.get("email") or ""),
        "telefone": str(raw.get("telefone") or telefone or ""),
        "celular":  str(raw.get("celular") or raw.get("mobile_phone") or ""),
        "cidade":   str((raw.get("endereco") or raw.get("address") or {}).get("cidade") or (raw.get("address") or {}).get("city") or raw.get("cidade") or ""),
        "estado":   str((raw.get("endereco") or raw.get("address") or {}).get("estado") or (raw.get("address") or {}).get("state") or raw.get("estado") or "")[:2],
        "cep":      str((raw.get("endereco") or raw.get("address") or {}).get("cep") or (raw.get("address") or {}).get("zip_code") or raw.get("cep") or ""),
        "ativo":    bool(raw.get("ativo", raw.get("active", True))),
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
            logger.info("[OK] %-30s -> %d pessoa(s) [%s] em ca.pessoas", api_path, records, papel)
        else:
            logger.warning("Nenhum registro válido retornado de %s", api_path)

        log_sync_end(conn, log_id, records, status="ok")

    except Exception as exc:
        conn.rollback()
        logger.error("Erro em %s: %s", api_path, exc)
        log_sync_end(conn, log_id, records, status="erro", error_msg=str(exc))

    return records


def _sync_pessoas_all(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
) -> int:
    """Sincroniza TODAS as pessoas (clientes + fornecedores) de uma só vez via /pessoas."""
    log_id = log_sync_start(conn, "/pessoas")
    records = 0

    try:
        raw_list = client.get_all("/pessoas")
        mapped = []

        for raw in raw_list:
            if not isinstance(raw, dict):
                continue
            # Detecta papel a partir dos perfis da API (usa os próprios dados)
            perfis = raw.get("perfis") or ["CLIENTE"]
            papel_inicial = str(perfis[0]).upper() if perfis else "CLIENTE"
            row = _map_pessoa(raw, papel_inicial)
            if not row["id"]:
                continue
            mapped.append(row)

        if mapped:
            records = upsert(conn, "ca.pessoas", mapped, conflict_col="id")
            conn.commit()
            logger.info("[OK] /pessoas -> %d pessoa(s) em ca.pessoas", records)
        else:
            logger.warning("Nenhum registro válido retornado de /pessoas")

        log_sync_end(conn, log_id, records, status="ok")

    except Exception as exc:
        conn.rollback()
        logger.error("Erro em /pessoas: %s", exc)
        log_sync_end(conn, log_id, records, status="erro", error_msg=str(exc))

    return records


def sync_clientes(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
) -> int:
    """Sincroniza todas as pessoas (clientes e fornecedores) do ContaAzul."""
    return _sync_pessoas_all(conn, client)


def sync_fornecedores(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
) -> int:
    """Retorna 0 para não duplicar a sync (já feita em sync_clientes)."""
    logger.info("[SKIP] fornecedores jah sincronizados junto com clientes via /pessoas")
    return 0
