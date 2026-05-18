"""
etl/sync/pos_processamento.py
──────────────────────────────────────────────────────────────────────────────
Pós-processamento permanente: preenche campos derivados que a API ContaAzul
v2 não retorna diretamente na conta, mas que existem em outras entidades.

Deve rodar SEMPRE ao final do pipeline, depois de sync_baixas e sync_vendas.
Todos os UPDATEs são idempotentes (WHERE ... IS NULL).
"""

import logging

logger = logging.getLogger(__name__)


def executar_pos_processamento(conn) -> dict:
    """
    Roda os 3 UPDATEs de pós-processamento em ordem e loga quantas linhas
    cada um afetou.

    Dependências:
      - sync_baixas  deve ter rodado antes (UPDATE 1 e 2 lêem ca.baixas)
      - sync_vendas  deve ter rodado antes (UPDATE 3 lê ca.vendas)

    Idempotente: só preenche o que está NULL.
    Em caso de erro faz rollback e relança — o chamador decide se é fatal.
    """
    resultados: dict = {
        "data_recebimento": 0,
        "data_pagamento":   0,
        "id_venda":         0,
    }

    try:
        with conn.cursor() as cur:

            # ── UPDATE 1 — data_recebimento de contas_receber via baixas ─────
            cur.execute("""
                UPDATE ca.contas_receber cr
                SET data_recebimento = sub.ultima_baixa
                FROM (
                    SELECT evento_id, MAX(data_pagamento) AS ultima_baixa
                    FROM ca.baixas
                    GROUP BY evento_id
                ) sub
                WHERE cr.id = sub.evento_id
                  AND cr.data_recebimento IS NULL
            """)
            resultados["data_recebimento"] = cur.rowcount

            # ── UPDATE 2 — data_pagamento de contas_pagar via baixas ─────────
            cur.execute("""
                UPDATE ca.contas_pagar cp
                SET data_pagamento = sub.ultima_baixa
                FROM (
                    SELECT evento_id, MAX(data_pagamento) AS ultima_baixa
                    FROM ca.baixas
                    GROUP BY evento_id
                ) sub
                WHERE cp.id = sub.evento_id
                  AND cp.data_pagamento IS NULL
            """)
            resultados["data_pagamento"] = cur.rowcount

            # ── UPDATE 3 — id_venda cruzando descrição com ca.vendas.numero ──
            cur.execute(r"""
                UPDATE ca.contas_receber cr
                SET id_venda = v.id
                FROM ca.vendas v
                WHERE cr.id_venda IS NULL
                  AND cr.descricao ~ 'Venda [0-9]{1,7}(\s|$)'
                  AND v.numero = CAST(
                      (regexp_match(cr.descricao, 'Venda ([0-9]{1,7})'))[1] AS INTEGER
                  )
            """)
            resultados["id_venda"] = cur.rowcount

        conn.commit()

        logger.info(
            "Pós-processamento: data_recebimento=%d, data_pagamento=%d, id_venda=%d",
            resultados["data_recebimento"],
            resultados["data_pagamento"],
            resultados["id_venda"],
        )

    except Exception as exc:
        conn.rollback()
        logger.error("Erro no pós-processamento: %s", exc)
        raise

    return resultados
