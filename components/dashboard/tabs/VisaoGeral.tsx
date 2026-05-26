'use client'

import { useMemo, useState, useEffect } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { Lancamento, Filters } from '@/lib/types'
import { fR, fDt } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { SaldosBancarios, type SaldosData } from '@/components/dashboard/SaldosBancarios'
import { InsightsPeriodo } from '@/components/dashboard/InsightsPeriodo'
import { BlocosResumo, type BlocosData } from '@/components/dashboard/BlocosResumo'
import ResumoTrimestralWidget from '@/components/dashboard/widgets/ResumoTrimestralWidget'

interface Props {
  data: Lancamento[]
  filters?: Filters
}

interface ExtrasResponse {
  saldos: SaldosData
  insights: {
    ticketVariacao: { percentual: number; direcao: 'up' | 'down' | 'stable' } | null
    burnVariacao:   { percentual: number; direcao: 'up' | 'down' | 'stable' } | null
  }
  blocos: BlocosData
}

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

export function VisaoGeral({ data, filters }: Props) {
  // ── Base dos KPIs e gráficos ─────────────────────────────────────────────
  // Caixa  → só Quitado (cada linha é uma BAIXA — pagamento efetivo)
  // Competência → todos os status válidos (Quitado + Aberto + Atrasado + Parcial)
  //               porque a receita é reconhecida na competência, não no pagamento
  const op = useMemo(() => {
    const isCaixa = (filters?.regime ?? 'competencia') === 'caixa'
    return data.filter(r => {
      if (r.isTransfer) return false
      if (isCaixa) return r.situacao === 'Quitado'
      return r.situacao !== 'Cancelado' && r.situacao !== 'Renegociado'
    })
  }, [data, filters?.regime])

  const { receita, despesa, resultado, margem, atrasados } = useMemo(() => {
    let rec = 0, desp = 0, atr = 0
    const hoje = new Date()
    for (const r of op) {
      if (r.tipo === 'Receita') rec += r.valor
      else desp += r.valor
    }
    for (const r of data) {
      if ((r.situacao === 'Atrasado' || r.situacao === 'Aberto') && r.data && r.data < hoje) {
        atr += r.valor
      }
    }
    const res = rec - desp
    return { receita: rec, despesa: desp, resultado: res, margem: rec > 0 ? (res / rec) * 100 : 0, atrasados: atr }
  }, [op, data])

  const semCat = useMemo(() => op.filter(r => !r.cat1 || r.cat1 === '(em branco)').length, [op])
  const semCC  = useMemo(() => op.filter(r => !r.cc1  || r.cc1  === '(em branco)').length, [op])

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
    if (Math.abs(v) >= 1_000)     return `R$${(v / 1_000).toFixed(0)}K`
    return fR(v)
  }

  // ── Fetch extras (saldos + variações) ─────────────────────────────────────
  const [extras, setExtras]         = useState<ExtrasResponse | null>(null)
  const [extrasLoading, setLoading] = useState(true)

  useEffect(() => {
    const de     = filters?.dateFrom ?? ''
    const ate    = filters?.dateTo   ?? ''
    const regime = filters?.regime   ?? 'competencia'
    const params = new URLSearchParams({ de, ate, regime }).toString()

    setLoading(true)
    fetch(`/api/visao-geral-extras?${params}`)
      .then(r => r.json())
      .then((d: ExtrasResponse) => { setExtras(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [filters?.dateFrom, filters?.dateTo, filters?.regime])

  return (
    <div className="space-y-4">
      {/* KPI Row — inalterado */}
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))' }}>
        <KpiCard label="Receita Bruta" value={fR(receita)} color="var(--green)" />
        <KpiCard label="Despesas"      value={fR(despesa)} color="var(--red)" />
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

      {/* Linha 1: Gráfico de barras + Insights (esq) | Saldos Bancários (dir) */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(0, 1fr) 400px', alignItems: 'start' }}>

        {/* Card esquerdo: Receitas vs Despesas + InsightsPeriodo */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Receitas vs Despesas por Data</CardTitle>
                <CardDescription>Movimentação diária</CardDescription>
              </div>
              {/* Legenda inline */}
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="flex items-center gap-1.5 text-[10px] font-medium" style={{ color: 'var(--ink3)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--green)', display: 'inline-block' }} />
                  Receita
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-medium" style={{ color: 'var(--ink3)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--red)', display: 'inline-block' }} />
                  Despesa
                </span>
              </div>
            </div>
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
                <Bar dataKey="rec"  name="Receita" fill="var(--green)" radius={[2, 2, 0, 0]} maxBarSize={18} />
                <Bar dataKey="desp" name="Despesa" fill="var(--red)"   radius={[2, 2, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>

            {/* InsightsPeriodo — renderizado dentro do mesmo card */}
            <InsightsPeriodo
              data={op}
              dateFrom={filters?.dateFrom ?? ''}
              dateTo={filters?.dateTo ?? ''}
              extras={extras?.insights ?? null}
            />
          </CardContent>
        </Card>

        {/* Card direito: Saldos Bancários */}
        <SaldosBancarios
          data={extras?.saldos ?? null}
          loading={extrasLoading}
        />
      </div>

      {/* Linha 2: Resumo Trimestral — Competência (3 cards: M, M+1, M+2) */}
      {filters && (
        <ResumoTrimestralWidget filters={filters} />
      )}

      {/* Linha 3: blocos de resumo (Contratos + Notas Fiscais) */}
      <BlocosResumo blocos={extras?.blocos ?? null} loading={extrasLoading} />

      {/* Linha 3: Top 10 */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
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
                  <BarListItem key={item.nome} label={item.nome} value={item.valor} max={maxDespCat} color="var(--red)" />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

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
                  <BarListItem key={item.nome} label={item.nome} value={item.valor} max={maxCC} color="var(--blue)" />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
