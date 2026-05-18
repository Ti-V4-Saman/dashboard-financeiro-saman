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

  // Group "Administrativo*" CCs into a single consolidated KPI card
  const { adminCard, nonAdminTop } = useMemo(() => {
    const adminCCs = ccList.filter(c => c.nome.toLowerCase().startsWith('administrativo'))
    const nonAdmin = ccList.filter(c => !c.nome.toLowerCase().startsWith('administrativo'))
    const adminTotals = adminCCs.reduce(
      (acc, c) => ({ rec: acc.rec + c.rec, desp: acc.desp + c.desp }),
      { rec: 0, desp: 0 }
    )
    return {
      adminCard: adminCCs.length > 0
        ? { nome: 'Administrativo', rec: adminTotals.rec, desp: adminTotals.desp, resultado: adminTotals.rec - adminTotals.desp, count: adminCCs.length }
        : null,
      nonAdminTop: nonAdmin.slice(0, adminCCs.length > 0 ? 4 : 5),
    }
  }, [ccList])

  const recByCC = useMemo(
    () =>
      [...ccList]
        .sort((a, b) => b.rec - a.rec)
        .filter(c => c.rec > 0)
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

  // Altura dinâmica para gráficos horizontais
  const hBarHeight = (n: number) => Math.max(200, n * 28)

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
      {/* KPIs — admin agrupado + top operacionais */}
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        {/* Card consolidado Administrativo */}
        {adminCard && (
          <div
            className="rounded-lg p-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>
                Administrativo
              </div>
              <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none" style={{ background: 'var(--surf2)', color: 'var(--ink3)' }}>
                {adminCard.count} CCs
              </span>
            </div>
            <div className="text-[16px] font-bold leading-none tracking-tight" style={{ color: adminCard.resultado >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {fR(adminCard.resultado)}
            </div>
            <div className="mt-1 text-[10px]" style={{ color: 'var(--ink3)' }}>
              Rec: {fR(adminCard.rec)} · Desp: {fR(adminCard.desp)}
            </div>
          </div>
        )}

        {/* Cards individuais não-administrativos */}
        {nonAdminTop.map(c => (
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
      <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
        <Card>
          <CardHeader><CardTitle>Receitas por CC</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={hBarHeight(recByCC.length)}>
              <BarChart data={recByCC} layout="vertical" margin={{ left: 0, right: 16 }}>
                <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} tickFormatter={fmtShort} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} width={150} />
                <Tooltip formatter={(v: number) => fR(v)} {...barTooltip} />
                <Bar dataKey="value" name="Receita" fill="var(--green)" radius={[0, 3, 3, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Despesas por CC</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={hBarHeight(despByCC.length)}>
              <BarChart data={despByCC} layout="vertical" margin={{ left: 0, right: 16 }}>
                <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} tickFormatter={fmtShort} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} width={150} />
                <Tooltip formatter={(v: number) => fR(v)} {...barTooltip} />
                <Bar dataKey="value" name="Despesa" fill="var(--red)" radius={[0, 3, 3, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Resultado por CC — horizontal para legibilidade */}
      <Card>
        <CardHeader><CardTitle>Resultado por CC</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={hBarHeight(resultByCC.length)}>
            <BarChart data={resultByCC} layout="vertical" margin={{ left: 0, right: 60 }}>
              <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} tickFormatter={fmtShort} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} width={150} />
              <Tooltip formatter={(v: number) => fR(v)} {...barTooltip} />
              <Bar dataKey="value" name="Resultado" radius={[0, 3, 3, 0]} maxBarSize={16}
                label={{ position: 'right', fontSize: 9, fill: 'var(--ink3)', formatter: fmtShort }}
              >
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
