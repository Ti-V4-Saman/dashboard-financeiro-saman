#!/usr/bin/env python3
"""
etl/main.py
Orquestrador do pipeline ETL ContaAzul → PostgreSQL.
"""

import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any, List

# ── Carregar .env se existir (dev local) ──────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ── Configuração de logging ───────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s -- %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("etl.main")

# ── Imports internos ──────────────────────────────────────────────────────────
from etl.auth import get_access_token
from etl.client import ContaAzulClient
from etl.db import get_connection

from etl.sync.cadastros import (
    sync_categorias,
    sync_centros_custo,
    sync_contas_financeiras,
    sync_produtos,
    sync_saldo_contas,          # NOVO
)
from etl.sync.pessoas import sync_clientes, sync_fornecedores
from etl.sync.financeiro import (
    sync_contas_receber,
    sync_contas_pagar,
    sync_vendas,
    sync_parcelas,              # NOVO
    sync_transferencias,        # NOVO
    sync_baixas,                # NOVO
    sync_itens_venda,           # NOVO
    sync_notas_fiscais,         # NOVO
)
from etl.sync.contratos import sync_contratos  # NOVO


# ── Resultado de cada sync ────────────────────────────────────────────────────
class SyncResult:
    def __init__(self, name: str) -> None:
        self.name    = name
        self.records = 0
        self.ok      = False
        self.error   = ""

    def success(self, records: int) -> None:
        self.records = records
        self.ok      = True

    def fail(self, msg: str) -> None:
        self.ok    = False
        self.error = msg


def _run_safe(result: SyncResult, fn: Any, *args: Any) -> None:
    """Executa fn(*args), captura exceções e registra no SyncResult."""
    try:
        n = fn(*args)
        result.success(n)
    except Exception as exc:
        logger.error("✗ Falha em %s: %s", result.name, exc)
        result.fail(str(exc))


# ── Pipeline principal ────────────────────────────────────────────────────────

def run(full_sync: bool = False) -> bool:
    """
    Executa o pipeline completo.
    Retorna True se todos os syncs tiveram sucesso, False se algum falhou.
    """
    mode       = "full" if full_sync else "incremental"
    started_at = datetime.now(timezone.utc)

    logger.info("=" * 60)
    logger.info("INÍCIO DO ETL (%s) — %s", mode.upper(), started_at.strftime("%Y-%m-%d %H:%M:%S UTC"))
    logger.info("=" * 60)

    # ── 1. Autenticação ───────────────────────────────────────────────────────
    try:
        token = get_access_token()
    except Exception as exc:
        logger.critical("Falha fatal na autenticação: %s", exc)
        return False

    client = ContaAzulClient(token)

    # ── 2. Conexão com o banco ────────────────────────────────────────────────
    try:
        conn = get_connection()
    except Exception as exc:
        logger.critical("Falha fatal ao conectar ao banco: %s", exc)
        return False

    # ── 3. Lista de syncs (ordem respeita dependências de FK) ─────────────────
    syncs = [
        # ── Cadastros base (sem dependências de FK) ──
        ("categorias",         sync_categorias,         ()),
        ("centros_custo",      sync_centros_custo,      ()),
        ("contas_financeiras", sync_contas_financeiras, ()),
        ("produtos",           sync_produtos,           ()),
        # ── Pessoas (clientes + fornecedores) ──
        ("clientes",           sync_clientes,           ()),
        ("fornecedores",       sync_fornecedores,       ()),
        # ── Financeiro principal (depende de categorias, pessoas, contas) ──
        ("contas_receber",     sync_contas_receber,     (mode,)),
        ("contas_pagar",       sync_contas_pagar,       (mode,)),
        ("vendas",             sync_vendas,             (mode,)),
        # ── Dependentes de financeiro (precisam dos eventos criados acima) ──
        ("parcelas",           sync_parcelas,           (mode,)),
        ("transferencias",     sync_transferencias,     (mode,)),
        ("baixas",             sync_baixas,             (mode,)),
        ("itens_venda",        sync_itens_venda,        (mode,)),
        # ── Contratos e notas fiscais ──
        ("contratos",          sync_contratos,          (mode,)),
        ("notas_fiscais",      sync_notas_fiscais,      (mode,)),
        # ── Saldo atual (sempre por último — depende de tudo estar sincronizado) ──
        ("saldo_contas",       sync_saldo_contas,       ()),
    ]

    # ── 4. Executar cada sync (continua mesmo com falhas parciais) ────────────
    def _get_active_conn(c):
        try:
            with c.cursor() as cur:
                cur.execute("SELECT 1")
            return c
        except Exception:
            logger.warning("Reconectando ao banco...")
            return get_connection()

    results: List[SyncResult] = []
    current_conn = conn

    for name, fn, extra in syncs:
        r            = SyncResult(name)
        current_conn = _get_active_conn(current_conn)
        _run_safe(r, fn, current_conn, client, *extra)
        results.append(r)

    # ── 5. Fechar conexão ─────────────────────────────────────────────────────
    try:
        current_conn.close()
    except Exception:
        pass

    # ── 6. Resumo final ───────────────────────────────────────────────────────
    finished_at   = datetime.now(timezone.utc)
    duration_s    = (finished_at - started_at).total_seconds()
    all_ok        = all(r.ok for r in results)
    total_records = sum(r.records for r in results)

    logger.info("")
    logger.info("-" * 60)
    logger.info("  RESUMO DO ETL")
    logger.info("-" * 60)

    for r in results:
        mark   = "[OK]  " if r.ok else "[ERRO]"
        detail = f"{r.records} registro(s)" if r.ok else f"ERRO: {r.error[:80]}"
        logger.info("  %s  %-25s %s", mark, r.name, detail)

    logger.info("-" * 60)
    logger.info("  Total de registros sincronizados: %d", total_records)
    logger.info("  Duração: %.1fs", duration_s)
    logger.info("  Status:  %s", "SUCESSO" if all_ok else "COM FALHAS")
    logger.info("-" * 60)

    return all_ok


if __name__ == "__main__":
    is_full = "--full" in sys.argv or os.getenv("SYNC_MODE") == "full"
    ok      = run(full_sync=is_full)
    sys.exit(0 if ok else 1)
