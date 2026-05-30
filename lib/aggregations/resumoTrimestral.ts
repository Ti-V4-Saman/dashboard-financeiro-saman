import type { Lancamento, Meta } from '@/lib/types'
import { parseCatHier } from '@/lib/utils'

/**
 * Resumo Trimestral (projeção de caixa por competência) — calcMes extraído de
 * components/dashboard/widgets/ResumoTrimestralWidget.tsx (mesma lógica).
 * Devolve os 4 meses já calculados (Mês anterior, Mês ref, M+1, M+2), SEM
 * trafegar o array cru de lançamentos.
 */

export type LinhaKind = 'receita' | 'despesa' | 'subtotal' | 'resultado'

export interface LinhaCalc {
  id: string
  label: string
  total: number
  meta: number
  kind: LinhaKind
  delta: boolean
}

export interface MesCalc {
  ym: string
  hasData: boolean
  linhas: LinhaCalc[]
}

const L1_REC_OP   = '1 — Rec. Operacionais'
const L1_DED      = '2 — Deduções'
const L1_CUSTOS   = '3 — Custos Operac.'
const L1_DESP     = '4 — Despesas'
const L1_REC_FIN  = '6.1 — Rec. Financeira'
const L1_DESP_FIN = '6.2 — Desp. Financeira'
const L1_DEPREC   = '5 — Depreciações'
const L1_IMP_LUC  = '7 — Impostos s/ Lucro'

export function calcMes(
  ym: string,
  data: Lancamento[],
  metas: Meta[],
  excludeBaixados: boolean = false,
): MesCalc {
  if (!ym) return { ym: '', hasData: false, linhas: [] }
  const rows = data.filter(r => {
    if (r.data_ym !== ym) return false
    if (excludeBaixados && r.situacao === 'Quitado') return false
    return true
  })
  const metasMes = metas.filter(m => m.mes_referencia === ym)

  const calcTotal = (l1: string | string[]): number => {
    const labels = Array.isArray(l1) ? l1 : [l1]
    return rows
      .filter(r => labels.includes(parseCatHier(r.cat1).l1))
      .reduce((s, r) => s + (r.tipo === 'Receita' ? r.valor : -r.valor), 0)
  }
  const calcMetaAbs = (l1: string | string[]): number => {
    const labels = Array.isArray(l1) ? l1 : [l1]
    return metasMes
      .filter(m => labels.includes(parseCatHier(m.categoria_nivel_3 || m.categoria || '').l1))
      .reduce((s, m) => s + (m.valor_planejado || 0), 0)
  }

  const totalRecOp   = calcTotal(L1_REC_OP)
  const totalDed     = calcTotal(L1_DED)
  const totalROL     = totalRecOp + totalDed
  const totalCusto   = calcTotal(L1_CUSTOS)
  const totalLB      = totalROL + totalCusto
  const totalDesp    = calcTotal(L1_DESP)
  const totalEBITDA  = totalLB + totalDesp
  const totalRecFin  = calcTotal(L1_REC_FIN)
  const totalDespFin = calcTotal(L1_DESP_FIN)
  const totalOutros  = calcTotal([L1_DEPREC, L1_IMP_LUC])
  const totalLL      = totalEBITDA + totalRecFin + totalDespFin + totalOutros

  const metaRecOp    = calcMetaAbs(L1_REC_OP)
  const metaDed      = -calcMetaAbs(L1_DED)
  const metaROL      = metaRecOp + metaDed
  const metaCusto    = -calcMetaAbs(L1_CUSTOS)
  const metaLB       = metaROL + metaCusto
  const metaDesp     = -calcMetaAbs(L1_DESP)
  const metaEBITDA   = metaLB + metaDesp
  const metaRecFin   = calcMetaAbs(L1_REC_FIN)
  const metaDespFin  = -calcMetaAbs(L1_DESP_FIN)
  const metaOutros   = -calcMetaAbs([L1_DEPREC, L1_IMP_LUC])
  const metaLL       = metaEBITDA + metaRecFin + metaDespFin + metaOutros

  const linhas: LinhaCalc[] = [
    { id: 'rec_op',  label: '1 — Rec. Operacionais', total: totalRecOp,   meta: metaRecOp,   kind: 'receita',   delta: true  },
    { id: 'ded',     label: '2 — Deduções',          total: totalDed,     meta: metaDed,     kind: 'despesa',   delta: false },
    { id: 'rol',     label: '(=) Rec. Op. Líquida',  total: totalROL,     meta: metaROL,     kind: 'subtotal',  delta: false },
    { id: 'cu',      label: '3 — Custos Operac.',    total: totalCusto,   meta: metaCusto,   kind: 'despesa',   delta: false },
    { id: 'lb',      label: '(=) Lucro Bruto',       total: totalLB,      meta: metaLB,      kind: 'subtotal',  delta: true  },
    { id: 'desp',    label: '4 — Despesas',          total: totalDesp,    meta: metaDesp,    kind: 'despesa',   delta: false },
    { id: 'ebitda',  label: '(=) EBITDA',            total: totalEBITDA,  meta: metaEBITDA,  kind: 'subtotal',  delta: true  },
    { id: 'recf',    label: '6.1 — Rec. Financeira', total: totalRecFin,  meta: metaRecFin,  kind: 'receita',   delta: false },
    { id: 'despf',   label: '6.2 — Desp. Financeira',total: totalDespFin, meta: metaDespFin, kind: 'despesa',   delta: false },
    { id: 'outros',  label: 'Outros',                total: totalOutros,  meta: metaOutros,  kind: 'despesa',   delta: false },
    { id: 'll',      label: '(=) Lucro Líquido',     total: totalLL,      meta: metaLL,      kind: 'resultado', delta: true  },
  ]
  const hasData = linhas.some(l => l.total !== 0 || l.meta !== 0)
  return { ym, hasData, linhas }
}

export interface ResumoTrimestralAgg {
  calcAnt: MesCalc
  calcRef: MesCalc
  calcM1: MesCalc
  calcM2: MesCalc
}

export function aggResumoTrimestral(
  data: Lancamento[],
  metas: Meta[],
  meses: { mesAnt: string; mesRef: string; mesM1: string; mesM2: string },
): ResumoTrimestralAgg {
  return {
    calcAnt: calcMes(meses.mesAnt, data, metas, false),
    calcRef: calcMes(meses.mesRef, data, metas, false),
    calcM1:  calcMes(meses.mesM1,  data, metas, true),
    calcM2:  calcMes(meses.mesM2,  data, metas, true),
  }
}
