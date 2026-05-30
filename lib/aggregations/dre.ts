import type { Lancamento } from '@/lib/types'
import { getMonths, parseCatHier } from '@/lib/utils'

/**
 * Agregação do DRE — função PURA extraída de components/dashboard/tabs/DRE.tsx.
 *
 * Devolve `vm` (somas por mês→l1→l2→l3, SEM linha crua/fornecedor), `hier`,
 * `months`, `exec` e `kpis`. A construção da tabela (dreRows) e o estado de
 * expand/collapse continuam no componente, operando sobre `vm`/`hier`/`months`.
 * Os getters são exportados para o componente reusar (paridade garantida).
 */

export type VM = Record<string, Record<string, Record<string, Record<string, number>>>>

export interface HierNode {
  l1: string
  children: { l2: string; children: string[] }[]
}

export interface DREExec {
  recOp: number
  recFin: number
  recBruta: number
  recLiq: number
  lubruto: number
  margContrib: number
  ebitda: number
  ebit: number
  lucroLiq: number
  growthRate: number | null
}

export interface DREKpis {
  recOp: number; recLiq: number; lubruto: number; margContrib: number
  ebitda: number; ebit: number; lucroLiq: number; deducoes: number
  csp: number; terceiros: number; despCom: number; despAdmin: number
  despGerais: number; gastosPessoas: number; despAquisicao: number
  leadBroker: number; despExpansao: number; proLabore: number
  growthRate: number | null
}

export interface DREAgg {
  opLength: number
  months: string[]
  vm: VM
  hier: HierNode[]
  exec: DREExec
  kpis: DREKpis
}

export function numPrefix(s: string): number {
  const m = s.match(/^([\d.]+)/)
  return m ? parseFloat(m[1]) : 999
}

// ── Getters puros (vm + months) — reusados client e server ─────────────────────
export function dreGetL3(vm: VM, months: string[], col: string, l1: string, l2: string, l3: string): number {
  if (col === '__acc__') return months.reduce((s, m) => s + (vm[m]?.[l1]?.[l2]?.[l3] ?? 0), 0)
  return vm[col]?.[l1]?.[l2]?.[l3] ?? 0
}
export function dreGetL2(vm: VM, months: string[], col: string, l1: string, l2: string): number {
  if (col === '__acc__') return months.reduce((s, m) => s + dreGetL2(vm, months, m, l1, l2), 0)
  return Object.values(vm[col]?.[l1]?.[l2] ?? {}).reduce((s, v) => s + v, 0)
}
export function dreGetL1(vm: VM, months: string[], col: string, l1: string): number {
  if (col === '__acc__') return months.reduce((s, m) => s + dreGetL1(vm, months, m, l1), 0)
  let s = 0
  for (const l2v of Object.values(vm[col]?.[l1] ?? {}))
    for (const v of Object.values(l2v)) s += v
  return s
}
export function dreGroupSum(vm: VM, months: string[], hier: HierNode[], col: string, maxPfx: number): number {
  return hier.filter(h => numPrefix(h.l1) <= maxPfx).reduce((s, h) => s + dreGetL1(vm, months, col, h.l1), 0)
}

