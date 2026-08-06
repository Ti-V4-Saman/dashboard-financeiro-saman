-- ============================================================================
-- Migration 0006 — Origem da nota fiscal em ca.notas_fiscais
-- ============================================================================
-- Adiciona ca.notas_fiscais.escriturado_manualmente (boolean NULL).
--
-- Espelha o campo `escriturado_manualmente` de GET /v1/notas-fiscais-servico.
-- É ORIGEM, não status: uma nota pode ter status EMITIDA e origem
-- "escriturada manualmente" ao mesmo tempo. Os dois campos são independentes
-- e nenhum deve ser derivado do outro.
--
-- Interpretação dos três estados:
--   true  = escriturada manualmente (emitida fora do Conta Azul, só registrada lá)
--   false = emitida pelo Conta Azul
--   NULL  = origem não identificada
--
-- ⚠️ SEM DEFAULT, e é proposital. Registros que a API não devolve mais — como
--    a nota órfã nº 2438, PRONTA_ENVIO, que sumiu da listagem em 30/06/2026 —
--    ficariam marcados como "emitidas pelo Conta Azul" sem nenhuma evidência
--    se o default fosse false. NULL é a única resposta honesta para elas.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, pode rodar mais de uma vez.
--
-- ⚠️ RODAR ANTES DO DEPLOY DO MAPPER. O _map_nota_fiscal passa a emitir a
--    chave escriturado_manualmente, e o upsert deriva as colunas das chaves
--    do dict — sem esta coluna, o sync de notas fiscais quebra.
--
-- Como rodar:
--   psql "$DATABASE_URL" -f scripts/migrations/0006_notas_fiscais_escriturado_manualmente.sql
-- ============================================================================

ALTER TABLE ca.notas_fiscais
  ADD COLUMN IF NOT EXISTS escriturado_manualmente boolean;

COMMENT ON COLUMN ca.notas_fiscais.escriturado_manualmente IS
  'Origem da nota (independente do status). true = escriturada manualmente; '
  'false = emitida pelo Conta Azul; NULL = origem não identificada. '
  'Espelha escriturado_manualmente de /v1/notas-fiscais-servico. Sem default: '
  'notas que a API não retorna mais permanecem NULL.';

-- Índice parcial: a UI filtra por origem e o volume de escrituradas é baixo
-- (1 em 211 hoje), então só as linhas não-nulas precisam ser indexadas.
CREATE INDEX IF NOT EXISTS idx_notas_fiscais_escriturado_manualmente
  ON ca.notas_fiscais (escriturado_manualmente)
  WHERE escriturado_manualmente IS NOT NULL;
