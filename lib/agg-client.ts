'use client'

import type { Filters } from '@/lib/types'

/** Fetcher para os endpoints /api/agg/* (lança em erro HTTP → SWR aciona o estado de erro). */
export const aggFetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

/**
 * Serializa os filtros do dash para query string dos endpoints agregados.
 * Espelha exatamente lib/financeiro-filtros.parseFiltros (de/ate/regime + 5 filtros).
 */
export function buildAggQuery(filters: Filters, extra?: Record<string, string>): string {
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
