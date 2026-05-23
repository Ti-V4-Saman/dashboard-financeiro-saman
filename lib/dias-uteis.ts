/**
 * Cálculo de dias úteis entre duas datas (inclusive).
 *
 * Considera apenas o filtro de fim-de-semana (sábado e domingo).
 * TODO: integrar feriados nacionais brasileiros (sugestão:
 * date-holidays ou lista hardcoded por ano em lib/feriados-br.ts).
 *
 * Como datas vêm de getHojeBR/getMesRange (que usam componentes locais
 * sem TZ), getDay() retorna 0..6 estável independente do servidor.
 */

export function diasUteis(dataInicio: Date, dataFim: Date): number {
  if (dataFim < dataInicio) return 0
  let count = 0
  const cur = new Date(dataInicio.getFullYear(), dataInicio.getMonth(), dataInicio.getDate())
  const end = new Date(dataFim.getFullYear(),    dataFim.getMonth(),    dataFim.getDate())
  while (cur <= end) {
    const dow = cur.getDay()
    if (dow !== 0 && dow !== 6) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

/** Sobrecarga aceitando strings YYYY-MM-DD. */
export function diasUteisYMD(inicio: string, fim: string): number {
  const [y1, m1, d1] = inicio.split('-').map(Number)
  const [y2, m2, d2] = fim.split('-').map(Number)
  return diasUteis(new Date(y1, m1 - 1, d1), new Date(y2, m2 - 1, d2))
}
