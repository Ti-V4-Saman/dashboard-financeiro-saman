import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Lancamento } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fR(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function fDt(d: Date | null): string {
  if (!d) return '—'
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

/**
 * Parseia string 'YYYY-MM-DD' (ou ISO) como Date no fuso LOCAL do navegador.
 *
 * Por que existe: `new Date('2026-04-01T00:00:00.000Z')` em browser BR (UTC-3)
 * retorna 31/03 21:00 local — `getMonth()` vira 2 (março). Em DRE isso
 * desloca o registro pro mês anterior quando o servidor é UTC (Vercel).
 *
 * Esta função extrai os primeiros 10 chars (YYYY-MM-DD) e constrói o Date
 * com componentes locais via `new Date(y, m-1, d)` — TZ-safe.
 */
export function parseDataLocal(s: string): Date | null {
  if (!s) return null
  const ymd = String(s).slice(0, 10)
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/**
 * Deriva a hierarquia de 2 níveis a partir do prefixo numérico do cat1.
 * "1.1.01 Aquisição | [Saber] BR" → { l1: "1 — Rec. Operacionais", l2: "1.1" }
 * Categorias sem prefixo numérico (Aportes, Financiamentos…) → l2 = l1
 */
export function parseCatHier(cat1: string | null | undefined): { l1: string; l2: string } {
  const name = (cat1 || '').trim()
  const l1 = gM(name)
  const m = name.match(/^(\d+)\.(\d+)\./)
  const l2 = m ? `${m[1]}.${m[2]}` : l1
  return { l1, l2 }
}

/** Mapa de rótulos descritivos para cada sub-grupo L2 da hierarquia de categorias. */
const L2_LABELS: Record<string, string> = {
  '1.1': '1.1 — Aquisição',
  '1.2': '1.2 — Renovação',
  '1.3': '1.3 — Expansão',
  '1.4': '1.4 — Variáveis',
  '2.1': '2.1 — Impostos s/ Fat.',
  '2.2': '2.2 — Tarifas',
  '2.3': '2.3 — Royalties',
  '3.1': '3.1 — Mão de Obra CSP',
  '3.2': '3.2 — ISAAS',
  '3.3': '3.3 — Terceirizados',
  '4.1': '4.1 — Comerciais',
  '4.2': '4.2 — Administrativas',
  '4.3': '4.3 — Gerais',
  '5.1': '5.1 — Depreciação',
  '5.2': '5.2 — Amortização',
  '6.1': '6.1 — Rec. Financeira',
  '6.2': '6.2 — Desp. Financeira',
  '7.1': '7.1 — CSLL',
  '7.2': '7.2 — IRPJ',
}

/** Retorna o rótulo descritivo de um sub-grupo L2 (ex: "1.1" → "1.1 — Aquisição"). */
export function getL2Label(l2: string): string {
  return L2_LABELS[l2] ?? l2
}

export function gM(cat: string): string {
  if (!cat) return 'Outros'
  const c = cat.trim()
  if (c.startsWith('1')) return '1 — Rec. Operacionais'
  if (c.startsWith('6.1')) return '6.1 — Rec. Financeira'
  if (c.startsWith('2')) return '2 — Deduções'
  if (c.startsWith('3')) return '3 — Custos Operac.'
  if (c.startsWith('4')) return '4 — Despesas'
  if (c.startsWith('5')) return '5 — Depreciações'
  if (c.startsWith('6.2') || (c.startsWith('6') && !c.startsWith('6.1'))) return '6.2 — Desp. Financeira'
  if (c.startsWith('7')) return '7 — Impostos s/ Lucro'
  return 'Outros'
}

export function getMonths(data: Lancamento[]): string[] {
  const set = new Set<string>()
  for (const r of data) {
    // Prioriza data_ym (calculado no PostgreSQL — sem ambiguidade de TZ).
    // Fallback: extrai do Date local (consistente com parseDataLocal).
    if (r.data_ym) {
      set.add(r.data_ym)
    } else if (r.data) {
      const ym = `${r.data.getFullYear()}-${String(r.data.getMonth() + 1).padStart(2, '0')}`
      set.add(ym)
    }
  }
  return Array.from(set).sort()
}

export function mLbl(ym: string): string {
  if (!ym) return ''
  const [year, month] = ym.split('-')
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  const m = parseInt(month, 10) - 1
  return `${months[m]}/${String(year).slice(2)}`
}
