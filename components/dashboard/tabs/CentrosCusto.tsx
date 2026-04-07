'use client'

import { useMemo, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import type { Lancamento } from '@/lib/types'
import { fR } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'

interface Props {
  data: Lancamento[]
}

export function CentrosCusto({ data }: Props) {
  const [search, setSearch] = useState('')

  const op = useMemo(() => data.filter(r => !r.isTransfer), [data])

  // Aggregate by CC
  const ccMap = useMemo(() => {
    const map = new Map<string, { rec: number; desp: number }>()
    for (const r of op) {
      for (const c of r._ccList) {
        if (!c.nome || c.nome === '(em branco)') continue
        if (!map.has(c.nome)) map.set(c.nome, { rec: 0, desp: 0 })
        const entry = map.get(c.nome)!
        if (r.tipo === 'Receita') entry.rec += r.valor
        else entry.desp += r.valor
      }
    }
    return map
  }, [op])

  const ccList = useMemo(
    () =>
      Array.from(ccMap.entries())
        .map(([nome, { rec, desp }]) => ({
          nome,
          rec,
          desp,
          resultado: rec - desp,
        }))
        .sort((a, b) => b.desp - a.desp),
    [ccMap]
  )

  const top5 = ccList.slice(0, 5)

  const recByCC = useMemo(
    () =>
      [...ccList]
        .sort((a, b) => b.rec - a.rec)
        .slice(0, 15)
        .map(c => ({ name: c.nome, value: c.rec })),
    [ccList]
  )

  const despByCC = useMemo(
    () =>
      [...ccList]
        .sort((a, b) => b.desp - a.desp)
        .slice(0, 15)
        .map(c => ({ name: c.nome, value: c.desp })),
    [ccList]
  )

  const resultByCC = useMemo(
    () =>
      [...ccList]
        .sort((a, b) => b.resultado - a.resultado)
        .slice(0, 15)
        .map(c => ({ name: c.nome, value: c.resultado })),
    [ccList]
  )

  const filteredCC = useMemo(() => {
    if (!search) return ccList
    const q = search.toLowerCase()
    return ccList.filter(c => c.nome.toLowerCase().includes(q))
  }, [ccList, search])

  const fmtShort = (v: number) => {
    if (Math.abs(v) >= 1_000_000) return `R$${(v / 1_000_000).toFixed(1)}M`
    if (Math.abs(v) >= 1_000) return `R$${(v / 1_000).toFixed(0)}K`
    return fR(v)
  }

  const barTooltip = {
    contentStyle: {
      border: '1px solid var(--line)',
      borderRadius: 6,
      background: 'var(--surface)',
      fontSize: 11,
    },
  }

  return (
    <div className="space-y-4">
      {/* Top 5 KPIs */}
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {top5.map(c => (
          <div
            key={c.nome}
            className="rounded-lg p-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider truncate mb-1.5" style={{ color: 'var(--ink3)' }} title={c.nome}>
              {c.nome}
            </div>
            <div className="text-[16px] font-bold leading-none tracking-tight" style={{ color: c.resultado >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {fR(c.resultado)}
            </div>
            <div className="mt-1 text-[10px]" style={{ color: 'var(--ink3)' }}>
              Rec: {fR(c.rec)} · Desp: {fR(c.desp)}
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Card>
          <CardHeader><CardTitle>Receitas por CC</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={recByCC} layout="vertical" margin={{ left: 0, right: 16 }}>
                <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} tickFormatter={fmtShort} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} width={90} />
                <Tooltip formatter={(v: number) => fR(v)} {...barTooltip} />
                <Bar dataKey="value" name="Receita" fill="var(--green)" radius={[0, 3, 3, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Despesas por CC</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={despByCC} layout="vertical" margin={{ left: 0, right: 16 }}>
                <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} tickFormatter={fmtShort} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} width={90} />
                <Tooltip formatter={(v: number) => fR(v)} {...barTooltip} />
                <Bar dataKey="value" name="Despesa" fill="var(--red)" radius={[0, 3, 3, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Resultado por CC */}
      <Card>
        <CardHeader><CardTitle>Resultado por CC</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={resultByCC} margin={{ left: 0, right: 16 }}>
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} tickFormatter={fmtShort} width={55} />
              <Tooltip formatter={(v: number) => fR(v)} {...barTooltip} />
              <Bar dataKey="value" name="Resultado" radius={[3, 3, 0, 0]} maxBarSize={32}>
                {resultByCC.map((d, i) => (
                  <Cell key={i} fill={d.value >= 0 ? 'var(--green)' : 'var(--red)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Tabela detalhada */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Detalhamento por CC</CardTitle>
            <div className="relative w-48">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3" style={{ color: 'var(--ink3)' }} />
              <Input placeholder="Buscar CC..." value={search} onChange={e => setSearch(e.target.value)} className="pl-6" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <th className="py-1.5 pl-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Centro de Custo</th>
                <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Receita</th>
                <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Despesa</th>
                <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {filteredCC.map(c => (
                <tr key={c.nome} style={{ borderBottom: '1px solid var(--line)' }} className="hover:bg-[var(--surf2)] transition-colors">
                  <td className="py-2 pl-3 text-[11px]" style={{ color: 'var(--ink2)' }}>{c.nome}</td>
                  <td className="py-2 pr-3 text-right text-[11px] font-semibold" style={{ color: 'var(--green)' }}>{fR(c.rec)}</td>
                  <td className="py-2 pr-3 text-right text-[11px] font-semibold" style={{ color: 'var(--red)' }}>{fR(c.desp)}</td>
                  <td className="py-2 pr-3 text-right text-[11px] font-bold" style={{ color: c.resultado >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {fR(c.resultado)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
