'use client'

import { useMemo, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { Lancamento } from '@/lib/types'
import { fR, getMonths, mLbl } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Props {
  data: Lancamento[]
  allData: Lancamento[]
}

export function Comparativo({ data, allData }: Props) {
  const op    = useMemo(() => data.filter(r => !r.isTransfer), [data])
  const allOp = useMemo(() => allData.filter(r => !r.isTransfer), [allData])

  // months derived from filtered data → chart and tables respect the selected period
  const months = useMemo(() => getMonths(op), [op])

  const [mes1, setMes1] = useState(months[months.length - 2] || months[0] || '')
  const [mes2, setMes2] = useState(months[months.length - 1] || months[0] || '')

  // Monthly line chart data
  const monthlyData = useMemo(() => {
    return months.map(ym => {
      const rows = op.filter(r => {
        if (!r.data) return false
        const m = `${r.data.getFullYear()}-${String(r.data.getMonth() + 1).padStart(2, '0')}`
        return m === ym
      })
      const rec = rows.filter(r => r.tipo === 'Receita').reduce((s, r) => s + r.valorDRE, 0)
      const desp = rows.filter(r => r.tipo === 'Despesa').reduce((s, r) => s + r.valorDRE, 0)
      return {
        mes: mLbl(ym),
        receita: rec,
        despesa: desp,
        resultado: rec - desp,
      }
    })
  }, [op, months])

  // Comparison table by month
  const mmTable = useMemo(() => {
    const result = months.map((ym, i) => {
      const rows = op.filter(r => {
        if (!r.data) return false
        const m = `${r.data.getFullYear()}-${String(r.data.getMonth() + 1).padStart(2, '0')}`
        return m === ym
      })
      const rec  = rows.filter(r => r.tipo === 'Receita').reduce((s, r) => s + r.valorDRE, 0)
      const desp = rows.filter(r => r.tipo === 'Despesa').reduce((s, r) => s + r.valorDRE, 0)

      // Previous month
      let prevRec = 0, prevDesp = 0
      if (i > 0) {
        const prevYm = months[i - 1]
        const prevMonthRows = op.filter(r => {
          if (!r.data) return false
          const m = `${r.data.getFullYear()}-${String(r.data.getMonth() + 1).padStart(2, '0')}`
          return m === prevYm
        })
        prevRec  = prevMonthRows.filter(r => r.tipo === 'Receita').reduce((s, r) => s + r.valorDRE, 0)
        prevDesp = prevMonthRows.filter(r => r.tipo === 'Despesa').reduce((s, r) => s + r.valorDRE, 0)
      }

      const varRec = prevRec > 0 ? ((rec - prevRec) / prevRec) * 100 : null
      const varDesp = prevDesp > 0 ? ((desp - prevDesp) / prevDesp) * 100 : null
      const res = rec - desp
      const prevRes = prevRec - prevDesp
      const varRes = prevRes !== 0 ? ((res - prevRes) / Math.abs(prevRes)) * 100 : null

      return { ym, mes: mLbl(ym), rec, desp, res, varRec, varDesp, varRes }
    })
    return result
  }, [op, months])

  // Mes1 vs Mes2 by category
  const catComparison = useMemo(() => {
    const getForMonth = (ym: string) => {
      const rows = op.filter(r => {
        if (!r.data) return false
        const m = `${r.data.getFullYear()}-${String(r.data.getMonth() + 1).padStart(2, '0')}`
        return m === ym
      })
      const catMap = new Map<string, number>()
      for (const r of rows) {
        const key = r.cat1 || 'Sem categoria'
        catMap.set(key, (catMap.get(key) || 0) + (r.tipo === 'Receita' ? r.valorDRE : -r.valorDRE))
      }
      return catMap
    }

    const map1 = getForMonth(mes1)
    const map2 = getForMonth(mes2)
    const cats = new Set([...map1.keys(), ...map2.keys()])

    return Array.from(cats)
      .map(cat => ({
        cat,
        v1: map1.get(cat) || 0,
        v2: map2.get(cat) || 0,
      }))
      .sort((a, b) => Math.abs(b.v2) - Math.abs(a.v2))
  }, [op, mes1, mes2])

  const fmtShort = (v: number) => {
    if (Math.abs(v) >= 1_000_000) return `R$${(v / 1_000_000).toFixed(1)}M`
    if (Math.abs(v) >= 1_000) return `R$${(v / 1_000).toFixed(0)}K`
    return fR(v)
  }

  const varColor = (v: number | null, invert = false) => {
    if (v === null) return 'var(--ink3)'
    if (invert) return v > 0 ? 'var(--red)' : 'var(--green)'
    return v > 0 ? 'var(--green)' : 'var(--red)'
  }

  const varFmt = (v: number | null) => {
    if (v === null) return '—'
    const prefix = v >= 0 ? '+' : ''
    return `${prefix}${v.toFixed(1)}%`
  }

  return (
    <div className="space-y-4">
      {/* Line chart */}
      <Card>
        <CardHeader>
          <CardTitle>Evolução Mensal — Receitas / Despesas / Resultado</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={monthlyData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <XAxis dataKey="mes" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} tickFormatter={fmtShort} width={55} />
              <Tooltip
                formatter={(v: number) => fR(v)}
                contentStyle={{ border: '1px solid var(--line)', borderRadius: 6, background: 'var(--surface)', fontSize: 11 }}
              />
              <Legend wrapperStyle={{ fontSize: 10, color: 'var(--ink3)' }} />
              <Line type="monotone" dataKey="receita" name="Receita" stroke="var(--green)" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="despesa" name="Despesa" stroke="var(--red)" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="resultado" name="Resultado" stroke="var(--blue)" strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Mês vs Mês comparison */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle>Comparativo: Mês vs Mês</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={mes1} onValueChange={setMes1}>
                <SelectTrigger className="w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map(m => (
                    <SelectItem key={m} value={m}>{mLbl(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-[11px]" style={{ color: 'var(--ink3)' }}>vs</span>
              <Select value={mes2} onValueChange={setMes2}>
                <SelectTrigger className="w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map(m => (
                    <SelectItem key={m} value={m}>{mLbl(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <th className="py-1.5 pl-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Categoria</th>
                <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>{mLbl(mes1)}</th>
                <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>{mLbl(mes2)}</th>
                <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Var %</th>
              </tr>
            </thead>
            <tbody>
              {catComparison.slice(0, 30).map(c => {
                const varPct = c.v1 !== 0 ? ((c.v2 - c.v1) / Math.abs(c.v1)) * 100 : null
                return (
                  <tr key={c.cat} style={{ borderBottom: '1px solid var(--line)' }} className="hover:bg-[var(--surf2)] transition-colors">
                    <td className="py-2 pl-3 text-[11px]" style={{ color: 'var(--ink2)' }}>{c.cat}</td>
                    <td className="py-2 pr-3 text-right text-[11px] font-semibold" style={{ color: c.v1 >= 0 ? 'var(--green)' : 'var(--red)' }}>{fR(c.v1)}</td>
                    <td className="py-2 pr-3 text-right text-[11px] font-semibold" style={{ color: c.v2 >= 0 ? 'var(--green)' : 'var(--red)' }}>{fR(c.v2)}</td>
                    <td className="py-2 pr-3 text-right text-[11px] font-semibold" style={{ color: varColor(varPct) }}>
                      {varFmt(varPct)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* M/M table */}
      <Card>
        <CardHeader>
          <CardTitle>Variação M/M — Receitas, Despesas, Resultado</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th className="py-1.5 pl-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Mês</th>
                  <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Receita</th>
                  <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Var %</th>
                  <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Despesa</th>
                  <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Var %</th>
                  <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Resultado</th>
                  <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Var %</th>
                </tr>
              </thead>
              <tbody>
                {mmTable.map(row => (
                  <tr key={row.ym} style={{ borderBottom: '1px solid var(--line)' }} className="hover:bg-[var(--surf2)] transition-colors">
                    <td className="py-2 pl-3 text-[11px] font-semibold" style={{ color: 'var(--ink)' }}>{row.mes}</td>
                    <td className="py-2 pr-3 text-right text-[11px] font-semibold" style={{ color: 'var(--green)' }}>{fR(row.rec)}</td>
                    <td className="py-2 pr-3 text-right text-[11px]" style={{ color: varColor(row.varRec) }}>{varFmt(row.varRec)}</td>
                    <td className="py-2 pr-3 text-right text-[11px] font-semibold" style={{ color: 'var(--red)' }}>{fR(row.desp)}</td>
                    <td className="py-2 pr-3 text-right text-[11px]" style={{ color: varColor(row.varDesp, true) }}>{varFmt(row.varDesp)}</td>
                    <td className="py-2 pr-3 text-right text-[11px] font-bold" style={{ color: row.res >= 0 ? 'var(--green)' : 'var(--red)' }}>{fR(row.res)}</td>
                    <td className="py-2 pr-3 text-right text-[11px]" style={{ color: varColor(row.varRes) }}>{varFmt(row.varRes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
