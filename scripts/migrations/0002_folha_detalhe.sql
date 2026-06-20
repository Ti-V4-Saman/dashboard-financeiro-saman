-- ============================================================================
-- Migration 0002 — Permissão de folha detalhada (Fase 2)
-- ============================================================================
-- Adiciona ver_folha_detalhe em ca.usuarios_dashboard.
--
-- Regra: agregados (somas) sempre mostram folha (números corretos). O sensível
-- é o DETALHE por fornecedor/cliente, que só aparece em Lançamentos. Quem não
-- tem ver_folha_detalhe vê as linhas de folha com fornecedor/descrição
-- mascarados (valor mantido). Admin sempre vê (resolvido no código).
--
-- IDEMPOTENTE: roda mais de uma vez sem efeito colateral.
--
-- ⚠️ RODAR ANTES DO DEPLOY DO CÓDIGO. lib/access.ts passa a SELECionar esta
--    coluna; como o caminho é fail-closed, coluna ausente derruba o acesso.
--
-- Como rodar:
--   psql "$DATABASE_URL" -f scripts/migrations/0002_folha_detalhe.sql
-- ============================================================================

BEGIN;

ALTER TABLE ca.usuarios_dashboard
  ADD COLUMN IF NOT EXISTS ver_folha_detalhe boolean NOT NULL DEFAULT false;

-- Admins sempre veem folha detalhada (o código também força true para admin;
-- o backfill alinha o estado persistido para auditoria).
UPDATE ca.usuarios_dashboard
SET ver_folha_detalhe = true
WHERE is_admin = true AND ver_folha_detalhe IS DISTINCT FROM true;

COMMIT;

-- Verificação:
-- SELECT email, is_admin, ver_folha_detalhe FROM ca.usuarios_dashboard ORDER BY is_admin DESC, email;
