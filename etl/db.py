"""
etl/db.py
Conexão PostgreSQL (Neon) e funções de UPSERT e sync_log.
"""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import psycopg2
import psycopg2.extras

logger = logging.getLogger(__name__)


# ── Conexão ───────────────────────────────────────────────────────────────────

def get_connection() -> psycopg2.extensions.connection:
    """
    Cria conexão com o banco a partir de DATABASE_URL.
    Garante sslmode=require (obrigatório para Neon).
    """
    url = os.environ["DATABASE_URL"]
    if "sslmode" not in url:
        sep = "&" if "?" in url else "?"
        url = url + f"{sep}sslmode=require"

    try:
        conn = psycopg2.connect(url)
        conn.autocommit = False
        logger.debug("Conexão PostgreSQL estabelecida")
        return conn
    except psycopg2.OperationalError as exc:
        raise RuntimeError(f"Falha ao conectar ao PostgreSQL: {exc}") from exc


# ── UPSERT genérico ───────────────────────────────────────────────────────────

def upsert(
    conn: psycopg2.extensions.connection,
    table: str,
    rows: List[Dict[str, Any]],
    conflict_col: str = "id",
) -> int:
    """
    Faz INSERT ... ON CONFLICT (conflict_col) DO UPDATE SET ... para cada linha.

    Args:
        conn:         Conexão psycopg2 (autocommit=False — caller faz commit).
        table:        Nome qualificado da tabela, ex: "ca.categorias".
        rows:         Lista de dicts. Todas as chaves viram colunas.
        conflict_col: Coluna de unicidade para o ON CONFLICT.

    Returns:
        Número de linhas processadas.

    Atenção:
        - Valores de tipo dict/list são serializados como JSON automaticamente.
        - Colunas são derivadas das chaves do PRIMEIRO dict da lista.
          Todos os dicts devem ter o mesmo conjunto de chaves.
    """
    if not rows:
        return 0

    # Derivar colunas do primeiro registro
    columns = list(rows[0].keys())

    # Garantir que conflict_col está nas colunas
    if conflict_col not in columns:
        raise ValueError(
            f"Coluna de conflito '{conflict_col}' não encontrada nos dados. "
            f"Colunas disponíveis: {columns}"
        )

    # Colunas que serão atualizadas (excluir a de conflito)
    update_cols = [c for c in columns if c != conflict_col]

    col_list    = ", ".join(columns)
    ph_list     = ", ".join(["%s"] * len(columns))
    update_set  = ", ".join([f"{c} = EXCLUDED.{c}" for c in update_cols])

    sql = (
        f"INSERT INTO {table} ({col_list}) VALUES ({ph_list}) "
        f"ON CONFLICT ({conflict_col}) DO UPDATE SET {update_set}"
    )

    def _serialize(v: Any) -> Any:
        """Converte dict/list para string JSON (psycopg2 não faz isso automaticamente)."""
        if isinstance(v, (dict, list)):
            return json.dumps(v, ensure_ascii=False)
        return v

    tuples = [
        tuple(_serialize(row.get(c)) for c in columns)
        for row in rows
    ]

    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, sql, tuples, page_size=500)

    return len(rows)


# ── sync_log ──────────────────────────────────────────────────────────────────

def log_sync_start(
    conn: psycopg2.extensions.connection,
    endpoint: str,
) -> int:
    """
    Insere linha em ca.sync_log com status='em_andamento'.
    Retorna o id gerado para posterior atualização.
    """
    sql = """
        INSERT INTO ca.sync_log (endpoint, iniciado_em, status)
        VALUES (%s, %s, 'em_andamento')
        RETURNING id
    """
    with conn.cursor() as cur:
        cur.execute(sql, (endpoint, _utcnow()))
    conn.commit()

    with conn.cursor() as cur:
        cur.execute("SELECT lastval()")
        row = cur.fetchone()
    conn.commit()
    return row[0] if row else -1


def log_sync_end(
    conn: psycopg2.extensions.connection,
    log_id: int,
    records: int,
    status: str = "ok",
    error_msg: Optional[str] = None,
) -> None:
    """Atualiza a linha de log com resultado final."""
    sql = """
        UPDATE ca.sync_log
        SET finalizado_em            = %s,
            registros_sincronizados  = %s,
            status                   = %s,
            mensagem_erro            = %s
        WHERE id = %s
    """
    with conn.cursor() as cur:
        cur.execute(sql, (_utcnow(), records, status, error_msg, log_id))
    conn.commit()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)
