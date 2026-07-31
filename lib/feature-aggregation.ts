/**
 * Feature flag da agregação server-side (Fase 2).
 *
 * Espelha o padrão já usado em `lib/auth-dev-bypass.ts`: um par server +
 * NEXT_PUBLIC, porque a decisão precisa ser tomada nos dois lados.
 *
 *   OFF (default) → comportamento histórico: `/api/financeiro` devolve o array
 *                   cru e a agregação acontece no browser.
 *   ON            → as telas acopladas consomem `/api/agg/*` (agregado e
 *                   guardado por tela); o array cru deixa de alimentá-las.
 *
 * POR QUE DUAS FUNÇÕES
 * `isAggBackendEnabled()` é lida pelos route handlers. `isAggClientEnabled()`
 * é lida pelos componentes, que precisam escolher QUAL endpoint chamar antes
 * de qualquer request — não dá para descobrir isso no servidor sem uma ida e
 * volta extra. Por isso o par.
 *
 * SOBRE EXPOR NO CLIENT
 * `NEXT_PUBLIC_AGG_BACKEND` é inlinada no bundle em tempo de build, ou seja,
 * é pública. Isso é aceitável **porque o valor não é sensível**: saber que a
 * agregação está ligada não concede acesso a nada. A autorização continua
 * inteira nos guards de `/api/agg/*` (requireScreen) e de `/api/financeiro`.
 * Ligar a flag no browser não abre porta nenhuma — no máximo faz o front
 * chamar um endpoint que responderá 403.
 *
 * ⚠️ Nunca colocar segredo em variável NEXT_PUBLIC_*.
 *
 * FAIL-SAFE
 * Comparação estrita com a string 'true'. Ausente, vazia, '1', 'TRUE', 'yes'
 * ou qualquer outro valor → **desligado**. Não existe caminho em que um valor
 * malformado ligue a agregação por acidente.
 *
 * ONDE PODE SER USADA
 *   - server: route handlers em app/api/** (nunca em componente client)
 *   - client: componentes 'use client' que escolhem o caminho de dados
 * Não usar em `lib/financeiro-query.ts` — aquela camada é agnóstica de flag
 * de propósito, para que os dois caminhos leiam exatamente os mesmos dados.
 */

/** Lado servidor — route handlers. Default OFF. */
export function isAggBackendEnabled(): boolean {
  return process.env.AGG_BACKEND === 'true'
}

/** Lado client — componentes escolhem o caminho de dados. Default OFF. */
export function isAggClientEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AGG_BACKEND === 'true'
}
