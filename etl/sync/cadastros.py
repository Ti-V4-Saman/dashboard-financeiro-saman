"""
etl/sync/cadastros.py
Sincroniza tabelas de cadastro (sem filtro de data):
  - /v1/categorias         → ca.categorias
  - /v1/centros-de-custo   → ca.centros_custo
  - /v1/contas-financeiras → ca.contas_financeiras
  - /v1/produtos           → ca.produtos
"""

import logging
from typing import Any, Dict, List

import psycopg2.extensions

from etl.client import ContaAzulClient
from etl.db import log_sync_end, log_sync_start, upsert

logger = logging.getLogger(__name__)


# ── Mapeadores: normaliza o payload da API para as colunas da tabela ──────────

def _map_categoria(raw: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id":          str(raw.get("id") or raw.get("uuid") or ""),
        "nome":        str(raw.get("name") or raw.get("nome") or ""),
        "tipo":        str(raw.get("type") or raw.get("tipo") or ""),
        "ativo":       bool(raw.get("active", raw.get("ativo", True))),
        "payload_json": raw,
    }


def _map_centro_custo(raw: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id":          str(raw.get("id") or raw.get("uuid") or ""),
        "nome":        str(raw.get("name") or raw.get("nome") or ""),
        "ativo":       bool(raw.get("active", raw.get("ativo", True))),
        "payload_json": raw,
    }


def _map_conta_financeira(raw: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id":             str(raw.get("id") or raw.get("uuid") or ""),
        "nome":           str(raw.get("name") or raw.get("nome") or ""),
        "tipo":           str(raw.get("type") or raw.get("tipo") or ""),
        "banco":          str(raw.get("bank") or raw.get("banco") or ""),
        "saldo_inicial":  float(raw.get("initialBalance") or raw.get("saldo_inicial") or 0),
        "ativo":          bool(raw.get("active", raw.get("ativo", True))),
        "payload_json":   raw,
    }


def _map_produto(raw: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id":           str(raw.get("id") or raw.get("uuid") or ""),
        "nome":         str(raw.get("name") or raw.get("nome") or ""),
        "codigo":       str(raw.get("code") or raw.get("codigo") or ""),
        "preco":        float(raw.get("price") or raw.get("preco") or 0),
        "unidade":      str(raw.get("unit") or raw.get("unidade") or ""),
        "ativo":        bool(raw.get("active", raw.get("ativo", True))),
        "payload_json": raw,
    }


# ── Função genérica de sync ───────────────────────────────────────────────────

def _sync_endpoint(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
    api_path: str,
    table: str,
    mapper: Any,
) -> int:
    """Busca todos os registros de api_path, mapeia e faz UPSERT em table."""
    log_id = log_sync_start(conn, api_path)
    records = 0

    try:
        raw_list = client.get_all(api_path)
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


# ── Funções públicas ──────────────────────────────────────────────────────────

def sync_categorias(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
) -> int:
    return _sync_endpoint(conn, client, "/v1/categorias", "ca.categorias", _map_categoria)


def sync_centros_custo(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
) -> int:
    return _sync_endpoint(conn, client, "/v1/centros-de-custo", "ca.centros_custo", _map_centro_custo)


def sync_contas_financeiras(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
) -> int:
    return _sync_endpoint(conn, client, "/v1/contas-financeiras", "ca.contas_financeiras", _map_conta_financeira)


def sync_produtos(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
) -> int:
    return _sync_endpoint(conn, client, "/v1/produtos", "ca.produtos", _map_produto)
