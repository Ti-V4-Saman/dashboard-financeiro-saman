import type { Lancamento } from '@/lib/types'

/**
 * "Agregação" de Lançamentos — na verdade filtro + ordenação + paginação
 * server-side de LINHAS CRUAS (não é agregável). Extraído de
 * components/dashboard/tabs/Lancamentos.tsx (mesma lógica).
 *
 * O mascaramento de folha NÃO acontece aqui — é aplicado no endpoint, sobre
 * `pageRows`, depois de `totais` já terem sido calculados (valores reais).
 */

export type SortKey = 'data' | 'valor'
export type SortDir = 'asc' | 'desc'

export interface LancamentosOpts {
  q: string
  conta: string
  sortKey: SortKey
  sortDir: SortDir
  page: number
  pageSize: number
}

export interface LancamentosAgg {
  pageRows: Lancamento[]
  total: number
  totalPages: number
  page: number
  pageSize: number
  totais: { rec: number; desp: number; resultado: number }
  contas: string[]
}

export function aggLancamentos(data: Lancamento[], opts: LancamentosOpts): LancamentosAgg {
  const { q, conta, sortKey, sortDir, page, pageSize } = opts

  const op = data.filter(r => !r.isTransfer)

  const contasSet = new Set<string>()
  for (const r of op) {
    if (r.conta && r.conta !== '(em branco)') contasSet.add(r.conta)
  }
  const contas = Array.from(contasSet).sort()

  let filtered = op
  if (q) {
    const s = q.toLowerCase()
    filtered = filtered.filter(
      r =>
        r.desc.toLowerCase().includes(s) ||
        r.fornecedor.toLowerCase().includes(s) ||
        r.cat1.toLowerCase().includes(s) ||
        r.conta.toLowerCase().includes(s) ||
        r.cc1.toLowerCase().includes(s),
    )
  }
  if (conta) filtered = filtered.filter(r => r.conta === conta)

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === 'data') {
      const ta = a.data?.getTime() || 0
      const tb = b.data?.getTime() || 0
      return sortDir === 'desc' ? tb - ta : ta - tb
    }
    return sortDir === 'desc' ? b.valor - a.valor : a.valor - b.valor
  })

  const total = sorted.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

  const rec = filtered.filter(r => r.tipo === 'Receita').reduce((s, r) => s + r.valor, 0)
  const desp = filtered.filter(r => r.tipo === 'Despesa').reduce((s, r) => s + r.valor, 0)

  return {
    pageRows,
    total,
    totalPages,
    page: safePage,
    pageSize,
    totais: { rec, desp, resultado: rec - desp },
    contas,
  }
}
