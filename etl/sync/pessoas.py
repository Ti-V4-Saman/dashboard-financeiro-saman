"""
etl/sync/pessoas.py
Sincroniza clientes e fornecedores em ca.pessoas.
  - /v1/pessoas → ca.pessoas (clientes + fornecedores)
"""

import logging
from typing import Any, Dict, List

import psycopg2.extensions

from etl.client import ContaAzulClient
from etl.db import log_sync_end, log_sync_start, upsert

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _str(v: Any) -> str:
    return str(v) if v is not None else ""

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
            return _str(first.get("number") or first.get("numero") or "")
        return _str(first)
    return _str(raw.get("phone") or raw.get("telefone") or "")


# ── Mapeador ──────────────────────────────────────────────────────────────────

def _map_pessoa(raw: dict, papel_inicial: str) -> dict:
    perfis = raw.get("perfis") or raw.get("roles") or raw.get("papeis") or [papel_inicial]
    if not isinstance(perfis, list):
        perfis = [perfis]
    perfis = [_str(p).upper() for p in perfis]

    tipo = raw.get("tipo_pessoa") or raw.get("personType") or raw.get("tipo") or "LEGAL"
    if tipo.lower() in ("juridica", "jurídica"):
        tipo = "LEGAL"
    elif tipo.lower() in ("fisica", "física"):
        tipo = "NATURAL"

    telefone = _extract_phone(raw)

    endereco = raw.get("endereco") or raw.get("address") or {}
    if not isinstance(endereco, dict):
        endereco = {}

    return {
        "id":                 _str(raw.get("id") or raw.get("uuid") or ""),
        "nome":               _str(raw.get("nome") or raw.get("name") or ""),
        "tipo":               tipo,
        "papel":              perfis,
        "cpf_cnpj":           _str(raw.get("documento") or raw.get("document") or raw.get("cpf") or raw.get("cnpj") or ""),
        "email":              _str(raw.get("email") or ""),
        "telefone":           _str(raw.get("telefone") or telefone or ""),
        "celular":            _str(raw.get("celular") or raw.get("mobile_phone") or ""),
        "cidade":             _str(endereco.get("cidade") or endereco.get("city") or raw.get("cidade") or ""),
        "estado":             _str(endereco.get("estado") or endereco.get("state") or raw.get("estado") or "")[:2],
        "cep":                _str(endereco.get("cep") or endereco.get("zip_code") or raw.get("cep") or ""),
        "ativo":              bool(raw.get("ativo", raw.get("active", True))),
        # Campos novos
        "nome_fantasia":      _str(raw.get("nome_fantasia") or raw.get("trading_name") or "") or None,
        "inscricao_estadual": _str(raw.get("inscricao_estadual") or raw.get("state_registration") or "") or None,
        "logradouro":         _str(endereco.get("logradouro") or endereco.get("street") or "") or None,
        "numero_endereco":    _str(endereco.get("numero") or endereco.get("number") or "") or None,
        "complemento":        _str(endereco.get("complemento") or endereco.get("complement") or "") or None,
        "bairro":             _str(endereco.get("bairro") or endereco.get("neighborhood") or "") or None,
        "site":               _str(raw.get("site") or raw.get("website") or "") or None,
        "data_atualizacao":   _str(raw.get("data_atualizacao") or raw.get("updated_at") or "") or None,
    }


# ── Funções internas ──────────────────────────────────────────────────────────

def _sync_papel(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
    api_path: str,
    papel: str,
) -> int:
    log_id  = log_sync_start(conn, api_path)
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
    """Sincroniza TODAS as pessoas via /pessoas."""
    log_id  = log_sync_start(conn, "/pessoas")
    records = 0

    try:
        raw_list = client.get_all("/pessoas")
        mapped: List[Dict[str, Any]] = []

        for raw in raw_list:
            if not isinstance(raw, dict):
                continue
            perfis       = raw.get("perfis") or ["CLIENTE"]
            papel_inicial = _str(perfis[0]).upper() if perfis else "CLIENTE"
            row          = _map_pessoa(raw, papel_inicial)
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


# ── Funções públicas ──────────────────────────────────────────────────────────

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
    """Retorna 0 — já sincronizado junto com clientes via /pessoas."""
    logger.info("[SKIP] fornecedores já sincronizados junto com clientes via /pessoas")
    return 0
