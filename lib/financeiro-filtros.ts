import type { Lancamento } from '@/lib/types'

/**
 * Os 5 filtros NÃO-TEMPORAIS do dashboard: categoria, CC, tipo, situação e conta.
 *
 * DIVISÃO DE RESPONSABILIDADE (importante, para não duplicar regra)
 *
 *   • `lib/financeiro-filtros.ts` (este arquivo)
 *       Filtros ESCOLHIDOS PELO USUÁRIO na FilterBar. Nada de regra de negócio.
 *
 *   • `lib/financeiro/regime.ts`
 *       Regras OPERACIONAIS e de regime — exclusão de transferência, de
 *       Cancelado/Renegociado, e de Parcial em caixa (`filtraOperacional`),
 *       além do detalhamento de DRE. É a fonte da verdade dessas regras e
 *       **não é reimplementada aqui**.
 *
 *   • `lib/financeiro-query.ts`
 *       Acesso ao banco e normalização das linhas.
 *
 * Os dois conjuntos são disjuntos: `applyFiltros` nunca decide o que é
 * operacional, e `filtraOperacional` nunca olha a seleção do usuário. Quem
 * precisar dos dois aplica os dois, nessa ordem, como o dashboard já faz.
 *
 * Esta função é cópia fiel do filtro que hoje roda em `hooks/useFinanceiro.ts`
 * (o `filteredData`). O objetivo é ter UMA implementação utilizável também no
 * servidor, para que os números batam nos dois caminhos da flag AGG_BACKEND.
 */
export interface FinanceiroFiltros {
  categoria: string[]
  cc: string[]
  tipo: string
  situacao: string[]
  conta: string[]
}

export const EMPTY_FILTROS: FinanceiroFiltros = Object.freeze({
  categoria: [],
  cc: [],
  tipo: '',
  situacao: [],
  conta: [],
}) as FinanceiroFiltros

/**
 * Aplica os 5 filtros. Equivalente exato ao filtro client-side de useFinanceiro.
 * NÃO muta o array de entrada — `Array.prototype.filter` devolve novo array.
 */
export function applyFiltros(
  data: readonly Lancamento[],
  f: FinanceiroFiltros,
): Lancamento[] {
  return data.filter(r => {
    if (f.categoria.length > 0) {
      const allCats = r.categorias.map(c => c.nome)
      if (!f.categoria.some(cat => allCats.includes(cat))) return false
    }
    if (f.cc.length > 0) {
      const allCCs = r._ccList.map(c => c.nome)
      if (!f.cc.some(cc => allCCs.includes(cc))) return false
    }
    if (f.tipo && r.tipo !== f.tipo) return false
    if (f.situacao.length > 0 && !f.situacao.includes(r.situacao)) return false
    if (f.conta.length > 0 && !f.conta.includes(r.conta)) return false
    return true
  })
}

/**
 * Lê os 5 filtros de query params no formato CSV — o contrato que os endpoints
 * `/api/agg/*` vão usar. Valores ausentes viram vazio (= sem filtro), nunca
 * `undefined`, para que o chamador não precise tratar nulo.
 */
export function parseFiltros(sp: URLSearchParams): FinanceiroFiltros {
  const csv = (k: string): string[] => {
    const v = sp.get(k)
    return v ? v.split(',').filter(Boolean) : []
  }
  return {
    categoria: csv('categoria'),
    cc:        csv('cc'),
    tipo:      sp.get('tipo') || '',
    situacao:  csv('situacao'),
    conta:     csv('conta'),
  }
}
