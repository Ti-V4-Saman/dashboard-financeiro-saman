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
    if (r.data) {
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
