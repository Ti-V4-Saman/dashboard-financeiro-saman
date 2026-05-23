/**
 * Helpers de fuso horário São Paulo.
 *
 * O Vercel roda em UTC. Para calcular "hoje" e ranges de mês corretamente
 * no horário brasileiro precisamos forçar `America/Sao_Paulo`.
 */

export const TIMEZONE_BR = 'America/Sao_Paulo'

/**
 * Retorna um Date representando o início de hoje (00:00) no horário de
 * São Paulo. Useful para queries com BETWEEN data_x AND hoje.
 *
 * Internamente o Date é midnight LOCAL — mas como só vamos extrair
 * componentes via getFullYear/getMonth/getDate, o valor é estável
 * independente do TZ do servidor.
 */
export function getHojeBR(): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE_BR,
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  })
  const parts = formatter.formatToParts(new Date())
  const y = parts.find(p => p.type === 'year')!.value
  const m = parts.find(p => p.type === 'month')!.value
  const d = parts.find(p => p.type === 'day')!.value
  // Construímos com componentes (ano, mês 0-indexed, dia) — evita ambiguidade
  // com parsing de string que poderia ser interpretada como UTC.
  return new Date(Number(y), Number(m) - 1, Number(d))
}

/**
 * Formata Date para "YYYY-MM-DD" usando componentes locais (não UTC).
 * Importante: NÃO usar toISOString() — quebra em servidores não-UTC.
 */
export function toYMD(d: Date): string {
  const y  = d.getFullYear()
  const m  = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

const MESES_BR = [
  'Janeiro', 'Fevereiro', 'Março',  'Abril', 'Maio',     'Junho',
  'Julho',   'Agosto',    'Setembro', 'Outubro', 'Novembro', 'Dezembro',
] as const

export interface MesRange {
  inicio:    string   // YYYY-MM-DD primeiro dia
  fim:       string   // YYYY-MM-DD último dia
  label:     string   // "Maio / 2026"
  mes_ref:   string   // "2026-05"
  is_atual:  boolean  // offsetMeses === 0
}

/**
 * Devolve range do mês (em SP) deslocado em N meses do mês atual.
 *  • offsetMeses = 0  → mês corrente
 *  • offsetMeses = 1  → próximo mês
 *  • offsetMeses = -1 → mês passado
 */
export function getMesRange(offsetMeses: number): MesRange {
  const hoje = getHojeBR()
  const ano  = hoje.getFullYear()
  const mes  = hoje.getMonth() + offsetMeses
  const inicio = new Date(ano, mes,     1)
  const fim    = new Date(ano, mes + 1, 0)   // dia 0 do mês+1 = último dia do mês

  return {
    inicio:   toYMD(inicio),
    fim:      toYMD(fim),
    label:    `${MESES_BR[inicio.getMonth()]} / ${inicio.getFullYear()}`,
    mes_ref:  `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, '0')}`,
    is_atual: offsetMeses === 0,
  }
}
