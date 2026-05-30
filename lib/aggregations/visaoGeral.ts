import type { Lancamento } from '@/lib/types'
import { fDt } from '@/lib/utils'
import { calcTicketMedioReceita, calcDiaDePico, calcBurnDiario } from '@/lib/calcInsights'

/**
 * Agregação do MIOLO da Visão Geral — função PURA extraída de
 * components/dashboard/tabs/VisaoGeral.tsx (KPIs, gráfico diário, top10 cat/cc,
 * insights ticket/pico/burn). NÃO inclui saldos/blocos (vêm de visao-geral-extras).
 *
 * `data` = filteredData do dash (5 filtros + sem linhas sem data, `data` como Date).
 */

export interface DailyPoint { data: string; rec: number; desp: number }
export interface NomeValor { nome: string; valor: number }

export interface VisaoGeralAgg {
  receita: number
  despesa: number
  resultado: number
  margem: number
  atrasados: number
  opLength: number
  semCat: number
  semCC: number
  dailyData: DailyPoint[]
  topDespCat: NomeValor[]
  topCC: NomeValor[]
  insights: {
    ticket: number
    pico: { label: string; valor: number } | null
    burn: number
  }
}

export function aggVisaoGeral(
  data: Lancamento[],
  regime: string,
  dateFrom: string,
  dateTo: string,
): VisaoGeralAgg {
  const isCaixa = regime === 'caixa'

  const op = data.filter(r => {
    if (r.isTransfer) return false
    if (isCaixa) return r.situacao === 'Quitado'
    return r.situacao !== 'Cancelado' && r.situacao !== 'Renegociado'
  })

  let rec = 0, desp = 0, atr = 0
  const hoje = new Date()
  for (const r of op) {
    if (r.tipo === 'Receita') rec += r.valor
    else desp += r.valor
  }
  for (const r of data) {
    if ((r.situacao === 'Atrasado' || r.situacao === 'Aberto') && r.data && r.data < hoje) {
      atr += r.valor
    }
  }
  const resultado = rec - desp

  const semCat = op.filter(r => !r.cat1 || r.cat1 === '(em branco)').length
  const semCC  = op.filter(r => !r.cc1  || r.cc1  === '(em branco)').length

  // Daily
  const dmap = new Map<string, DailyPoint>()
  for (const r of op) {
    if (!r.data) continue
    const key = fDt(r.data)
    if (!dmap.has(key)) dmap.set(key, { data: key, rec: 0, desp: 0 })
    const entry = dmap.get(key)!
    if (r.tipo === 'Receita') entry.rec += r.valor
    else entry.desp += r.valor
  }
  const dailyData = Array.from(dmap.values()).sort((a, b) => {
    const [da, ma, ya] = a.data.split('/').map(Number)
    const [db, mb, yb] = b.data.split('/').map(Number)
    return new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime()
  })

  // Top 10 despesa por categoria
  const cmap = new Map<string, number>()
  for (const r of op) {
    if (r.tipo !== 'Despesa') continue
    const key = r.cat1 || 'Sem categoria'
    cmap.set(key, (cmap.get(key) || 0) + r.valor)
  }
  const topDespCat = Array.from(cmap.entries())
    .map(([nome, valor]) => ({ nome, valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 10)

  // Top 10 CC (despesa)
  const ccmap = new Map<string, number>()
  for (const r of op) {
    if (r.tipo !== 'Despesa') continue
    for (const c of r._ccList) {
      ccmap.set(c.nome, (ccmap.get(c.nome) || 0) + r.valor)
    }
  }
  const topCC = Array.from(ccmap.entries())
    .map(([nome, valor]) => ({ nome, valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 10)

  return {
    receita: rec,
    despesa: desp,
    resultado,
    margem: rec > 0 ? (resultado / rec) * 100 : 0,
    atrasados: atr,
    opLength: op.length,
    semCat,
    semCC,
    dailyData,
    topDespCat,
    topCC,
    insights: {
      ticket: calcTicketMedioReceita(op),
      pico:   calcDiaDePico(op),
      burn:   calcBurnDiario(op, dateFrom, dateTo),
    },
  }
}
