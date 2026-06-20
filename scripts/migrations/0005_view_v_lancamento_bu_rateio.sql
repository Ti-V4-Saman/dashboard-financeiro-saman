-- ============================================================================
-- Migration 0005 — View ca.v_lancamento_bu (deduções saem da BU Receita)
-- ============================================================================
-- Decisão Felipe (2026-06-20): deduções (cat 2.x) deixam de cair em BU
-- Receita por categoria. Lançamentos físicos passam a ficar em BU Operação
-- (via default). A API calcula o RATEIO proporcional à receita bruta de
-- cada BU operacional, gerando deducoes_X e receita_liquida_X corretos.
--
-- Razão: no CA, lançamentos de PIS/COFINS/ISS/DAS/CBS/IBS são agregados —
-- representam imposto sobre TODA a receita do mês (Aquisição + Renovação
-- + Expansão), não só sobre vendas da BU Receita. A regra anterior
-- subestimava a RL da BU Receita em ~40%.
--
-- IDEMPOTENTE: CREATE OR REPLACE. ETL não escreve.
--
-- Como rodar:
--   psql "$DATABASE_URL" -f scripts/migrations/0005_view_v_lancamento_bu_rateio.sql
--
-- Smoke após rodar:
--   SELECT bu, tipo_origem, COUNT(*)
--   FROM ca.v_lancamento_bu
--   GROUP BY 1, 2
--   ORDER BY 1, 2;
--
-- Esperado: cat 2.% deixa receita/pagar e entra em operacao/pagar.
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW ca.v_lancamento_bu AS
SELECT
  l.id_lancamento,
  l.tipo_origem,
  CASE
    WHEN cat.nome IS NULL THEN 'sem_categoria'

    -- Receita por CATEGORIA
    -- NOTA: cat 2.% (deduções) FOI REMOVIDA daqui em 0005.
    -- Deduções agora caem no default ('operacao') e são RATEADAS na API
    -- proporcionalmente à receita bruta de cada BU.
    WHEN cat.nome LIKE '3.2.%' THEN 'receita'  -- ISAAS
    WHEN cat.nome LIKE '4.1.%' THEN 'receita'  -- despesas comerciais

    -- Receita por CC (códigos 1.7, 2.3, 2.4)
    WHEN cc.codigo ~ '^2\.3([.]|$)' THEN 'receita'
    WHEN cc.codigo ~ '^2\.4([.]|$)' THEN 'receita'
    WHEN cc.codigo ~ '^1\.7([.]|$)' THEN 'receita'

    -- Não Operacional (abaixo do EBITDA)
    WHEN cat.nome LIKE '5.%' THEN 'nao_operacional'
    WHEN cat.nome LIKE '6.%' THEN 'nao_operacional'
    WHEN cat.nome LIKE '7.%' THEN 'nao_operacional'

    -- Default (inclui cat 2.% agora — rateado na API)
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
  '(operacao | receita | nao_operacional | sem_categoria). Categoria vence CC. '
  'Default operacao. Deduções (cat 2.%) caem em operacao desde 0005; a API '
  'rateia proporcionalmente à receita bruta de op + receita.';

COMMIT;
