'use client'

import { useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import type { Lancamento } from '@/lib/types'
import { fR, fDt } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

interface Props {
  data: Lancamento[]
}

const COLORS = ['#1B55A3', '#14703F', '#D41F1F', '#8B5B0D', '#384858', '#888480', '#B52C2C', '#45433D', '#CCC9C1', '#E2DFD8']

function KpiCard({
  label,
  value,
  color,
  sub,
}: {
  label: string
  value: string
  color?: string
  sub?: string
}) {
  return (
    <div
      className="rounded-lg p-4 relative overflow-hidden transition-shadow hover:shadow-md"
      style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
    >
      <div className="text-[10px] font-semibold tracking-wider uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>
        {label}
      </div>
      <div className="text-[20px] font-bold leading-none tracking-tight" style={{ color: color || 'var(--ink)' }}>
        {value}
      </div>
      {sub && (
        <div className="mt-1 text-[10px]" style={{ color: 'var(--ink3)' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

function BarListItem({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="py-1.5">
      <div className="flex justify-between text-[11px] mb-1">
        <span className="truncate mr-2" style={{ color: 'var(--ink2)', maxWidth: '65%' }} title={label}>{label}</span>
        <span className="font-semibold flex-shrink-0" style={{ color: 'var(--ink)' }}>{fR(value)}</span>
      </div>
      <div className="h-1 rounded-full" style={{ background: 'var(--surf3)' }}>
        <div className="h-1 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

export function VisaoGeral({ data }: Props) {
  const op = useMemo(() => data.filter(r => !r.isTransfer), [data])

  const { receita, despesa, resultado, margem, atrasados } = useMemo(() => {
    let rec = 0, desp = 0, atr = 0
    const hoje = new Date()
    for (const r of op) {
      if (r.tipo === 'Receita') rec += r.valor
      else desp += r.valor
      if (r.situacao?.toLowerCase().includes('atraso') && r.data && r.data < hoje) atr += r.valor
    }
    const res = rec - desp
    return {
      receita: rec,
      despesa: desp,
      resultado: res,
      margem: rec > 0 ? (res / rec) * 100 : 0,
      atrasados: atr,
    }
  }, [op])

  const semCat = useMemo(() => op.filter(r => !r.cat1 || r.cat1 === '(em branco)').length, [op])
  const semCC = useMemo(() => op.filter(r => !r.cc1 || r.cc1 === '(em branco)').length, [op])

  // Daily data for bar chart
  const dailyData = useMemo(() => {
    const map = new Map<string, { data: string; rec: number; desp: number }>()
    for (const r of op) {
      if (!r.data) continue
      const key = fDt(r.data)
      if (!map.has(key)) map.set(key, { data: key, rec: 0, desp: 0 })
      const entry = map.get(key)!
      if (r.tipo === 'Receita') entry.rec += r.valor
      else entry.desp += r.valor
    }
    return Array.from(map.values()).sort((a, b) => {
      const [da, ma, ya] = a.data.split('/').map(Number)
      const [db, mb, yb] = b.data.split('/').map(Number)
      return new Date(ya, ma - 1, da).getTime() - new Date(yb, mb - 1, db).getTime()
    })
  }, [op])

  // Donut - receitas por catSup
  const receitaDonut = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of op) {
      if (r.tipo !== 'Receita') continue
      const key = r.catSup || r.cat1 || 'Outros'
      map.set(key, (map.get(key) || 0) + r.valor)
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
  }, [op])

  // Top 10 despesas por categoria
  const topDespCat = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of op) {
      if (r.tipo !== 'Despesa') continue
      const key = r.cat1 || 'Sem categoria'
      map.set(key, (map.get(key) || 0) + r.valor)
    }
    return Array.from(map.entries())
      .map(([nome, valor]) => ({ nome, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 10)
  }, [op])

  const maxDespCat = topDespCat[0]?.valor || 1

  // Top 10 CC
  const topCC = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of op) {
      if (r.tipo !== 'Despesa') continue
      for (const c of r._ccList) {
        map.set(c.nome, (map.get(c.nome) || 0) + r.valor)
      }
    }
    return Array.from(map.entries())
      .map(([nome, valor]) => ({ nome, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 10)
  }, [op])

  const maxCC = topCC[0]?.valor || 1

  const fmtShort = (v: number) => {
    if (Math.abs(v) >= 1_000_000) return `R$${(v / 1_000_000).toFixed(1)}M`
    if (Math.abs(v) >= 1_000) return `R$${(v / 1_000).toFixed(0)}K`
    return fR(v)
  }

  return (
    <div className="space-y-4">
      {/* KPI Row */}
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))' }}>
        <KpiCard label="Receita Bruta" value={fR(receita)} color="var(--green)" />
        <KpiCard label="Despesas" value={fR(despesa)} color="var(--red)" />
        <KpiCard
          label="Resultado"
          value={fR(resultado)}
          color={resultado >= 0 ? 'var(--green)' : 'var(--red)'}
        />
        <KpiCard
          label="Margem"
          value={`${margem.toFixed(1)}%`}
          color={margem >= 10 ? 'var(--green)' : margem >= 0 ? 'var(--amber)' : 'var(--red)'}
        />
        <KpiCard label="Lançamentos" value={op.length.toLocaleString('pt-BR')} color="var(--blue)" />
        <KpiCard
          label="Atrasados"
          value={fR(atrasados)}
          color={atrasados > 0 ? 'var(--red)' : 'var(--green)'}
        />
        <KpiCard
          label="Sem Cat. / CC"
          value={`${semCat} / ${semCC}`}
          color={semCat + semCC > 0 ? 'var(--amber)' : 'var(--green)'}
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid gap-3" style={{ gridTemplateColumns: '7fr 5fr' }}>
        {/* Daily bar chart */}
        <Card>
          <CardHeader>
            <CardTitle>Receitas vs Despesas por Data</CardTitle>
            <CardDescription>Movimentação diária</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dailyData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <XAxis
                  dataKey="data"
                  tick={{ fontSize: 9, fill: 'var(--ink3)' }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 9, fill: 'var(--ink3)' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={fmtShort}
                  width={55}
                />
                <Tooltip
                  formatter={(v: number) => fR(v)}
                  labelStyle={{ fontSize: 11, color: 'var(--ink)' }}
                  contentStyle={{
                    border: '1px solid var(--line)',
                    borderRadius: 6,
                    background: 'var(--surface)',
                    fontSize: 11,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 10, color: 'var(--ink3)' }} />
                <Bar dataKey="rec" name="Receita" fill="var(--green)" radius={[2, 2, 0, 0]} maxBarSize={18} />
                <Bar dataKey="desp" name="Despesa" fill="var(--red)" radius={[2, 2, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Donut receitas */}
        <Card>
          <CardHeader>
            <CardTitle>Composição de Receitas</CardTitle>
            <CardDescription>Por categoria superior</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={receitaDonut}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {receitaDonut.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number) => fR(v)}
                  contentStyle={{
                    border: '1px solid var(--line)',
                    borderRadius: 6,
                    background: 'var(--surface)',
                    fontSize: 11,
                  }}
                />
                <Legend
                  layout="vertical"
                  align="right"
                  verticalAlign="middle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 10, color: 'var(--ink3)' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* Top despesas */}
        <Card>
          <CardHeader>
            <CardTitle>Top 10 Despesas por Categoria</CardTitle>
          </CardHeader>
          <CardContent>
            {topDespCat.length === 0 ? (
              <p className="text-[11px]" style={{ color: 'var(--ink3)' }}>Sem dados</p>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
                {topDespCat.map(item => (
                  <BarListItem
                    key={item.nome}
                    label={item.nome}
                    value={item.valor}
                    max={maxDespCat}
                    color="var(--red)"
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top CC */}
        <Card>
          <CardHeader>
            <CardTitle>Top 10 Centros de Custo (Despesas)</CardTitle>
          </CardHeader>
          <CardContent>
            {topCC.length === 0 ? (
              <p className="text-[11px]" style={{ color: 'var(--ink3)' }}>Sem dados</p>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
                {topCC.map(item => (
                  <BarListItem
                    key={item.nome}
                    label={item.nome}
                    value={item.valor}
                    max={maxCC}
                    color="var(--blue)"
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
