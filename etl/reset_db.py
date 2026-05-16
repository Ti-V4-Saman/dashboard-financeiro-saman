#!/usr/bin/env python3
"""
etl/reset_db.py
Script para apagar todos os dados das tabelas sincronizadas do ContaAzul.
"""

import os
import logging
import psycopg2
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("etl.reset")

# Ordem: tabelas filhas (que dependem de outras) PRIMEIRO, tabelas pai por último.
# Assim as FK constraints não bloqueiam o TRUNCATE.
TABLES_IN_ORDER = [
    # Filhas de vendas
    "ca.itens_venda",
    "ca.notas_fiscais",
    # Filhas de contas_receber / contas_pagar
    "ca.parcelas_receber",
    "ca.parcelas_pagar",
    "ca.baixas",
    # Filhas de contas_financeiras
    "ca.transferencias",
    # Contratos
    "ca.contratos",
    # Financeiro principal
    "ca.contas_receber",
    "ca.contas_pagar",
    "ca.vendas",
    # Pessoas
    "ca.pessoas",
    # Cadastros base
    "ca.categorias",
    "ca.centros_custo",
    "ca.contas_financeiras",
    "ca.produtos",
    # Log
    "ca.sync_log",
]


def reset():
    url = os.environ.get("DATABASE_URL")
    if not url:
        logger.error("DATABASE_URL não encontrada no ambiente.")
        return

    if "sslmode" not in url:
        sep = "&" if "?" in url else "?"
        url = url + f"{sep}sslmode=require"

    try:
        conn = psycopg2.connect(url)
        conn.autocommit = True
        with conn.cursor() as cur:
            logger.info("Iniciando limpeza do banco de dados...")
            for table in TABLES_IN_ORDER:
                try:
                    cur.execute(f"TRUNCATE TABLE {table} RESTART IDENTITY CASCADE;")
                    logger.info("  [OK] Tabela %s limpa.", table)
                except Exception as e:
                    # Se a tabela nao existir ainda, apenas avisa e continua
                    logger.warning("  [SKIP] Tabela %s nao encontrada ou erro: %s", table, e)

            logger.info("Limpeza concluida com sucesso!")
        conn.close()
    except Exception as exc:
        logger.error("Falha fatal ao conectar ou resetar o banco: %s", exc)


if __name__ == "__main__":
    confirm = input("Isso ira APAGAR TODOS os dados das tabelas do ContaAzul. Tem certeza? (s/N): ")
    if confirm.lower() == 's':
        reset()
    else:
        logger.info("Operacao cancelada.")
