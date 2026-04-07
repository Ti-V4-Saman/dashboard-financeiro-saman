'use client'

import { useMemo, useState } from 'react'
import type { Lancamento } from '@/lib/types'
import { fR, getMonths, mLbl } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type RowKind = 'l1' | 'l2' | 'l3' | 'subtotal' | 'ebitda' | 'resultado'

interface DRERow {
  id: string
  kind: RowKind
  label: string
  l1Key?: string
  l2Key?: string
  vals: number[] // one value per col (months + '__acc__' last)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function numPrefix(s: string): number {
  const m = s.match(/^([\d.]+)/)
  return m ? parseFloat(m[1]) : 999
}

function fPctStr(val: number, recBruta: number): string {
  if (!recBruta) return '—'
  return ((val / recBruta) * 100).toFixed(1).replace('.', ',') + '%'
}

// ─── Visual config ─────────────────────────────────────────────────────────────

const ROW_STYLE: Record<RowKind, { bg: string; fg: string; fw: number; fs: number; py: number }> = {
  l1:        { bg: 'var(--surf2)',   fg: 'var(--ink)',  fw: 700, fs: 12, py: 10 },
  l2:        { bg: 'var(--surface)', fg: 'var(--ink2)', fw: 600, fs: 11, py: 9  },
  l3:        { bg: 'var(--surface)', fg: 'var(--ink)',  fw: 400, fs: 11, py: 8  },
  subtotal:  { bg: 'var(--surf2)',   fg: 'var(--ink)',  fw: 700, fs: 12, py: 10 },
  ebitda:    { bg: '#fef9ec',        fg: '#92400e',     fw: 700, fs: 12, py: 11 },
  resultado: { bg: '#f0fdf4',        fg: '#166534',     fw: 700, fs: 12, py: 11 },
}

const INDENT: Record<RowKind, number> = {
  l1: 12, l2: 28, l3: 44, subtotal: 12, ebitda: 12, resultado: 12,
}

function valColor(val: number, kind: RowKind): string {
  if (kind === 'ebitda' || kind === 'resultado')
    return val >= 0 ? '#166534' : '#991b1b'
  return val >= 0 ? 'var(--green)' : 'var(--red)'
}

function accumBg(kind: RowKind): string {
  if (kind === 'ebitda')    return '#fef3c7'
  if (kind === 'resultado') return '#dcfce7'
  return 'rgba(22, 101, 52, 0.04)'
}

