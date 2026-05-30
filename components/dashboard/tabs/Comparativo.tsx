'use client'

import { useMemo, useState, useEffect } from 'react'
import useSWR from 'swr'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import type { Lancamento, Filters } from '@/lib/types'
import { fR, mLbl, getL2Label } from '@/lib/utils'
import { isAggClientEnabled } from '@/lib/feature-aggregation'
import { aggFetcher, buildAggQuery } from '@/lib/agg-client'
import { aggComparativo, type ComparativoAgg } from '@/lib/aggregations/comparativo'

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
  data?: Lancamento[]
  allData?: Lancamento[]
  filters?: Filters
}

export function Comparativo({ data, allData, filters }: Props) {
  const regime = filters?.regime ?? 'competencia'

  // Caminho duplo (Fase 2): ON → endpoint agregado; OFF → função pura local.
  // O endpoint devolve monthlyData/mmTable/ytd prontos + vmComp (somas por
  // mês→categoria, SEM linha crua); a comparação Mês1×Mês2 e o collapse ficam aqui.
  const aggOn = isAggClientEnabled()
  const endpoint = aggOn && filters ? `/api/agg/comparativo?${buildAggQuery(filters)}` : null
  const { data: remoteAgg } = useSWR<ComparativoAgg>(endpoint, aggFetcher, { keepPreviousData: true })
  const localAgg = useMemo(
    () => aggComparativo(data ?? [], allData ?? [], regime),
    [data, allData, regime],
  )
  const agg: ComparativoAgg | undefined = aggOn ? remoteAgg : localAgg

  const months = useMemo(() => agg?.months ?? [], [agg])
  const monthlyData = agg?.monthlyData ?? []
  const mmTable = agg?.mmTable ?? []
  const ytd = agg?.ytd ?? { rec: 0, desp: 0, res: 0, margem: null }
  const vmComp = useMemo(() => agg?.vmComp ?? {}, [agg])

  const [mes1, setMes1] = useState('')
  const [mes2, setMes2] = useState('')
  // Inicializa/realinha mes1/mes2 quando os meses chegam (ON carrega async).
  useEffect(() => {
    if (months.length === 0) return
    setMes1(prev => (prev && months.includes(prev)) ? prev : (months[months.length - 2] || months[0] || ''))
    setMes2(prev => (prev && months.includes(prev)) ? prev : (months[months.length - 1] || months[0] || ''))
  }, [months])

  // Collapse state — set de EXPANDIDOS (vazio = tudo fechado por padrão)
  const [exp1, setExp1] = useState<Set<string>>(new Set())
  const [exp2, setExp2] = useState<Set<string>>(new Set())
  const toggleC1 = (l1: string) =>
    setExp1(prev => { const n = new Set(prev); n.has(l1) ? n.delete(l1) : n.add(l1); return n })
  const toggleC2 = (l2: string) =>
    setExp2(prev => { const n = new Set(prev); n.has(l2) ? n.delete(l2) : n.add(l2); return n })

  // Mes1 vs Mes2 — hierarquia 3 níveis, montada a partir de vmComp (sem linha crua)
  const hierComparison = useMemo(() => {
    const node1 = vmComp[mes1] || {}
    const node2 = vmComp[mes2] || {}
    const allL1 = new Set([...Object.keys(node1), ...Object.keys(node2)])

    return [...allL1].sort((a, b) => numPrefix(a) - numPrefix(b)).map(l1 => {
      const m1l2 = node1[l1] || {}
      const m2l2 = node2[l1] || {}
      const allL2 = new Set([...Object.keys(m1l2), ...Object.keys(m2l2)])

      const l2list = [...allL2].sort((a, b) => numPrefix(a) - numPrefix(b)).map(l2 => {
        const m1l3 = m1l2[l2] || {}
        const m2l3 = m2l2[l2] || {}
        const allL3 = new Set([...Object.keys(m1l3), ...Object.keys(m2l3)])

        const l3list = [...allL3].sort((a, b) => numPrefix(a) - numPrefix(b)).map(l3 => ({
          l3,
          v1: m1l3[l3] || 0,
          v2: m2l3[l3] || 0,
        }))
        return { l2, v1: l3list.reduce((s, x) => s + x.v1, 0), v2: l3list.reduce((s, x) => s + x.v2, 0), children: l3list }
      })
      return { l1, v1: l2list.reduce((s, x) => s + x.v1, 0), v2: l2list.reduce((s, x) => s + x.v2, 0), children: l2list }
    })
  }, [vmComp, mes1, mes2])

  // Flat rows for rendering (respects collapse state)
  type CompRow = { id: string; kind: RowKind; label: string; l1Key?: string; l2Key?: string; v1: number; v2: number }
  const compRows = useMemo<CompRow[]>(() => {
    const rows: CompRow[] = []
    for (const { l1, v1, v2, children: l2s } of hierComparison) {
      rows.push({ id: `l1::${l1}`, kind: 'l1', label: l1, l1Key: l1, v1, v2 })
      if (exp1.has(l1)) {
        for (const { l2, v1: p2, v2: r2, children: l3s } of l2s) {
          rows.push({ id: `l2::${l2}`, kind: 'l2', label: getL2Label(l2), l1Key: l1, l2Key: l2, v1: p2, v2: r2 })
          if (exp2.has(l2)) {
            for (const { l3, v1: p3, v2: r3 } of l3s) {
              rows.push({ id: `l3::${l1}::${l2}::${l3}`, kind: 'l3', label: l3, l1Key: l1, l2Key: l2, v1: p3, v2: r3 })
            }
          }
        }
      }
    }
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hierComparison, exp1, exp2])

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
    if (Math.abs(v) > 500) return `${prefix}${v > 0 ? '>500' : '<-500'}%*`
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
              <ReferenceLine y={0} stroke="var(--line2)" strokeDasharray="3 3" strokeWidth={1} />
              <Line type="monotone" dataKey="receita" name="Receita" stroke="var(--green)" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="despesa" name="Despesa" stroke="var(--red)" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="resultado" name="Resultado" stroke="var(--blue)" strokeWidth={2.5} strokeDasharray="4 2" dot={{ r: 3.5 }} />
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
                const isExpanded = row.kind === 'l1' ? exp1.has(row.l1Key!) : row.kind === 'l2' ? exp2.has(row.l2Key!) : false
                const arrow = canToggle ? (isExpanded ? '▾ ' : '▸ ') : ''
                const varPct = row.v1 !== 0 ? ((row.v2 - row.v1) / Math.abs(row.v1)) * 100 : null
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
                    <td style={{ padding: `${s.py}px 16px`, textAlign: 'right', fontSize: s.fs, fontWeight: 500, borderLeft: '1px solid var(--line)', whiteSpace: 'nowrap', color: varColor(varPct) }}>
                      {varFmt(varPct)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Variação M/M + YoY ──────────────────────────────────────────────── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Evolução Mensal — M/M e Ano vs Ano (YoY)</span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: 900, width: '100%' }}>
            <thead>
              {/* Grupo de colunas */}
              <tr style={{ background: 'var(--surf2)', borderBottom: '1px solid var(--line)' }}>
                <th rowSpan={2} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--ink3)', whiteSpace: 'nowrap', borderBottom: '2px solid var(--line2)' }}>Mês</th>
                <th colSpan={3} style={{ padding: '6px 16px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--green)', borderLeft: '2px solid var(--line2)', borderBottom: '1px solid var(--line)' }}>Receita</th>
                <th colSpan={3} style={{ padding: '6px 16px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--red)', borderLeft: '2px solid var(--line2)', borderBottom: '1px solid var(--line)' }}>Despesa</th>
                <th colSpan={3} style={{ padding: '6px 16px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--blue)', borderLeft: '2px solid var(--line2)', borderBottom: '1px solid var(--line)' }}>Resultado</th>
                <th rowSpan={2} style={{ padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--ink3)', borderLeft: '2px solid var(--line2)', whiteSpace: 'nowrap', borderBottom: '2px solid var(--line2)' }}>Margem %</th>
              </tr>
              <tr style={{ background: 'var(--surf2)', borderBottom: '2px solid var(--line2)' }}>
                {(['Receita', 'Despesa', 'Resultado'] as const).flatMap(g => [
                  <th key={`${g}-val`} style={{ padding: '6px 12px', textAlign: 'right', fontSize: 10, fontWeight: 600, color: 'var(--ink3)', borderLeft: '2px solid var(--line2)', whiteSpace: 'nowrap' }}>R$</th>,
                  <th key={`${g}-mm`}  style={{ padding: '6px 12px', textAlign: 'right', fontSize: 10, fontWeight: 600, color: 'var(--ink3)', borderLeft: '1px solid var(--line)', whiteSpace: 'nowrap' }}>M/M%</th>,
                  <th key={`${g}-yoy`} style={{ padding: '6px 12px', textAlign: 'right', fontSize: 10, fontWeight: 600, color: 'var(--ink3)', borderLeft: '1px solid var(--line)', whiteSpace: 'nowrap' }}>YoY%</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {mmTable.map(row => (
                <tr key={row.ym} style={{ background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '9px 16px', fontSize: 11, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{row.mes}</td>
                  {/* Receita */}
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 11, fontWeight: 500, borderLeft: '2px solid var(--line2)', color: 'var(--green)', whiteSpace: 'nowrap' }}>{fR(row.rec)}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 10, borderLeft: '1px solid var(--line)', color: varColor(row.varRec), whiteSpace: 'nowrap' }}>{varFmt(row.varRec)}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 10, borderLeft: '1px solid var(--line)', color: varColor(row.varYoYRec), whiteSpace: 'nowrap' }}>{row.hasYoY ? varFmt(row.varYoYRec) : <span style={{ color: 'var(--ink3)' }}>s/d</span>}</td>
                  {/* Despesa */}
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 11, fontWeight: 500, borderLeft: '2px solid var(--line2)', color: 'var(--red)', whiteSpace: 'nowrap' }}>{fR(row.desp)}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 10, borderLeft: '1px solid var(--line)', color: varColor(row.varDesp, true), whiteSpace: 'nowrap' }}>{varFmt(row.varDesp)}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 10, borderLeft: '1px solid var(--line)', color: varColor(row.varYoYDesp, true), whiteSpace: 'nowrap' }}>{row.hasYoY ? varFmt(row.varYoYDesp) : <span style={{ color: 'var(--ink3)' }}>s/d</span>}</td>
                  {/* Resultado */}
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, borderLeft: '2px solid var(--line2)', color: row.res >= 0 ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap' }}>{fR(row.res)}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 10, borderLeft: '1px solid var(--line)', color: varColor(row.varRes), whiteSpace: 'nowrap' }}>{varFmt(row.varRes)}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 10, borderLeft: '1px solid var(--line)', color: varColor(row.varYoYRes), whiteSpace: 'nowrap' }}>{row.hasYoY ? varFmt(row.varYoYRes) : <span style={{ color: 'var(--ink3)' }}>s/d</span>}</td>
                  {/* Margem */}
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, borderLeft: '2px solid var(--line2)', whiteSpace: 'nowrap', color: row.rec > 0 ? (row.res >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--ink3)' }}>
                    {row.rec > 0 ? `${((row.res / row.rec) * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            {/* YTD footer */}
            <tfoot>
              <tr style={{ background: '#dcfce7', borderTop: '2px solid var(--line2)' }}>
                <td style={{ padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#166534', whiteSpace: 'nowrap' }}>Acumulado YTD</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, borderLeft: '2px solid var(--line2)', color: '#166534', whiteSpace: 'nowrap' }}>{fR(ytd.rec)}</td>
                <td style={{ padding: '10px 12px', borderLeft: '1px solid var(--line)' }} />
                <td style={{ padding: '10px 12px', borderLeft: '1px solid var(--line)' }} />
                <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, borderLeft: '2px solid var(--line2)', color: '#166534', whiteSpace: 'nowrap' }}>{fR(ytd.desp)}</td>
                <td style={{ padding: '10px 12px', borderLeft: '1px solid var(--line)' }} />
                <td style={{ padding: '10px 12px', borderLeft: '1px solid var(--line)' }} />
                <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, borderLeft: '2px solid var(--line2)', color: ytd.res >= 0 ? '#166534' : '#991b1b', whiteSpace: 'nowrap' }}>{fR(ytd.res)}</td>
                <td style={{ padding: '10px 12px', borderLeft: '1px solid var(--line)' }} />
                <td style={{ padding: '10px 12px', borderLeft: '1px solid var(--line)' }} />
                <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, borderLeft: '2px solid var(--line2)', color: ytd.margem !== null ? (ytd.margem >= 0 ? '#166534' : '#991b1b') : 'var(--ink3)', whiteSpace: 'nowrap' }}>
                  {ytd.margem !== null ? `${ytd.margem.toFixed(1)}%` : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
