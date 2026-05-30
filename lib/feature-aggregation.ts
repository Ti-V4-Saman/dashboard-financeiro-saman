/**
 * Feature flag da agregação server-side (Fase 2). Espelha o padrão de
 * lib/auth-dev-bypass.ts (par server + NEXT_PUBLIC).
 *
 * ON  → as telas acopladas consomem os endpoints /api/agg/* (agregado, guardado
 *       por requireScreen); o array cru de /api/financeiro deixa de ser usado.
 * OFF → comportamento histórico: array cru via useFinanceiro + agregação client.
 *
 * Default OFF (sem a env). Flip das duas envs reverte instantaneamente.
 */

/** Lado servidor — usado nos route handlers /api/agg/* e no fechamento do cru. */
export function isAggBackendEnabled(): boolean {
  return process.env.AGG_BACKEND === 'true'
}

/** Lado client — usado pelas telas/hooks para escolher o caminho de dados. */
export function isAggClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AGG_BACKEND === 'true'
}
