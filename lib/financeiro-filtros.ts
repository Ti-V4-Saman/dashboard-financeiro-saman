import type { Lancamento } from '@/lib/types'

/**
 * Os 5 filtros não-temporais aplicados sobre o array de lançamentos.
 * Hoje rodam client-side (hooks/useFinanceiro.ts) e duplicados em
 * ResumoTrimestralWidget. Esta é a fonte ÚNICA dessa lógica — usada também
 * server-side pelos endpoints agregados (lib/financeiro-query.ts), garantindo
 * que os números batam em qualquer caminho.
 */
export interface FinanceiroFiltros {
  categoria: string[]
  cc: string[]
  tipo: string
  situacao: string[]
  conta: string[]
}

export const EMPTY_FILTROS: FinanceiroFiltros = {
  categoria: [],
  cc: [],
  tipo: '',
  situacao: [],
  conta: [],
}

/** Filtra por categoria/cc/tipo/situacao/conta. Equivalente exato ao filtro client-side. */
export function applyFiltros(data: Lancamento[], f: FinanceiroFiltros): Lancamento[] {
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

/** Lê os 5 filtros de query params (CSV) — usado pelos endpoints /api/agg/*. */
export function parseFiltros(sp: URLSearchParams): FinanceiroFiltros {
  const csv = (k: string) => {
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
