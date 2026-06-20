-- ============================================================================
-- Migration 0004 — Adiciona slug 'bus' às permissões dos admins
-- ============================================================================
-- A tela BUs nasce restrita: só is_admin enxerga por padrão. Não-admins precisam
-- ser habilitados manualmente pela UI de Acesso (admin marca o checkbox).
--
-- Para admins, a lista de telas vem de ALL_SCREENS em lib/screens.ts em tempo
-- de execução (lib/access.ts:38) — esta migration é só para manter a coluna
-- coerente com o slug novo e para preservar a curadoria já feita.
--
-- IDEMPOTENTE: array_append condicional (NOT 'bus' = ANY(telas_permitidas)).
--
-- Como rodar:
--   psql "$DATABASE_URL" -f scripts/migrations/0004_add_screen_bus.sql
-- ============================================================================

BEGIN;

UPDATE ca.usuarios_dashboard
   SET telas_permitidas = array_append(telas_permitidas, 'bus')
 WHERE is_admin = true
   AND NOT ('bus' = ANY(telas_permitidas));

COMMIT;
