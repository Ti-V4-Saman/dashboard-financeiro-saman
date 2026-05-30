import type { Lancamento } from '@/lib/types'

/**
 * Agregação de Centros de Custo — função PURA extraída de
 * components/dashboard/tabs/CentrosCusto.tsx (mesma lógica, números idênticos).
 * Roda tanto no client (caminho flag OFF) quanto no servidor (endpoint /api/agg).
 *
 * `data` = filteredData do dash (já com os 5 filtros + sem linhas sem data).
 */

export interface CCRow {
  nome: string
  rec: number
  desp: number
  resultado: number
}
export interface CCGrupo {
  label: string
  rec: number
  desp: number
  resultado: number
  count: number
}
export interface ChartPoint {
  name: string
  value: number
}
export interface CentrosCustoAgg {
  ccList: CCRow[]
  kpiGroups: CCGrupo[]
  recByCC: ChartPoint[]
  despByCC: ChartPoint[]
  resultByCC: ChartPoint[]
}

export function aggCentrosCusto(data: Lancamento[], regime: string): CentrosCustoAgg {
  const isCaixa = regime === 'caixa'

  // op: regime
  const op = data.filter(r => {
    if (r.isTransfer) return false
    if (isCaixa) return r.situacao === 'Quitado'
    return r.situacao !== 'Cancelado' && r.situacao !== 'Renegociado'
  })

  // ccMap
  const map = new Map<string, { rec: number; desp: number }>()
  for (const r of op) {
    for (const c of r._ccList) {
      if (!c.nome || c.nome === '(em branco)') continue
      if (!map.has(c.nome)) map.set(c.nome, { rec: 0, desp: 0 })
      const entry = map.get(c.nome)!
      if (r.tipo === 'Receita') entry.rec += r.valor
      else entry.desp += r.valor
    }
  }

  const ccList: CCRow[] = Array.from(map.entries())
    .map(([nome, { rec, desp }]) => ({ nome, rec, desp, resultado: rec - desp }))
    .sort((a, b) => b.desp - a.desp)

  // 5 grupos fixos
  const sum = (ccs: CCRow[]) =>
    ccs.reduce((acc, c) => ({ rec: acc.rec + c.rec, desp: acc.desp + c.desp }), { rec: 0, desp: 0 })
  const groups: { label: string; match: (n: string) => boolean }[] = [
    { label: 'Administrativo',       match: n => n.toLowerCase().startsWith('administrativo') },
    { label: 'Operação',             match: n => n.toLowerCase().startsWith('operação') || n.toLowerCase().startsWith('operacao') },
    { label: 'People & Performance', match: n => n.toLowerCase().includes('people') },
    { label: 'Aquisição e Expansão', match: n => n.toLowerCase().includes('venda') || n.toLowerCase().includes('monetização') || n.toLowerCase().includes('monetizacao') },
    { label: 'Tecnologia',           match: n => n.toLowerCase().startsWith('tecnologia') },
  ]
  const kpiGroups: CCGrupo[] = groups
    .map(g => {
      const ccs = ccList.filter(c => g.match(c.nome))
      const { rec, desp } = sum(ccs)
      return { label: g.label, rec, desp, resultado: rec - desp, count: ccs.length }
    })
    .filter(g => g.count > 0)

  const recByCC: ChartPoint[] = [...ccList]
    .sort((a, b) => b.rec - a.rec)
    .filter(c => c.rec > 0)
    .slice(0, 15)
    .map(c => ({ name: c.nome, value: c.rec }))

  const despByCC: ChartPoint[] = [...ccList]
    .sort((a, b) => b.desp - a.desp)
    .slice(0, 15)
    .map(c => ({ name: c.nome, value: c.desp }))

  const resultByCC: ChartPoint[] = [...ccList]
    .sort((a, b) => b.resultado - a.resultado)
    .slice(0, 15)
    .map(c => ({ name: c.nome, value: c.resultado }))

  return { ccList, kpiGroups, recByCC, despByCC, resultByCC }
}
