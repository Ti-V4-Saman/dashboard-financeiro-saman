#!/usr/bin/env python3
"""
etl/reset_db.py
Script para apagar todos os dados das tabelas sincronizadas do ContaAzul.
"""

import os
import logging
import psycopg2
from dotenv import load_dotenv

# Carregar .env
load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("etl.reset")

TABLES = [
    "ca.contas_receber",
    "ca.contas_pagar",
    "ca.vendas",
    "ca.pessoas",
    "ca.categorias",
    "ca.centros_custo",
    "ca.contas_financeiras",
    "ca.produtos",
    "ca.sync_log"
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
            # Desabilitar triggers temporariamente se necessário ou usar CASCADE
            # Como temos FKs, o ideal é TRUNCATE ... CASCADE ou apagar na ordem inversa
            
            # Ordem inversa de dependência (estimada)
            tables_to_clear = [
                "ca.contas_receber",
                "ca.contas_pagar",
                "ca.vendas",
                "ca.pessoas",
                "ca.categorias",
                "ca.centros_custo",
                "ca.contas_financeiras",
                "ca.produtos",
                "ca.sync_log"
            ]
            
            for table in tables_to_clear:
                try:
                    cur.execute(f"TRUNCATE TABLE {table} RESTART IDENTITY CASCADE;")
                    logger.info(f"✓ Tabela {table} limpa.")
                except Exception as e:
                    logger.error(f"✗ Erro ao limpar {table}: {e}")
            
            logger.info("Limpeza concluída com sucesso!")
        conn.close()
    except Exception as exc:
        logger.error(f"Falha fatal ao conectar ou resetar o banco: {exc}")

if __name__ == "__main__":
    confirm = input("Isso irá APAGAR TODOS os dados das tabelas do ContaAzul. Tem certeza? (s/N): ")
    if confirm.lower() == 's':
        reset()
    else:
        logger.info("Operação cancelada.")
