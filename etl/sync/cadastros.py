"""
etl/sync/cadastros.py
Sincroniza tabelas de cadastro (sem filtro de data):
  - /v1/categorias         → ca.categorias
  - /v1/centros-de-custo   → ca.centros_custo
  - /v1/contas-financeiras → ca.contas_financeiras
  - /v1/produtos           → ca.produtos
  - saldo atual            → ca.contas_financeiras.saldo_atual
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

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


# ── Mapeadores ────────────────────────────────────────────────────────────────

def _map_categoria(raw: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id":               _str(raw.get("id") or raw.get("uuid") or ""),
        "nome":             _str(raw.get("name") or raw.get("nome") or ""),
        "tipo":             _str(raw.get("type") or raw.get("tipo") or ""),
        "categoria_dre":    _str(raw.get("dre_category") or raw.get("categoria_dre") or ""),
        "categoria_pai_id": _str(raw.get("parent_id") or raw.get("categoria_pai_id") or "") or None,
        "ativo":            bool(raw.get("active", raw.get("ativo", True))),
    }


def _map_centro_custo(raw: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id":     _str(raw.get("id") or raw.get("uuid") or ""),
        "nome":   _str(raw.get("name") or raw.get("nome") or ""),
        "codigo": _str(raw.get("code") or raw.get("codigo") or "") or None,
        "ativo":  bool(raw.get("active", raw.get("ativo", True))),
    }


def _map_conta_financeira(raw: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id":            _str(raw.get("id") or raw.get("uuid") or ""),
        "nome":          _str(raw.get("name") or raw.get("nome") or ""),
        "tipo":          _str(raw.get("type") or raw.get("tipo") or ""),
        "banco":         _str(raw.get("bank") or raw.get("banco") or ""),
        "agencia":       _str(raw.get("agency") or raw.get("agencia") or "") or None,
        "numero_conta":  _str(raw.get("account_number") or raw.get("numero_conta") or "") or None,
        "saldo_inicial": _float(raw.get("initial_balance") or raw.get("initialBalance") or raw.get("saldo_inicial") or 0),
        "ativo":         bool(raw.get("active", raw.get("ativo", True))),
    }


def _map_produto(raw: Dict[str, Any]) -> Dict[str, Any]:
    cat = raw.get("category") or raw.get("categoria") or {}
    if isinstance(cat, str):
        cat = {}
    return {
        "id":             _str(raw.get("id") or raw.get("uuid") or ""),
        "nome":           _str(raw.get("name") or raw.get("nome") or ""),
        "codigo":         _str(raw.get("code") or raw.get("codigo") or "") or None,
        "tipo":           _str(raw.get("type") or raw.get("tipo") or "") or None,
        "preco_venda":    _float(raw.get("value") or raw.get("price") or raw.get("preco_venda") or 0),
        "custo_unitario": _float(raw.get("cost") or raw.get("custo_unitario") or 0),
        "estoque_atual":  _float(raw.get("stock") or raw.get("estoque_atual") or 0),
        "unidade":        _str(raw.get("unit") or raw.get("unidade") or "") or None,
        "categoria_id":   _str(cat.get("id") or "") or None,
        "ativo":          bool(raw.get("active", raw.get("ativo", True))),
        "data_criacao":   _str(raw.get("created_at") or raw.get("data_criacao") or "") or None,
        "data_alteracao": _str(raw.get("updated_at") or raw.get("data_alteracao") or "") or None,
        "ncm":            _str(raw.get("ncm") or "") or None,
        "origem":         _str(raw.get("origin") or raw.get("origem") or "") or None,
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

def sync_categorias(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
) -> int:
    totals = 0
    for tipo in ["RECEITA", "DESPESA"]:
        totals += _sync_endpoint(conn, client, f"/categorias?tipo={tipo}", "ca.categorias", _map_categoria)
    return totals


def sync_centros_custo(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
) -> int:
    return _sync_endpoint(conn, client, "/centro-de-custo", "ca.centros_custo", _map_centro_custo)


def sync_contas_financeiras(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
) -> int:
    return _sync_endpoint(conn, client, "/conta-financeira", "ca.contas_financeiras", _map_conta_financeira)


def sync_produtos(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
) -> int:
    return _sync_endpoint(conn, client, "/produtos", "ca.produtos", _map_produto)


def sync_saldo_contas(
    conn: psycopg2.extensions.connection,
    client: ContaAzulClient,
) -> int:
    """
    Para cada conta financeira ativa no banco, chama
    GET /conta-financeira/{id}/saldo e atualiza saldo_atual
    e data_ultima_conciliacao em ca.contas_financeiras.
    """
    log_id = log_sync_start(conn, "/conta-financeira/{id}/saldo")
    records = 0

    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM ca.contas_financeiras WHERE ativo = true")
            contas = [row[0] for row in cur.fetchall()]

        hoje = datetime.now(timezone.utc).date()

        for conta_id in contas:
            try:
                resp = client.get(f"/conta-financeira/{conta_id}/saldo")
                saldo = None

                if isinstance(resp, dict):
                    saldo = (
                        resp.get("saldo")
                        or resp.get("balance")
                        or resp.get("saldo_atual")
                        or resp.get("current_balance")
                    )

                if saldo is not None:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE ca.contas_financeiras
                               SET saldo_atual             = %s,
                                   data_ultima_conciliacao = %s,
                                   synced_at               = %s
                             WHERE id = %s
                            """,
                            (_float(saldo), hoje, datetime.now(timezone.utc), str(conta_id)),
                        )
                    conn.commit()
                    records += 1
                    logger.info(
                        "%-30s -> saldo R$ %.2f atualizado para conta %s",
                        "/conta-financeira/{id}/saldo",
                        _float(saldo),
                        conta_id,
                    )
                else:
                    logger.warning("Saldo não retornado para conta %s", conta_id)

            except Exception as exc:
                conn.rollback()
                logger.warning("Erro ao buscar saldo da conta %s: %s", conta_id, exc)

        log_sync_end(conn, log_id, records, status="ok")

    except Exception as exc:
        conn.rollback()
        logger.error("Erro em sync_saldo_contas: %s", exc)
        log_sync_end(conn, log_id, records, status="erro", error_msg=str(exc))

    return records
