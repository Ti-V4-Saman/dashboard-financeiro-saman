import type { Lancamento } from '@/lib/types'

/**
 * Realizado para a aba Metas — extraído de Metas.tsx (getRealizadoRaw,
 * faturamento, realByL3). Devolve SOMAS (sem linha crua):
 *  - realByMonthCat / realByMonthCC: mês → tipo → chave(lower) → soma valor
 *    (base do getRealizado por meta — mesma lógica de getRealizadoRaw)
 *  - realByL3: cat1 → soma assinada (no período do dash)
 *  - faturamento: receita realizada no período
 *
 * `data` é o recorte do período (Date). Equivale ao `allData` que o dash passa
 * hoje à aba Metas — por isso OFF também usa esta função (paridade).
 */

export interface MetasRealizadosAgg {
  realByMonthCat: Record<string, Record<string, Record<string, number>>>
  realByMonthCC: Record<string, Record<string, Record<string, number>>>
  realByL3: Record<string, number>
  faturamento: number
}

function isRealizado(situacao: string, isCaixa: boolean): boolean {
  if (isCaixa) return situacao === 'Quitado'
  return situacao !== 'Cancelado' && situacao !== 'Renegociado'
}

const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export function aggMetasRealizados(
  data: Lancamento[],
  regime: string,
  dateFrom: string,
  dateTo: string,
): MetasRealizadosAgg {
  const isCaixa = regime === 'caixa'
  const from = new Date(dateFrom)
  const to   = new Date(dateTo + 'T23:59:59')

  const realByMonthCat: Record<string, Record<string, Record<string, number>>> = {}
  const realByMonthCC:  Record<string, Record<string, Record<string, number>>> = {}
  const realByL3: Record<string, number> = {}
  let faturamento = 0

  const add = (
    bag: Record<string, Record<string, Record<string, number>>>,
    month: string, tipo: string, key: string, val: number,
  ) => {
    if (!bag[month]) bag[month] = {}
    if (!bag[month][tipo]) bag[month][tipo] = {}
    bag[month][tipo][key] = (bag[month][tipo][key] ?? 0) + val
  }

  for (const r of data) {
    if (!r.data || r.isTransfer || !isRealizado(r.situacao, isCaixa)) continue
    const month = ymOf(r.data)
    add(realByMonthCat, month, r.tipo, (r.cat1 || '').toLowerCase(), r.valor)
    add(realByMonthCC,  month, r.tipo, (r.cc1  || '').toLowerCase(), r.valor)

    // realByL3 + faturamento são restritos ao período do dash (from..to)
    if (r.data >= from && r.data <= to) {
      const sign = r.tipo === 'Receita' ? 1 : -1
      if (r.cat1) realByL3[r.cat1] = (realByL3[r.cat1] ?? 0) + sign * r.valor
      if (r.tipo === 'Receita') faturamento += r.valor
    }
  }

  return { realByMonthCat, realByMonthCC, realByL3, faturamento }
}
