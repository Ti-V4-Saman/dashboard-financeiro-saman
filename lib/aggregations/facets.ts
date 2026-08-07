import type { Lancamento } from '@/lib/types'

/**
 * Facetas da FilterBar — as listas de opções dos selects.
 *
 * Função PURA, chamada pelos DOIS caminhos da flag. OFF roda no browser sobre
 * `allData`; ON roda no servidor. Extraída de `components/dashboard/FilterBar.tsx`,
 * preservando as três regras que já existiam lá:
 *
 *   • deriva do conjunto do PERÍODO SEM os 5 filtros (`allData`), para que
 *     escolher uma categoria não faça as outras sumirem da lista;
 *   • descarta o sentinela `(em branco)` das três listas derivadas;
 *   • ordena alfabeticamente com `sort()` puro, sem locale — mudar para
 *     `localeCompare` alteraria a ordem visível dos selects.
 *
 * `contas` NÃO sai dos lançamentos: vem de `ca.contas_financeiras` inteira, via
 * `fetchContas`. É por isso que o select de conta oferece opções que não casam
 * com lançamento nenhum — as contas existem no cadastro, mas o campo `conta`
 * dos lançamentos vem vazio do ERP. Comportamento atual, preservado.
 *
 * `tipo` não é faceta: a tela oferece Receita/Despesa fixos.
 */
export interface FacetsAgg {
  categorias: string[]
  centrosCusto: string[]
  situacoes: string[]
  contas: string[]
  /** Lançamentos do período sem filtros — alimenta o contador da TopBar. */
  total: number
}

export function aggFacets(allData: readonly Lancamento[], contas: readonly string[]): FacetsAgg {
  const cat = new Set<string>()
  const cc = new Set<string>()
  const sit = new Set<string>()
  for (const r of allData) {
    for (const c of r.categorias) if (c.nome && c.nome !== '(em branco)') cat.add(c.nome)
    for (const c of r._ccList)    if (c.nome && c.nome !== '(em branco)') cc.add(c.nome)
    if (r.situacao && r.situacao !== '(em branco)') sit.add(r.situacao)
  }
  return {
    categorias: [...cat].sort(),
    centrosCusto: [...cc].sort(),
    situacoes: [...sit].sort(),
    contas: [...contas].sort(),
    total: allData.length,
  }
}
