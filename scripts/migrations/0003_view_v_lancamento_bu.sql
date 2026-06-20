-- ============================================================================
-- Migration 0003 — View ca.v_lancamento_bu (classificação por Business Unit)
-- ============================================================================
-- Classifica cada lançamento (UNION de contas_receber + contas_pagar) em uma
-- das 4 BUs:
--   - 'operacao'        — delivery + renovação/expansão + overhead + default
--   - 'receita'         — aquisição, ISAAS, despesas comerciais, deduções,
--                         CCs 1.7 / 2.3 / 2.4
--   - 'nao_operacional' — depreciação (5.x), financeiras (6.x), impostos s/
--                         lucro (7.x)
--   - 'sem_categoria'   — sinal de erro de ETL (lançamento sem categoria)
--
-- Regra: CATEGORIA vence CC (precedência por código). Default = 'operacao'.
-- NADA fica oculto — todo lançamento recebe um valor.
--
-- IDEMPOTENTE: CREATE OR REPLACE. ETL não escreve nessa view (por construção).
-- Ajustes futuros: incrementar o número da migration, novo CREATE OR REPLACE.
--
-- Como rodar:
--   psql "$DATABASE_URL" -f scripts/migrations/0003_view_v_lancamento_bu.sql
--
-- Smoke após rodar:
--   SELECT bu, tipo_origem, COUNT(*)
--   FROM ca.v_lancamento_bu
--   GROUP BY 1, 2
--   ORDER BY 1, 2;
--
-- Distribuição esperada (validada 2026-06-20):
--   operacao         5.070 (3.099 pagar + 1.971 receber)
--   receita          2.236 (1.754 pagar +   482 receber)
--   nao_operacional  1.724 (1.679 pagar +    45 receber)
--   sem_categoria        0
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW ca.v_lancamento_bu AS
SELECT
  l.id_lancamento,
  l.tipo_origem,  -- 'receber' | 'pagar'
  CASE
    -- Sinal de erro de ETL: lançamento sem categoria
    WHEN cat.nome IS NULL THEN 'sem_categoria'

    -- Receita por CATEGORIA (precedência máxima)
    WHEN cat.nome LIKE '2.%'   THEN 'receita'  -- deduções inteiras
    WHEN cat.nome LIKE '3.2.%' THEN 'receita'  -- ISAAS
    WHEN cat.nome LIKE '4.1.%' THEN 'receita'  -- despesas comerciais

    -- Receita por CC (códigos 1.7, 2.3, 2.4 — Felipe 2026-06-20)
    WHEN cc.codigo ~ '^2\.3([.]|$)' THEN 'receita'  -- Receita - Aquisição
    WHEN cc.codigo ~ '^2\.4([.]|$)' THEN 'receita'  -- Receita - Vendas Isaas
    WHEN cc.codigo ~ '^1\.7([.]|$)' THEN 'receita'  -- Receita - Expansão

    -- Não Operacional (abaixo do EBITDA)
    WHEN cat.nome LIKE '5.%' THEN 'nao_operacional'
    WHEN cat.nome LIKE '6.%' THEN 'nao_operacional'
    WHEN cat.nome LIKE '7.%' THEN 'nao_operacional'

    -- Default
    ELSE 'operacao'
  END AS bu
FROM (
  SELECT id AS id_lancamento, categoria_id, centro_custo_id, 'receber'::text AS tipo_origem
    FROM ca.contas_receber
  UNION ALL
  SELECT id, categoria_id, centro_custo_id, 'pagar'::text
    FROM ca.contas_pagar
) l
LEFT JOIN ca.categorias    cat ON cat.id = l.categoria_id
LEFT JOIN ca.centros_custo cc  ON cc.id  = l.centro_custo_id;

COMMENT ON VIEW ca.v_lancamento_bu IS
  'Classifica cada lançamento (UNION contas_receber + contas_pagar) em uma BU '
  '(operacao | receita | nao_operacional | sem_categoria). Regra: categoria '
  'vence CC. Default operacao. ETL não escreve.';

COMMIT;
