import type { Lancamento } from '@/lib/types'

/**
 * Facetas dos filtros (categorias/CC/situações) + total — extraído de
 * components/dashboard/FilterBar.tsx. Deriva do `allData` do período (sem os 5
 * filtros), igual ao dash hoje. `contas` vem de fetchContas (lista global).
 */
export interface FacetsAgg {
  categorias: string[]
  centrosCusto: string[]
  situacoes: string[]
  contas: string[]
  total: number
}

export function aggFacets(allData: Lancamento[], contas: string[]): FacetsAgg {
  const cat = new Set<string>()
  const cc = new Set<string>()
  const sit = new Set<string>()
  for (const r of allData) {
    for (const c of r.categorias) if (c.nome && c.nome !== '(em branco)') cat.add(c.nome)
    for (const c of r._ccList)    if (c.nome && c.nome !== '(em branco)') cc.add(c.nome)
    if (r.situacao && r.situacao !== '(em branco)') sit.add(r.situacao)
  }
  return {
    categorias: Array.from(cat).sort(),
    centrosCusto: Array.from(cc).sort(),
    situacoes: Array.from(sit).sort(),
    contas: [...contas].sort(),
    total: allData.length,
  }
}
