'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import type { Filters } from '@/lib/types'
import type { BU, BuData, BusApiResponse } from '@/lib/types/bus'
import { fR, fDt, parseDataLocal } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  filters: Filters
}

const BU_LABELS: Record<BU, string> = {
  operacao:        'Operação',
  receita:         'Receita',
  nao_operacional: 'Não Operacional',
  sem_categoria:   'Sem Categoria',
}

const MES_CURTO = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
                       'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
function ymShort(ym: string): string {
  if (!ym || ym.length < 7) return ym
  const [y, m] = ym.split('-').map(Number)
  return `${MES_CURTO[m]}/${String(y).slice(2)}`
}

function fPct(v: number | null, suffix = '%'): string {
  if (v === null || !isFinite(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1).replace('.', ',')}${suffix}`
}

function deltaColor(v: number | null, invert = false): string {
  if (v === null) return 'var(--ink3)'
  const good = invert ? v < 0 : v > 0
  return good ? 'var(--green)' : v === 0 ? 'var(--ink3)' : 'var(--red)'
}

// ── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({
  label, value, sub, color,
}: {
  label: string
  value: string
  sub?: React.ReactNode
  color?: string
}) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ink3)' }}>
        {label}
      </div>
      <div
        className="text-[18px] font-bold leading-none tracking-tight"
        style={{ color: color ?? 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[10px]" style={{ color: 'var(--ink3)' }}>{sub}</div>}
    </div>
  )
}

// ── Painel da BU ────────────────────────────────────────────────────────────
function PainelBu({ bu }: { bu: BuData }) {
  const { kpis } = bu

  if (bu.bu === 'sem_categoria') {
    return (
      <div className="space-y-4">
        <div className="rounded-lg p-4" style={{ background: 'var(--surf2)', border: '1px solid var(--line2)' }}>
          <div className="text-[12px] font-semibold mb-2" style={{ color: 'var(--red)' }}>
            ⚠️ Lançamentos sem categoria — sinal de problema no ETL
          </div>
          <div className="flex gap-6 mt-2">
            <KpiCard label="Lançamentos" value={kpis.qtd_lancamentos.toLocaleString('pt-BR')} />
            <KpiCard label="Total bruto" value={fR(kpis.total_bruto)} />
          </div>
          <div className="mt-2 text-[11px]" style={{ color: 'var(--ink3)' }}>
            Esses lançamentos não entram no DRE de nenhuma BU. Investigue e categorize
            antes de fechar o mês.
          </div>
        </div>
        <LancamentosRecentes bu={bu} />
      </div>
    )
  }

  if (bu.bu === 'nao_operacional') {
    return (
      <div className="space-y-4">
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <KpiCard
            label="Resultado Não Operacional"
            value={fR(kpis.nao_operacional_total)}
            color={kpis.nao_operacional_total >= 0 ? 'var(--green)' : 'var(--red)'}
          />
          <KpiCard label="Lançamentos no período" value={kpis.qtd_lancamentos.toLocaleString('pt-BR')} />
        </div>
        <div className="text-[11px] px-1" style={{ color: 'var(--ink3)' }}>
          Resultado líquido das categorias 5 (depreciação), 6 (financeiras) e 7
          (impostos s/ lucro). Detalhes nas tabelas abaixo.
        </div>
        <EvolucaoChart bu={bu} />
        <TopCategorias bu={bu} />
        <LancamentosRecentes bu={bu} />
      </div>
    )
  }

  // Operação e Receita
  return (
    <div className="space-y-4">
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))' }}>
        <KpiCard
          label="Receita Líquida"
          value={fR(kpis.receita_liquida)}
          color="var(--green)"
          sub={(
            <>
              <span style={{ color: deltaColor(kpis.delta_vs_m1.receita_liquida_pct) }}>
                {fPct(kpis.delta_vs_m1.receita_liquida_pct)} vs M-1
              </span>
              {/* Decomposição da líquida — sempre visível (mesmo se deduções=0) pra
                  evitar assimetria visual entre BUs. Na Operação tipicamente RL = RB. */}
              <div className="mt-0.5" style={{ color: 'var(--ink3)' }}>
                Bruta {fR(kpis.receita_bruta)} · Deduções {fR(kpis.deducoes)}
              </div>
            </>
          )}
        />
        <KpiCard
          label="Custos"
          value={fR(kpis.custos)}
          color="var(--red)"
          sub={<span style={{ color: 'var(--ink3)' }}>cat 3.x</span>}
        />
        <KpiCard
          label="Margem Bruta"
          value={fR(kpis.margem_bruta)}
          color={kpis.margem_bruta >= 0 ? 'var(--green)' : 'var(--red)'}
          sub={<span style={{ color: 'var(--ink3)' }}>RL − Custos</span>}
        />
        <KpiCard
          label="Despesas Op."
          value={fR(kpis.despesas_op)}
          color="var(--red)"
          sub={<span style={{ color: 'var(--ink3)' }}>cat 4.x</span>}
        />
        <KpiCard
          label="EBITDA"
          value={fR(kpis.ebitda)}
          color={kpis.ebitda >= 0 ? 'var(--green)' : 'var(--red)'}
          sub={(
            <>
              <span style={{ color: 'var(--ink3)' }}>{kpis.margem_ebitda_pct.toFixed(1).replace('.', ',')}% margem · </span>
              <span style={{ color: deltaColor(kpis.delta_vs_m1.ebitda_pct) }}>
                {fPct(kpis.delta_vs_m1.ebitda_pct)} vs M-1
              </span>
            </>
          )}
        />
      </div>
      <EvolucaoChart bu={bu} />
      <TopCategorias bu={bu} />
      <LancamentosRecentes bu={bu} />
    </div>
  )
}

// ── Evolução 6 meses ────────────────────────────────────────────────────────
function EvolucaoChart({ bu }: { bu: BuData }) {
  const data = bu.evolucao.map(p => ({
    mes: ymShort(p.mes),
    Receita: p.receita,
    Despesa: p.despesa,
    EBITDA: p.ebitda,
  }))
  return (
    <Card>
      <CardHeader><CardTitle className="text-[13px]">Evolução — últimos 6 meses</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ left: 0, right: 16, top: 8, bottom: 0 }}>
            <XAxis dataKey="mes" tick={{ fontSize: 10, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--ink3)' }} tickLine={false} axisLine={false}
              tickFormatter={(v: number) => {
                if (Math.abs(v) >= 1_000_000) return `R$${(v / 1_000_000).toFixed(1)}M`
                if (Math.abs(v) >= 1_000) return `R$${(v / 1_000).toFixed(0)}K`
                return fR(v)
              }}
            />
            <Tooltip
              formatter={(v: number) => fR(v)}
              contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 11 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="Receita" stroke="var(--green)" strokeWidth={2} dot />
            <Line type="monotone" dataKey="Despesa" stroke="var(--red)"   strokeWidth={2} dot />
            <Line type="monotone" dataKey="EBITDA"  stroke="var(--brand)" strokeWidth={2} dot />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

// ── Top Categorias ──────────────────────────────────────────────────────────
function TopCategorias({ bu }: { bu: BuData }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
      <Card>
        <CardHeader><CardTitle className="text-[13px]">Top 5 receitas (categoria)</CardTitle></CardHeader>
        <CardContent>
          {bu.top_receitas.length === 0
            ? <div className="text-[11px]" style={{ color: 'var(--ink3)' }}>Sem receitas no período.</div>
            : <ListaCategoria items={bu.top_receitas} color="var(--green)" />}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-[13px]">Top 5 despesas (categoria)</CardTitle></CardHeader>
        <CardContent>
          {bu.top_despesas.length === 0
            ? <div className="text-[11px]" style={{ color: 'var(--ink3)' }}>Sem despesas no período.</div>
            : <ListaCategoria items={bu.top_despesas} color="var(--red)" />}
        </CardContent>
      </Card>
    </div>
  )
}

function ListaCategoria({ items, color }: { items: { categoria: string; valor: number }[]; color: string }) {
  const max = Math.max(...items.map(i => i.valor), 1)
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i}>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="truncate mr-2" style={{ color: 'var(--ink2)', maxWidth: '70%' }} title={it.categoria}>{it.categoria}</span>
            <span className="font-semibold whitespace-nowrap" style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fR(it.valor)}</span>
          </div>
          <div className="h-1 rounded-full" style={{ background: 'var(--surf3)' }}>
            <div className="h-1 rounded-full" style={{ width: `${(it.valor / max) * 100}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Lançamentos Recentes ────────────────────────────────────────────────────
function LancamentosRecentes({ bu }: { bu: BuData }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-[13px]">Lançamentos recentes</CardTitle></CardHeader>
      <CardContent>
        {bu.lancamentos.length === 0
          ? <div className="text-[11px]" style={{ color: 'var(--ink3)' }}>Sem lançamentos no período.</div>
          : (
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th className="py-1.5 pl-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Data</th>
                  <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Descrição</th>
                  <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Categoria</th>
                  <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>CC</th>
                  <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--ink3)' }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {bu.lancamentos.slice(0, 10).map(l => (
                  <tr key={l.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td className="py-2 pl-3 text-[11px] whitespace-nowrap" style={{ color: 'var(--ink3)' }}>{fDt(parseDataLocal(l.data))}</td>
                    <td className="py-2 text-[11px]" style={{ color: 'var(--ink2)' }} title={l.descricao}>{l.descricao}</td>
                    <td className="py-2 text-[11px]" style={{ color: 'var(--ink3)' }} title={l.categoria}>{l.categoria}</td>
                    <td className="py-2 text-[11px]" style={{ color: 'var(--ink3)' }} title={l.centro_custo}>{l.centro_custo}</td>
                    <td
                      className="py-2 pr-3 text-right text-[11px] font-semibold whitespace-nowrap"
                      style={{
                        color: l.tipo === 'Receita' ? 'var(--green)' : 'var(--red)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {fR(l.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </CardContent>
    </Card>
  )
}

// ── Componente principal ────────────────────────────────────────────────────
export function BUs({ filters }: Props) {
  const [resp, setResp] = useState<BusApiResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [activeSub, setActiveSub] = useState<BU>('operacao')

  const de  = filters.dateFrom
  const ate = filters.dateTo

  useEffect(() => {
    if (!de || !ate) return
    setLoading(true); setErro(null)
    const params = new URLSearchParams({ de, ate }).toString()
    fetch(`/api/financeiro/bus?${params}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<BusApiResponse>
      })
      .then(d => { setResp(d); setLoading(false) })
      .catch(e => { setErro(String(e)); setLoading(false) })
  }, [de, ate])

  const buMap = useMemo(() => {
    const m = new Map<BU, BuData>()
    for (const b of resp?.bus ?? []) m.set(b.bu, b)
    return m
  }, [resp])

  // Garante que activeSub esteja num bu disponível (caso só haja Operação/Receita)
  useEffect(() => {
    if (!resp) return
    if (!buMap.has(activeSub)) {
      const primeiro = resp.bus[0]?.bu
      if (primeiro) setActiveSub(primeiro)
    }
  }, [resp, buMap, activeSub])

  if (loading && !resp) return <div className="text-[12px]" style={{ color: 'var(--ink3)' }}>Carregando BUs…</div>
  if (erro) return <div className="text-[12px]" style={{ color: 'var(--red)' }}>Erro ao carregar BUs: {erro}</div>
  if (!resp) return null

  const active = buMap.get(activeSub)

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex gap-1" style={{ borderBottom: '1px solid var(--line)' }}>
        {resp.bus.map(b => {
          const isActive = b.bu === activeSub
          return (
            <button
              key={b.bu}
              onClick={() => setActiveSub(b.bu)}
              className="px-3 py-2 text-[12px] transition-all"
              style={{
                color: isActive ? 'var(--ink)' : 'var(--ink3)',
                fontWeight: isActive ? 600 : 400,
                background: 'none',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--brand)' : '2px solid transparent',
                cursor: 'pointer',
              }}
            >
              {BU_LABELS[b.bu]}
              {b.bu === 'sem_categoria' && <span className="ml-1.5" style={{ color: 'var(--red)' }}>⚠️</span>}
            </button>
          )
        })}
      </div>

      {active && <PainelBu bu={active} />}
    </div>
  )
}
