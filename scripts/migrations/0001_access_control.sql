-- ============================================================================
-- Migration 0001 — Controle de acesso por tela (Fase 1)
-- ============================================================================
-- Adiciona is_admin + telas_permitidas em ca.usuarios_dashboard.
--
-- IDEMPOTENTE: pode rodar mais de uma vez sem efeito colateral.
--   - ADD COLUMN IF NOT EXISTS
--   - backfill só preenche quem está com array vazio (não sobrescreve
--     permissões já curadas por um admin pela UI)
--   - seed via UPSERT (ON CONFLICT email)
--
-- ⚠️ RODAR ANTES DO DEPLOY DO CÓDIGO desta fase. O código novo (auth.ts) passa
--    a ler is_admin/telas_permitidas do banco; sem estas colunas, o login quebra.
--
-- Como rodar:
--   psql "$DATABASE_URL" -f scripts/migrations/0001_access_control.sql
--
-- A lista de telas abaixo DEVE espelhar lib/screens.ts (SCREENS).
-- ============================================================================

BEGIN;

-- 1. Colunas (idempotente) -----------------------------------------------------
ALTER TABLE ca.usuarios_dashboard
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

ALTER TABLE ca.usuarios_dashboard
  ADD COLUMN IF NOT EXISTS telas_permitidas text[] NOT NULL DEFAULT '{}';

-- 2. Backfill crítico — preserva o acesso atual -------------------------------
-- Todos os usuários JÁ existentes recebem TODAS as telas (ninguém perde acesso
-- no deploy). Só toca quem está com array vazio/NULL → idempotente e não
-- sobrescreve curadoria posterior.
UPDATE ca.usuarios_dashboard
SET telas_permitidas = ARRAY[
      'visao_geral','dre','centros_custo','comparativo','qualidade_insights',
      'lancamentos','metas','notas_fiscais','acesso'
    ]
WHERE telas_permitidas IS NULL
   OR cardinality(telas_permitidas) = 0;

-- 3. Seed dos admins atuais (UPSERT idempotente) ------------------------------
-- Preserva os 3 admins hardcoded que serão removidos do código (auth.ts):
-- felipe, giovani.maia e ti.bh. Todos viram is_admin=true + todas as telas.
-- Decisão confirmada com o time: "seed os 3 como admin" (ninguém perde acesso).
INSERT INTO ca.usuarios_dashboard (nome, email, ativo, is_admin, telas_permitidas)
VALUES
  ('Felipe Saman',  'felipe@v4company.com',       true, true, ARRAY[
      'visao_geral','dre','centros_custo','comparativo','qualidade_insights',
      'lancamentos','metas','notas_fiscais','acesso']),
  ('Giovani Maia',  'giovani.maia@v4company.com',  true, true, ARRAY[
      'visao_geral','dre','centros_custo','comparativo','qualidade_insights',
      'lancamentos','metas','notas_fiscais','acesso']),
  ('TI BH',         'ti.bh@v4company.com',         true, true, ARRAY[
      'visao_geral','dre','centros_custo','comparativo','qualidade_insights',
      'lancamentos','metas','notas_fiscais','acesso'])
ON CONFLICT (email) DO UPDATE
SET is_admin         = true,
    ativo            = true,
    telas_permitidas = ARRAY[
      'visao_geral','dre','centros_custo','comparativo','qualidade_insights',
      'lancamentos','metas','notas_fiscais','acesso'];

COMMIT;

-- Verificação rápida (opcional):
-- SELECT email, ativo, is_admin, telas_permitidas FROM ca.usuarios_dashboard ORDER BY is_admin DESC, email;
