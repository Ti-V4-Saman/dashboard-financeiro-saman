'use client'

import { jsonFetcher, HttpError, isForbidden } from '@/lib/fetchJson'
import type { Filters } from '@/lib/types'

/**
 * Cliente HTTP dos endpoints agregados `/api/agg/*`.
 *
 * REAPROVEITA A INFRA EXISTENTE, não cria uma segunda.
 * O fetcher é o `jsonFetcher` de `lib/fetchJson.ts`, o mesmo que Metas,
 * Qualidade, VisaoGeral e BUs já usam desde o fix da tela branca. Consequência
 * direta e desejada:
 *
 *   • resposta não-OK  → lança `HttpError` (nunca vira `data` no SWR)
 *   • 403              → continua distinguível via `isForbidden(err)`
 *   • 500 / timeout / rede / JSON inválido → propagam como erro, NÃO viram
 *     objeto vazio. "Sem permissão" e "backend caiu" precisam de UI diferente.
 *   • sem retry aqui — quem decide política de retry é o SWR de cada tela
 *
 * NENHUM COMPONENTE ESTÁ LIGADO A ISTO NESTE BLOCO. O módulo existe para os
 * blocos seguintes; importá-lo não dispara request nenhum.
 */

/** Fetcher para os endpoints /api/agg/*. Lança HttpError em resposta não-OK. */
export const aggFetcher = jsonFetcher

// Reexportados para o consumidor não precisar importar de dois lugares ao
// tratar o erro que este fetcher lança.
export { HttpError, isForbidden }

/**
 * Serializa os filtros do dash na query string dos endpoints agregados.
 *
 * O formato (CSV por chave) espelha exatamente o que `parseFiltros` lê em
 * `lib/financeiro-filtros.ts` — os dois devem mudar juntos. Chaves com lista
 * vazia são omitidas para manter a URL (e a chave de cache do SWR) estável.
 */
export function buildAggQuery(
  filters: Filters,
  extra?: Record<string, string>,
): string {
  const p = new URLSearchParams()
  if (filters.dateFrom) p.set('de', filters.dateFrom)
  if (filters.dateTo)   p.set('ate', filters.dateTo)
  p.set('regime', filters.regime)
  if (filters.categoria.length) p.set('categoria', filters.categoria.join(','))
  if (filters.cc.length)        p.set('cc', filters.cc.join(','))
  if (filters.tipo)             p.set('tipo', filters.tipo)
  if (filters.situacao.length)  p.set('situacao', filters.situacao.join(','))
  if (filters.conta.length)     p.set('conta', filters.conta.join(','))
  if (extra) for (const [k, v] of Object.entries(extra)) p.set(k, v)
  return p.toString()
}
