/**
 * Funções puras de cálculo de insights do período.
 * Recebem os Lancamento[] já filtrados pelo useFinanceiro e
 * retornam métricas prontas para renderizar em InsightsPeriodo.
 */
import type { Lancamento } from './types'
import { fDt } from './utils'

/** Ticket médio das receitas do período (excluindo transferências). */
export function calcTicketMedioReceita(data: Lancamento[]): number {
  const receitas = data.filter(r => r.tipo === 'Receita' && !r.isTransfer)
  if (receitas.length === 0) return 0
  return receitas.reduce((s, r) => s + r.valor, 0) / receitas.length
}

/** Dia com maior soma de receitas. Retorna null se não há receitas. */
export function calcDiaDePico(
  data: Lancamento[],
): { label: string; valor: number } | null {
  const map = new Map<string, number>()
  for (const r of data) {
    if (r.tipo !== 'Receita' || r.isTransfer || !r.data) continue
    const key = fDt(r.data) // dd/mm/yyyy
    map.set(key, (map.get(key) || 0) + r.valor)
  }
  if (map.size === 0) return null
  const [label, valor] = [...map.entries()].sort((a, b) => b[1] - a[1])[0]
  return { label, valor }
}

/** Burn diário médio = total despesas / número de dias do período. */
export function calcBurnDiario(
  data: Lancamento[],
  dateFrom: string,
  dateTo: string,
): number {
  const despesas = data.filter(r => r.tipo === 'Despesa' && !r.isTransfer)
  const totalDesp = despesas.reduce((s, r) => s + r.valor, 0)
  if (!dateFrom || !dateTo) return 0
  const d0 = new Date(dateFrom + 'T00:00:00')
  const d1 = new Date(dateTo + 'T00:00:00')
  const dias = Math.max(1, Math.round((d1.getTime() - d0.getTime()) / 86400000) + 1)
  return totalDesp / dias
}

/**
 * Saúde diária: receitas - despesas agrupadas por dia.
 * Ordena cronologicamente. Dias sem movimento não aparecem.
 */
export function calcSaudeDiaria(
  data: Lancamento[],
): Array<{ data: string; saldo: number }> {
  const map = new Map<string, number>()
  for (const r of data) {
    if (r.isTransfer || !r.data) continue
    const key = r.data.toISOString().slice(0, 10) // YYYY-MM-DD
    const delta = r.tipo === 'Receita' ? r.valor : -r.valor
    map.set(key, (map.get(key) || 0) + delta)
  }
  return Array.from(map.entries())
    .map(([data, saldo]) => ({ data, saldo }))
    .sort((a, b) => a.data.localeCompare(b.data))
}
