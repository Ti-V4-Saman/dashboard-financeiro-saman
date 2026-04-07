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

// ─── Visual config (mirrors DRE) ─────────────────────────────────────────────

type RowKind = 'l1' | 'l2' | 'l3'

const ROW_STYLE: Record<RowKind, { bg: string; fg: string; fw: number; fs: number; py: number }> = {
  l1: { bg: 'var(--surf2)',   fg: 'var(--ink)',  fw: 700, fs: 12, py: 10 },
  l2: { bg: 'var(--surface)', fg: 'var(--ink2)', fw: 600, fs: 11, py: 9  },
  l3: { bg: 'var(--surface)', fg: 'var(--ink)',  fw: 400, fs: 11, py: 8  },
}

const INDENT: Record<RowKind, number> = { l1: 12, l2: 28, l3: 44 }

function numPrefix(s: string): number {
  const m = s.match(/^([\d.]+)/)
  return m ? parseFloat(m[1]) : 999
}
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

  // Collapse state for Mês vs Mês hierarchy
  const [c1, setC1] = useState<Set<string>>(new Set())
  const [c2, setC2] = useState<Set<string>>(new Set())
  const toggleC1 = (l1: string) =>
    setC1(prev => { const n = new Set(prev); n.has(l1) ? n.delete(l1) : n.add(l1); return n })
  const toggleC2 = (l2: string) =>
    setC2(prev => { const n = new Set(prev); n.has(l2) ? n.delete(l2) : n.add(l2); return n })

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

  // Mes1 vs Mes2 — 3-level hierarchy (mirrors DRE)
  const hierComparison = useMemo(() => {
    const rowsForMonth = (ym: string) =>
      op.filter(r => {
        if (!r.data) return false
        const m = `${r.data.getFullYear()}-${String(r.data.getMonth() + 1).padStart(2, '0')}`
        return m === ym
      })

    const buildMap = (rows: Lancamento[]) => {
      const m = new Map<string, Map<string, Map<string, number>>>()
      for (const r of rows) {
        const l1   = r.catSup1 || 'Outros'
        const l2   = r.catSup  || l1
        const l3   = r.cat1    || l2
        const sign = r.tipo === 'Receita' ? 1 : -1
        if (!m.has(l1)) m.set(l1, new Map())
        if (!m.get(l1)!.has(l2)) m.get(l1)!.set(l2, new Map())
        m.get(l1)!.get(l2)!.set(l3, (m.get(l1)!.get(l2)!.get(l3) || 0) + sign * r.valorDRE)
      }
      return m
    }

    const map1 = buildMap(rowsForMonth(mes1))
    const map2 = buildMap(rowsForMonth(mes2))
    const allL1 = new Set([...map1.keys(), ...map2.keys()])

    return [...allL1].sort((a, b) => numPrefix(a) - numPrefix(b)).map(l1 => {
      const m1l2 = map1.get(l1) || new Map<string, Map<string, number>>()
      const m2l2 = map2.get(l1) || new Map<string, Map<string, number>>()
      const allL2 = new Set([...m1l2.keys(), ...m2l2.keys()])

      const l2list = [...allL2].sort((a, b) => numPrefix(a) - numPrefix(b)).map(l2 => {
        const m1l3 = m1l2.get(l2) || new Map<string, number>()
        const m2l3 = m2l2.get(l2) || new Map<string, number>()
        const allL3 = new Set([...m1l3.keys(), ...m2l3.keys()])

        const l3list = [...allL3].sort((a, b) => numPrefix(a) - numPrefix(b)).map(l3 => ({
          l3,
          v1: m1l3.get(l3) || 0,
          v2: m2l3.get(l3) || 0,
        }))
        return { l2, v1: l3list.reduce((s, x) => s + x.v1, 0), v2: l3list.reduce((s, x) => s + x.v2, 0), children: l3list }
      })
      return { l1, v1: l2list.reduce((s, x) => s + x.v1, 0), v2: l2list.reduce((s, x) => s + x.v2, 0), children: l2list }
    })
  }, [op, mes1, mes2])

  // Flat rows for rendering (respects collapse state)
  type CompRow = { id: string; kind: RowKind; label: string; l1Key?: string; l2Key?: string; v1: number; v2: number }
  const compRows = useMemo<CompRow[]>(() => {
    const rows: CompRow[] = []
    for (const { l1, v1, v2, children: l2s } of hierComparison) {
      rows.push({ id: `l1::${l1}`, kind: 'l1', label: l1, l1Key: l1, v1, v2 })
      if (!c1.has(l1)) {
        for (const { l2, v1: p2, v2: r2, children: l3s } of l2s) {
          rows.push({ id: `l2::${l2}`, kind: 'l2', label: l2, l1Key: l1, l2Key: l2, v1: p2, v2: r2 })
          if (!c2.has(l2)) {
            for (const { l3, v1: p3, v2: r3 } of l3s) {
              rows.push({ id: `l3::${l1}::${l2}::${l3}`, kind: 'l3', label: l3, l1Key: l1, l2Key: l2, v1: p3, v2: r3 })
            }
          }
        }
      }
    }
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hierComparison, c1, c2])

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

      {/* ── Mês vs Mês ─────────────────────────────────────────────────────── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
        {/* section header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Comparativo: Mês vs Mês</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Select value={mes1} onValueChange={setMes1}>
              <SelectTrigger className="w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map(m => <SelectItem key={m} value={m}>{mLbl(m)}</SelectItem>)}
              </SelectContent>
            </Select>
            <span style={{ fontSize: 11, color: 'var(--ink3)' }}>vs</span>
            <Select value={mes2} onValueChange={setMes2}>
              <SelectTrigger className="w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map(m => <SelectItem key={m} value={m}>{mLbl(m)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
            <thead>
              <tr style={{ background: 'var(--surf2)', borderBottom: '2px solid var(--line2)' }}>
                {[
                  { label: 'Categoria',  align: 'left'  as const, pl: 16 },
                  { label: mLbl(mes1),   align: 'right' as const, pl: 0  },
                  { label: mLbl(mes2),   align: 'right' as const, pl: 0  },
                  { label: 'Var %',      align: 'right' as const, pl: 0  },
                ].map((col, i) => (
                  <th
                    key={`${col.label}-${i}`}
                    style={{
                      padding: `10px ${col.align === 'right' ? 16 : 0}px 10px ${col.pl || 16}px`,
                      textAlign: col.align,
                      fontSize: 11, fontWeight: 600, color: 'var(--ink3)',
                      whiteSpace: 'nowrap',
                      borderLeft: col.align === 'right' ? '1px solid var(--line)' : undefined,
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compRows.map(row => {
                const s    = ROW_STYLE[row.kind]
                const ind  = INDENT[row.kind]
                const canToggle = row.kind === 'l1' || row.kind === 'l2'
                const isCollapsed = row.kind === 'l1' ? c1.has(row.l1Key!) : row.kind === 'l2' ? c2.has(row.l2Key!) : false
                const arrow = canToggle ? (isCollapsed ? '▸ ' : '▾ ') : ''
                const varPct = row.kind === 'l3' && row.v1 !== 0 ? ((row.v2 - row.v1) / Math.abs(row.v1)) * 100 : null
                const isL1Border = row.kind === 'l1'
                return (
                  <tr
                    key={row.id}
                    style={{
                      background: s.bg,
                      borderBottom: '1px solid var(--line)',
                      borderTop: isL1Border ? '2px solid var(--line2)' : undefined,
                    }}
                  >
                    <td
                      onClick={canToggle ? () => row.kind === 'l1' ? toggleC1(row.l1Key!) : toggleC2(row.l2Key!) : undefined}
                      style={{
                        padding: `${s.py}px 12px ${s.py}px ${ind}px`,
                        fontSize: s.fs, fontWeight: s.fw, color: s.fg,
                        whiteSpace: 'nowrap',
                        cursor: canToggle ? 'pointer' : 'default',
                        userSelect: 'none',
                      }}
                    >
                      {arrow}{row.label}
                    </td>
                    <td style={{ padding: `${s.py}px 16px`, textAlign: 'right', fontSize: s.fs, fontWeight: s.fw, borderLeft: '1px solid var(--line)', whiteSpace: 'nowrap', color: row.v1 >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {fR(row.v1)}
                    </td>
                    <td style={{ padding: `${s.py}px 16px`, textAlign: 'right', fontSize: s.fs, fontWeight: s.fw, borderLeft: '1px solid var(--line)', whiteSpace: 'nowrap', color: row.v2 >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {fR(row.v2)}
                    </td>
                    <td style={{ padding: `${s.py}px 16px`, textAlign: 'right', fontSize: s.fs, fontWeight: row.kind === 'l3' ? 500 : s.fw, borderLeft: '1px solid var(--line)', whiteSpace: 'nowrap', color: varColor(varPct) }}>
                      {row.kind === 'l3' ? varFmt(varPct) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Variação M/M ────────────────────────────────────────────────────── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
        {/* section header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Variação M/M — Receitas, Despesas, Resultado</span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: 640, width: '100%' }}>
            <thead>
              <tr style={{ background: 'var(--surf2)', borderBottom: '2px solid var(--line2)' }}>
                {[
                  { label: 'Mês',       align: 'left'  as const },
                  { label: 'Receita',   align: 'right' as const },
                  { label: 'Var %',     align: 'right' as const },
                  { label: 'Despesa',   align: 'right' as const },
                  { label: 'Var %',     align: 'right' as const },
                  { label: 'Resultado', align: 'right' as const },
                  { label: 'Var %',     align: 'right' as const },
                ].map((col, i) => (
                  <th
                    key={`${col.label}-${i}`}
                    style={{
                      padding: '10px 16px',
                      textAlign: col.align,
                      fontSize: 11, fontWeight: 600, color: 'var(--ink3)',
                      whiteSpace: 'nowrap',
                      borderLeft: i > 0 ? '1px solid var(--line)' : undefined,
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mmTable.map(row => (
                <tr key={row.ym} style={{ background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '9px 16px', fontSize: 11, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                    {row.mes}
                  </td>
                  <td style={{ padding: '9px 16px', textAlign: 'right', fontSize: 11, fontWeight: 500, borderLeft: '1px solid var(--line)', color: 'var(--green)', whiteSpace: 'nowrap' }}>
                    {fR(row.rec)}
                  </td>
                  <td style={{ padding: '9px 16px', textAlign: 'right', fontSize: 10, borderLeft: '1px solid var(--line)', color: varColor(row.varRec), whiteSpace: 'nowrap' }}>
                    {varFmt(row.varRec)}
                  </td>
                  <td style={{ padding: '9px 16px', textAlign: 'right', fontSize: 11, fontWeight: 500, borderLeft: '1px solid var(--line)', color: 'var(--red)', whiteSpace: 'nowrap' }}>
                    {fR(row.desp)}
                  </td>
                  <td style={{ padding: '9px 16px', textAlign: 'right', fontSize: 10, borderLeft: '1px solid var(--line)', color: varColor(row.varDesp, true), whiteSpace: 'nowrap' }}>
                    {varFmt(row.varDesp)}
                  </td>
                  <td style={{ padding: '9px 16px', textAlign: 'right', fontSize: 11, fontWeight: 700, borderLeft: '1px solid var(--line)', color: row.res >= 0 ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap' }}>
                    {fR(row.res)}
                  </td>
                  <td style={{ padding: '9px 16px', textAlign: 'right', fontSize: 10, borderLeft: '1px solid var(--line)', color: varColor(row.varRes), whiteSpace: 'nowrap' }}>
                    {varFmt(row.varRes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
