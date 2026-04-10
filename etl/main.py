#!/usr/bin/env python3
"""
etl/main.py
Orquestrador do pipeline ETL ContaAzul → PostgreSQL.

Ordem de execução:
  1. Renova access_token via refresh_token
  2. Cadastros: categorias → centros_custo → contas_financeiras → produtos
  3. Pessoas:   clientes → fornecedores
  4. Financeiro: contas_receber → contas_pagar → vendas
  5. Imprime resumo final

Rodas: python -m etl.main  (a partir da raiz do projeto)
"""

import logging
import os
import sys
import time
from datetime import datetime, timezone

# ── Carregar .env se existir (dev local) ──────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # python-dotenv opcional; em produção usar variáveis do CI

# ── Configuração de logging ───────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("etl_run.log", encoding="utf-8"),
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
)
from etl.sync.pessoas import sync_clientes, sync_fornecedores
from etl.sync.financeiro import sync_contas_receber, sync_contas_pagar, sync_vendas


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
from typing import Any, List


def run() -> bool:
    """
    Executa o pipeline completo.
    Retorna True se todos os syncs tiveram sucesso, False se algum falhou.
    """
    started_at = datetime.now(timezone.utc)
    logger.info("=" * 60)
    logger.info("INÍCIO DO ETL — %s", started_at.strftime("%Y-%m-%d %H:%M:%S UTC"))
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

    # ── 3. Executar cada sync (continua mesmo com falhas parciais) ────────────
    results: List[SyncResult] = []

    syncs = [
        # (nome_legível,           função,                  args_extras)
        ("categorias",            sync_categorias,         ()),
        ("centros_custo",         sync_centros_custo,      ()),
        ("contas_financeiras",    sync_contas_financeiras, ()),
        ("produtos",              sync_produtos,           ()),
        ("clientes",              sync_clientes,           ()),
        ("fornecedores",          sync_fornecedores,       ()),
        ("contas_receber",        sync_contas_receber,     ()),
        ("contas_pagar",          sync_contas_pagar,       ()),
        ("vendas",                sync_vendas,             ()),
    ]

    for name, fn, extra in syncs:
        r = SyncResult(name)
        _run_safe(r, fn, conn, client, *extra)
        results.append(r)

    # ── 4. Fechar conexão ─────────────────────────────────────────────────────
    try:
        conn.close()
    except Exception:
        pass

    # ── 5. Resumo final ───────────────────────────────────────────────────────
    elapsed = time.monotonic()
    finished_at = datetime.now(timezone.utc)
    duration_s  = (finished_at - started_at).total_seconds()

    all_ok = all(r.ok for r in results)

    logger.info("")
    logger.info("─" * 60)
    logger.info("  RESUMO DO ETL")
    logger.info("─" * 60)

    total_records = 0
    for r in results:
        mark = "✓" if r.ok else "✗"
        detail = f"{r.records} registro(s)" if r.ok else f"ERRO: {r.error[:80]}"
        logger.info("  %s  %-25s %s", mark, r.name, detail)
        total_records += r.records

    logger.info("─" * 60)
    logger.info("  Total de registros sincronizados: %d", total_records)
    logger.info("  Duração: %.1fs", duration_s)
    logger.info("  Status:  %s", "✅ SUCESSO" if all_ok else "⚠️  COM FALHAS")
    logger.info("─" * 60)

    return all_ok


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    ok = run()
    sys.exit(0 if ok else 1)
