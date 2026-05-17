import os
import logging
from dotenv import load_dotenv
load_dotenv()
from etl.db import get_connection

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("migration")

def migrate():
    conn = get_connection()
    conn.autocommit = True
    with conn.cursor() as cur:
        logger.info("Adicionando colunas extras em ca.produtos...")
        # id_servico, tipo_servico, codigo_cnae, lei_116, codigo_municipio_servico
        try:
            cur.execute("""
                ALTER TABLE ca.produtos 
                ADD COLUMN IF NOT EXISTS id_servico bigint,
                ADD COLUMN IF NOT EXISTS tipo_servico text,
                ADD COLUMN IF NOT EXISTS codigo_cnae text,
                ADD COLUMN IF NOT EXISTS lei_116 text,
                ADD COLUMN IF NOT EXISTS codigo_municipio_servico text;
            """)
            logger.info("  [OK] Colunas adicionadas em ca.produtos.")
        except Exception as e:
            logger.error("  [ERRO] ca.produtos: %s", e)

        logger.info("Adicionando colunas extras em ca.notas_fiscais...")
        # contrato_id, numero_venda, numero_rps, numero_nfse, data_competencia, nome_cliente
        try:
            cur.execute("""
                ALTER TABLE ca.notas_fiscais 
                ADD COLUMN IF NOT EXISTS contrato_id uuid,
                ADD COLUMN IF NOT EXISTS numero_venda text,
                ADD COLUMN IF NOT EXISTS numero_rps integer,
                ADD COLUMN IF NOT EXISTS numero_nfse integer,
                ADD COLUMN IF NOT EXISTS data_competencia date,
                ADD COLUMN IF NOT EXISTS nome_cliente text;
            """)
            logger.info("  [OK] Colunas adicionadas em ca.notas_fiscais.")
        except Exception as e:
            logger.error("  [ERRO] ca.notas_fiscais: %s", e)

    conn.close()
    logger.info("Migração concluída.")

if __name__ == "__main__":
    migrate()