// ── Agregação ──────────────────────────────────────────────────────────────────
export function aggDRE(data: Lancamento[], regime: string): DREAgg {
  const isCaixa = regime === 'caixa'
  const op = data.filter(r => {
    if (r.isTransfer) return false
    if (isCaixa) return r.situacao === 'Quitado'
    return r.situacao !== 'Cancelado' && r.situacao !== 'Renegociado'
  })

  const months = getMonths(op)

  // vm: month → l1 → l2 → l3 → signed value
  const vm: VM = {}
  for (const row of op) {
    if (!row.data) continue
    const ym = row.data_ym ?? `${row.data.getFullYear()}-${String(row.data.getMonth() + 1).padStart(2, '0')}`
    const sign = row.tipo === 'Receita' ? 1 : -1
    const { l1, l2 } = parseCatHier(row.cat1)
    const l3 = row.cat1 || l2
    if (!vm[ym])               vm[ym] = {}
    if (!vm[ym][l1])           vm[ym][l1] = {}
    if (!vm[ym][l1][l2])       vm[ym][l1][l2] = {}
    if (!vm[ym][l1][l2][l3])   vm[ym][l1][l2][l3] = 0
    vm[ym][l1][l2][l3] += sign * row.valorDRE
  }

  // hier
  const l1m = new Map<string, Map<string, Set<string>>>()
  for (const row of op) {
    const { l1, l2 } = parseCatHier(row.cat1)
    const l3 = row.cat1 || l2
    if (!l1m.has(l1)) l1m.set(l1, new Map())
    if (!l1m.get(l1)!.has(l2)) l1m.get(l1)!.set(l2, new Set())
    l1m.get(l1)!.get(l2)!.add(l3)
  }
  const hier: HierNode[] = [...l1m.entries()]
    .sort(([a], [b]) => numPrefix(a) - numPrefix(b))
    .map(([l1, l2map]) => ({
      l1,
      children: [...l2map.entries()]
        .sort(([a], [b]) => numPrefix(a) - numPrefix(b))
        .map(([l2, l3s]) => ({ l2, children: [...l3s].sort((a, b) => numPrefix(a) - numPrefix(b)) })),
    }))

  const gs  = (col: string, maxPfx: number) => dreGroupSum(vm, months, hier, col, maxPfx)
  const gL1 = (col: string, l1: string) => dreGetL1(vm, months, col, l1)
  const gL2 = (col: string, l1: string, l2: string) => dreGetL2(vm, months, col, l1, l2)

  // exec
  const recOp       = gs('__acc__', 1.99)
  const recFin      = gL1('__acc__', '6.1 — Rec. Financeira')
  const recLiq      = gs('__acc__', 2.99)
  const lubruto     = gs('__acc__', 3.99)
  const despCom     = gL2('__acc__', '4 — Despesas', '4.1')
  const margContrib = lubruto + despCom
  const ebitda      = gs('__acc__', 4.99)
  const ebit        = gs('__acc__', 5.99)
  const lucroLiq    = gs('__acc__', 99)

  let growthRate: number | null = null
  if (months.length >= 2) {
    const cur = months[months.length - 1]
    const prv = months[months.length - 2]
    const curRL = gs(cur, 2.99)
    const prvRL = gs(prv, 2.99)
    if (prvRL) growthRate = (curRL - prvRL) / Math.abs(prvRL)
  }

  const exec: DREExec = {
    recOp, recFin, recBruta: recOp + recFin, recLiq, lubruto, margContrib,
    ebitda, ebit, lucroLiq, growthRate,
  }

  // kpis (S = soma op por prefixo de cat1; só roda onde há op — server ou client OFF)
  const S = (...pfx: string[]) =>
    op.filter(r => pfx.some(p => (r.cat1 || '').startsWith(p)))
      .reduce((s, r) => s + (r.tipo === 'Receita' ? 1 : -1) * r.valorDRE, 0)

  const deducoes   = gs('__acc__', 2.99) - gs('__acc__', 1.99)
  const csp        = gL1('__acc__', '3 — Custos Operac.')
  const terceiros  = gL2('__acc__', '3 — Custos Operac.', '3.3')
  const despAdmin  = gL2('__acc__', '4 — Despesas', '4.2')
  const despGerais = gL2('__acc__', '4 — Despesas', '4.3')
  const maoObraCSP = gL2('__acc__', '3 — Custos Operac.', '3.1')
  const isaas      = gL2('__acc__', '3 — Custos Operac.', '3.2')
  const remuCom    = S('4.1.01','4.1.02','4.1.03','4.1.04','4.1.05','4.1.23')
  const admPessoas = S('4.2.01','4.2.02','4.2.03','4.2.04','4.2.05','4.2.06','4.2.07','4.2.08','4.2.09','4.2.25','4.2.26')

  const kpis: DREKpis = {
    recOp, recLiq, lubruto, margContrib, ebitda, ebit, lucroLiq, deducoes,
    csp, terceiros, despCom, despAdmin, despGerais,
    gastosPessoas: maoObraCSP + isaas + remuCom + admPessoas,
    despAquisicao: S('4.1.02','4.1.04','4.1.06','4.1.07','4.1.08','4.1.10','4.1.11','4.1.12','4.1.13','4.1.14','4.1.15','4.1.16','4.1.17'),
    leadBroker:    S('4.1.06'),
    despExpansao:  S('4.1.18','4.1.19','4.1.20','4.1.21','4.1.22','4.1.23'),
    proLabore:     S('4.2.25','4.2.26'),
    growthRate,
  }

  return { opLength: op.length, months, vm, hier, exec, kpis }
}