function accumFg(kind: RowKind): string {
  if (kind === 'ebitda')    return '#92400e'
  if (kind === 'resultado') return '#166534'
  return '' // fall back to valColor
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DRE({ data }: { data: Lancamento[] }) {
  // Only settled, non-transfer transactions
  const op = useMemo(
    () => data.filter(r => !r.isTransfer && r.situacao === 'Quitado'),
    [data],
  )

  const months = useMemo(() => getMonths(op), [op])
  const cols = useMemo(() => [...months, '__acc__'], [months])

  // Pre-compute: month → l1 → l2 → l3 → signed value
  const vm = useMemo(() => {
    const r: Record<string, Record<string, Record<string, Record<string, number>>>> = {}
    for (const row of op) {
      if (!row.data) continue
      const ym = `${row.data.getFullYear()}-${String(row.data.getMonth() + 1).padStart(2, '0')}`
      const sign = row.tipo === 'Receita' ? 1 : -1
      const l1 = row.catSup1 || 'Outros'
      const l2 = row.catSup || l1
      const l3 = row.cat1 || l2
      if (!r[ym]) r[ym] = {}
      if (!r[ym][l1]) r[ym][l1] = {}
      if (!r[ym][l1][l2]) r[ym][l1][l2] = {}
      if (!r[ym][l1][l2][l3]) r[ym][l1][l2][l3] = 0
      r[ym][l1][l2][l3] += sign * row.valor
    }
    return r
  }, [op])

  // Build sorted hierarchy from data
  const hier = useMemo(() => {
    const l1m = new Map<string, Map<string, Set<string>>>()
    for (const row of op) {
      const l1 = row.catSup1 || 'Outros'
      const l2 = row.catSup || l1
      const l3 = row.cat1 || l2
      if (!l1m.has(l1)) l1m.set(l1, new Map())
      if (!l1m.get(l1)!.has(l2)) l1m.get(l1)!.set(l2, new Set())
      l1m.get(l1)!.get(l2)!.add(l3)
    }
    return [...l1m.entries()]
      .sort(([a], [b]) => numPrefix(a) - numPrefix(b))
      .map(([l1, l2m]) => ({
        l1,
        children: [...l2m.entries()]
          .sort(([a], [b]) => numPrefix(a) - numPrefix(b))
          .map(([l2, l3s]) => ({
            l2,
            children: [...l3s].sort((a, b) => numPrefix(a) - numPrefix(b)),
          })),
      }))
  }, [op])

  // Value getters
  const getL3 = (col: string, l1: string, l2: string, l3: string): number => {
    if (col === '__acc__') return months.reduce((s, m) => s + (vm[m]?.[l1]?.[l2]?.[l3] ?? 0), 0)
    return vm[col]?.[l1]?.[l2]?.[l3] ?? 0
  }

  const getL2 = (col: string, l1: string, l2: string): number => {
    if (col === '__acc__') return months.reduce((s, m) => s + getL2(m, l1, l2), 0)
    return Object.values(vm[col]?.[l1]?.[l2] ?? {}).reduce((s, v) => s + v, 0)
  }

  const getL1 = (col: string, l1: string): number => {
    if (col === '__acc__') return months.reduce((s, m) => s + getL1(m, l1), 0)
    let s = 0
    for (const l2v of Object.values(vm[col]?.[l1] ?? {}))
      for (const v of Object.values(l2v)) s += v
    return s
  }

  const groupSum = (col: string, maxPfx: number): number =>
    hier.filter(h => numPrefix(h.l1) <= maxPfx).reduce((s, h) => s + getL1(col, h.l1), 0)

  const makeVals = (fn: (col: string) => number) => cols.map(fn)

  // Collapse state (default: all expanded = nothing in the sets)
  const [c1, setC1] = useState<Set<string>>(new Set())
  const [c2, setC2] = useState<Set<string>>(new Set())

  const toggleL1 = (l1: string) =>
    setC1(prev => { const n = new Set(prev); n.has(l1) ? n.delete(l1) : n.add(l1); return n })
  const toggleL2 = (l2: string) =>
    setC2(prev => { const n = new Set(prev); n.has(l2) ? n.delete(l2) : n.add(l2); return n })

  // Build flat rows list + pre-compute subtotals
  const { dreRows, recBrutaVals } = useMemo(() => {
    const recBrutaVals = makeVals(col => groupSum(col, 1.99))
    const fatLiqVals   = makeVals(col => groupSum(col, 2.99))
    const lucroBrutoVals = makeVals(col => groupSum(col, 3.99))
    const ebitdaVals   = makeVals(col => groupSum(col, 4.99))
    const resLiqVals   = makeVals(col => groupSum(col, 99))

    const dreRows: DRERow[] = []

    for (let i = 0; i < hier.length; i++) {
      const { l1, children: l2s } = hier[i]
      const prefix = numPrefix(l1)

      // L1 row
      dreRows.push({
        id: `l1::${l1}`, kind: 'l1', label: l1, l1Key: l1,
        vals: makeVals(col => getL1(col, l1)),
      })

      if (!c1.has(l1)) {
        for (const { l2, children: l3s } of l2s) {
          // L2 row
          dreRows.push({
            id: `l2::${l2}`, kind: 'l2', label: l2, l1Key: l1, l2Key: l2,
            vals: makeVals(col => getL2(col, l1, l2)),
          })

          if (!c2.has(l2)) {
            for (const l3 of l3s) {
              dreRows.push({
                id: `l3::${l1}::${l2}::${l3}`, kind: 'l3', label: l3,
                l1Key: l1, l2Key: l2,
                vals: makeVals(col => getL3(col, l1, l2, l3)),
              })
            }
          }
        }
      }

      // Insert subtotals at group transitions
      const nextPfx = i + 1 < hier.length ? numPrefix(hier[i + 1].l1) : Infinity
      if (prefix <= 2 && nextPfx > 2)
        dreRows.push({ id: '__fatLiq__',    kind: 'subtotal',  label: '(=) Faturamento Líquido', vals: fatLiqVals })
      if (prefix <= 3 && nextPfx > 3)
        dreRows.push({ id: '__lucroBruto__', kind: 'subtotal',  label: '(=) Lucro Bruto',         vals: lucroBrutoVals })
      if (prefix <= 4 && nextPfx > 4)
        dreRows.push({ id: '__ebitda__',    kind: 'ebitda',    label: '(=) EBITDA',               vals: ebitdaVals })
      if (i === hier.length - 1)
        dreRows.push({ id: '__resLiq__',    kind: 'resultado', label: '(=) Resultado Líquido',    vals: resLiqVals })
    }

    return { dreRows, recBrutaVals }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hier, c1, c2, months, vm])

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (op.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: 'var(--ink3)', fontSize: 12 }}>
        Nenhum lançamento quitado no período selecionado.
      </div>
    )
  }

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            borderCollapse: 'collapse',
            fontSize: 11,
            minWidth: Math.max(800, 300 + months.length * 180),
            width: '100%',
          }}
        >
          {/* ── Header ─────────────────────────────────────────────────────── */}
          <thead>
            {/* Row 1: group names */}
            <tr style={{ background: 'var(--surf2)' }}>
              <th
                rowSpan={2}
                style={{
                  position: 'sticky', left: 0, zIndex: 3,
                  background: 'var(--surf2)',
                  padding: '10px 16px',
                  textAlign: 'left',
                  fontSize: 11, fontWeight: 600, color: 'var(--ink3)',
                  minWidth: 280, whiteSpace: 'nowrap',
                  borderRight: '2px solid var(--line)',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                Descrição
              </th>
              {cols.map((col, ci) => {
                const isAcc = ci === cols.length - 1
                return (
                  <th
                    key={col}
                    colSpan={2}
                    style={{
                      padding: '8px 10px',
                      textAlign: 'center',
                      fontSize: 11, fontWeight: 700,
                      whiteSpace: 'nowrap',
                      borderLeft: '1px solid var(--line)',
                      borderBottom: '1px solid var(--line)',
                      background: isAcc ? '#dcfce7' : 'var(--surf2)',
                      color: isAcc ? '#166534' : 'var(--ink)',
                    }}
                  >
                    {isAcc ? 'Acumulado' : mLbl(col)}
                  </th>
                )
              })}
            </tr>
            {/* Row 2: R$ / % */}
            <tr style={{ background: 'var(--surf2)', borderBottom: '2px solid var(--line2)' }}>
              {cols.flatMap((col, ci) => {
                const isAcc = ci === cols.length - 1
                const bg    = isAcc ? '#bbf7d0' : 'var(--surf2)'
                const fg    = isAcc ? '#166534' : 'var(--ink3)'
                const base: React.CSSProperties = {
                  padding: '5px 8px', fontSize: 10, fontWeight: 600,
                  color: fg, background: bg, whiteSpace: 'nowrap',
                }
                return [
                  <th key={`${col}-r`} style={{ ...base, textAlign: 'right', borderLeft: '1px solid var(--line)' }}>R$</th>,
                  <th key={`${col}-p`} style={{ ...base, textAlign: 'right' }}>%</th>,
                ]
              })}
            </tr>
          </thead>

          {/* ── Body ───────────────────────────────────────────────────────── */}
          <tbody>
            {dreRows.map(row => {
              const s    = ROW_STYLE[row.kind]
              const ind  = INDENT[row.kind]
              const canT = row.kind === 'l1' || row.kind === 'l2'
              const collapsed =
                row.kind === 'l1' ? c1.has(row.l1Key!) :
                row.kind === 'l2' ? c2.has(row.l2Key!) : false
              const arrow = canT ? (collapsed ? '▸ ' : '▾ ') : ''

              return (
                <tr
                  key={row.id}
                  style={{
                    background: s.bg,
                    borderBottom: '1px solid var(--line)',
                    borderTop: (row.kind === 'subtotal' || row.kind === 'ebitda' || row.kind === 'resultado') ? '2px solid var(--line2)' : undefined,
                  }}
                >
                  {/* Sticky description cell */}
                  <td
                    onClick={() => {
                      if (row.kind === 'l1') toggleL1(row.l1Key!)
                      if (row.kind === 'l2') toggleL2(row.l2Key!)
                    }}
                    style={{
                      position: 'sticky', left: 0, zIndex: 2,
                      background: s.bg,
                      color: s.fg,
                      fontWeight: s.fw,
                      fontSize: s.fs,
                      padding: `${s.py}px 16px ${s.py}px ${ind}px`,
                      cursor: canT ? 'pointer' : 'default',
                      whiteSpace: 'nowrap',
                      borderRight: '2px solid var(--line)',
                      userSelect: 'none',
                    }}
                  >
                    {arrow}{row.label}
                  </td>

                  {/* Value cells */}
                  {cols.flatMap((col, ci) => {
                    const isAcc = ci === cols.length - 1
                    const val   = row.vals[ci]
                    const bg    = isAcc && accumBg(row.kind) ? accumBg(row.kind) : s.bg
                    const fg    = isAcc && accumFg(row.kind) ? accumFg(row.kind) : valColor(val, row.kind)
                    const pctFg = row.kind === 'ebitda' || row.kind === 'resultado'
                      ? 'rgba(0,0,0,0.45)'
                      : 'var(--ink3)'

                    return [
                      <td
                        key={`${row.id}-${col}-r`}
                        style={{
                          padding: `${s.py}px 8px`,
                          textAlign: 'right',
                          fontWeight: row.kind === 'l3' ? 400 : s.fw,
                          fontSize: s.fs,
                          color: fg,
                          background: bg,
                          borderLeft: '1px solid var(--line)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {fR(val)}
                      </td>,
                      <td
                        key={`${row.id}-${col}-p`}
                        style={{
                          padding: `${s.py}px 8px`,
                          textAlign: 'right',
                          fontWeight: 400,
                          fontSize: 10,
                          color: pctFg,
                          background: bg,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {fPctStr(val, recBrutaVals[ci])}
                      </td>,
                    ]
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
