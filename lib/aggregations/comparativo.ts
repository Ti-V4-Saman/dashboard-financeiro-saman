import type { Lancamento } from '@/lib/types'
import { getMonths, mLbl, parseCatHier } from '@/lib/utils'

/**
 * Agregação do Comparativo — função PURA extraída de
 * components/dashboard/tabs/Comparativo.tsx.
 *
 * Devolve monthlyData/mmTable/ytd já calculados + `vmComp` (somas por
 * mês→l1→l2→l3 com `valor` assinado, SEM linha crua). A comparação Mês1×Mês2
 * (hierárquica) e o collapse continuam no client, montados a partir de vmComp.
 *
 * `data`    = filteredData (5 filtros). `allData` = sem os 5 filtros (p/ YoY),
 * espelhando o que o dash passa hoje. Ambos com `data` como Date.
 */

export type VMComp = Record<string, Record<string, Record<string, Record<string, number>>>>

export interface MonthlyPoint { mes: string; receita: number; despesa: number; resultado: number }

export interface MMRow {
  ym: string; mes: string; rec: number; desp: number; res: number
  varRec: number | null; varDesp: number | null; varRes: number | null
  varYoYRec: number | null; varYoYDesp: number | null; varYoYRes: number | null
  hasYoY: boolean
}

export interface ComparativoAgg {
  months: string[]
  monthlyData: MonthlyPoint[]
  mmTable: MMRow[]
  ytd: { rec: number; desp: number; res: number; margem: number | null }
  vmComp: VMComp
}

const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export function aggComparativo(data: Lancamento[], allData: Lancamento[], regime: string): ComparativoAgg {
  const isCaixa = regime === 'caixa'
  const validRow = (r: Lancamento) => {
    if (r.isTransfer) return false
    if (isCaixa) return r.situacao === 'Quitado'
    return r.situacao !== 'Cancelado' && r.situacao !== 'Renegociado'
  }
  const op    = data.filter(validRow)
  const allOp = allData.filter(validRow)
  const months = getMonths(op)

  const rowsForYm = (dataset: Lancamento[], ym: string) =>
    dataset.filter(r => r.data && ymOf(r.data) === ym)

  const monthlyData: MonthlyPoint[] = months.map(ym => {
    const rows = rowsForYm(op, ym)
    const rec = rows.filter(r => r.tipo === 'Receita').reduce((s, r) => s + r.valor, 0)
    const desp = rows.filter(r => r.tipo === 'Despesa').reduce((s, r) => s + r.valor, 0)
    return { mes: mLbl(ym), receita: rec, despesa: desp, resultado: rec - desp }
  })

  const mmTable: MMRow[] = months.map((ym, i) => {
    const rows = rowsForYm(op, ym)
    const rec  = rows.filter(r => r.tipo === 'Receita').reduce((s, r) => s + r.valor, 0)
    const desp = rows.filter(r => r.tipo === 'Despesa').reduce((s, r) => s + r.valor, 0)
    const res  = rec - desp

    let prevRec = 0, prevDesp = 0
    if (i > 0) {
      const pr = rowsForYm(op, months[i - 1])
      prevRec  = pr.filter(r => r.tipo === 'Receita').reduce((s, r) => s + r.valor, 0)
      prevDesp = pr.filter(r => r.tipo === 'Despesa').reduce((s, r) => s + r.valor, 0)
    }
    const prevRes = prevRec - prevDesp
    const varRec  = prevRec  > 0   ? ((rec  - prevRec)  / prevRec)           * 100 : null
    const varDesp = prevDesp > 0   ? ((desp - prevDesp) / prevDesp)          * 100 : null
    const varRes  = prevRes  !== 0 ? ((res  - prevRes)  / Math.abs(prevRes)) * 100 : null

    const [yr, mo] = ym.split('-').map(Number)
    const prevYearYm = `${yr - 1}-${String(mo).padStart(2, '0')}`
    const pyRows = rowsForYm(allOp, prevYearYm)
    const yoyRec  = pyRows.filter(r => r.tipo === 'Receita').reduce((s, r) => s + r.valor, 0)
    const yoyDesp = pyRows.filter(r => r.tipo === 'Despesa').reduce((s, r) => s + r.valor, 0)
    const yoyRes  = yoyRec - yoyDesp
    const varYoYRec  = yoyRec  > 0   ? ((rec  - yoyRec)  / yoyRec)           * 100 : null
    const varYoYDesp = yoyDesp > 0   ? ((desp - yoyDesp) / yoyDesp)          * 100 : null
    const varYoYRes  = yoyRes  !== 0 ? ((res  - yoyRes)  / Math.abs(yoyRes)) * 100 : null

    return { ym, mes: mLbl(ym), rec, desp, res, varRec, varDesp, varRes, varYoYRec, varYoYDesp, varYoYRes, hasYoY: yoyRec > 0 || yoyDesp > 0 }
  })

  const ytdRec  = mmTable.reduce((s, r) => s + r.rec, 0)
  const ytdDesp = mmTable.reduce((s, r) => s + r.desp, 0)
  const ytdRes  = ytdRec - ytdDesp
  const ytd = { rec: ytdRec, desp: ytdDesp, res: ytdRes, margem: ytdRec > 0 ? (ytdRes / ytdRec) * 100 : null }

  // vmComp: por mês → l1 → l2 → l3 → valor assinado (base da comparação Mês1×Mês2)
  const vmComp: VMComp = {}
  for (const r of op) {
    if (!r.data) continue
    const ym = ymOf(r.data)
    const { l1, l2 } = parseCatHier(r.cat1)
    const l3 = r.cat1 || l2
    const sign = r.tipo === 'Receita' ? 1 : -1
    if (!vmComp[ym])             vmComp[ym] = {}
    if (!vmComp[ym][l1])         vmComp[ym][l1] = {}
    if (!vmComp[ym][l1][l2])     vmComp[ym][l1][l2] = {}
    if (!vmComp[ym][l1][l2][l3]) vmComp[ym][l1][l2][l3] = 0
    vmComp[ym][l1][l2][l3] += sign * r.valor
  }

  return { months, monthlyData, mmTable, ytd, vmComp }
}
