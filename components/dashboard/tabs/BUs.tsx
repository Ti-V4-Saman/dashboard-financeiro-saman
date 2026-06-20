'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import type { Filters } from '@/lib/types'
import type { BU, BuData, BusApiResponse, KpiKey } from '@/lib/types/bus'
import { fR, fDt, parseDataLocal } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Calculator, ArrowRight } from 'lucide-react'

interface Props {
  filters: Filters
}

const BU_LABELS: Record<BU, string> = {
  operacao:        'Operação',
  receita:         'Receita',
  nao_operacional: 'Não Operacional',
  sem_categoria:   'Sem Categoria',
}

// KPIs clicáveis. O mapping → categoria_l1 espelha as fórmulas dos cards:
//   Receita Líquida = receita bruta (1.x) − deduções (2.x rateadas / sintéticas)
//   Custos          = 3.x
//   Margem Bruta    = RL − Custos  → tudo que entra em 1.x, 2.x, 3.x
//   Despesas Op.    = 4.x
//   EBITDA          = MB − Despesas Op.  → tudo que entra em 1.x..4.x
const KPI_TO_L1: Record<KpiKey, number[]> = {
  receita_liquida: [1, 2],
  custos:          [3],
  margem_bruta:    [1, 2, 3],
  despesas_op:     [4],
  ebitda:          [1, 2, 3, 4],
  nao_op:          [5, 6, 7],
}

const KPI_LABEL: Record<KpiKey, string> = {
  receita_liquida: 'Receita Líquida',
  custos:          'Custos',
  margem_bruta:    'Margem Bruta',
  despesas_op:     'Despesas Op.',
  ebitda:          'EBITDA',
  nao_op:          'Resultado Não Operacional',
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
  label, value, sub, color, onClick, active,
}: {
  label: string
  value: string
  sub?: React.ReactNode
  color?: string
  onClick?: () => void
  active?: boolean
}) {
  const accent = color ?? 'var(--ink)'
  const clickable = !!onClick
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() } } : undefined}
      className="rounded-lg p-4 transition-shadow"
      style={{
        background: active ? 'color-mix(in srgb, var(--surface) 94%, transparent)' : 'var(--surface)',
        border: active ? `2px solid ${accent}` : '1px solid var(--line)',
        padding: active ? 15 : 16,  // compensa o +1px de border pra não pular layout
        cursor: clickable ? 'pointer' : 'default',
        outline: 'none',
        userSelect: clickable ? 'none' : 'auto',
      }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ink3)' }}>
        {label}
      </div>
      <div
        className="text-[18px] font-bold leading-none tracking-tight"
        style={{ color: accent, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[10px]" style={{ color: 'var(--ink3)' }}>{sub}</div>}
    </div>
  )
}

// ── Painel da BU ────────────────────────────────────────────────────────────
function PainelBu({
  bu, kpiAtivo, setKpiAtivo, onNavegar,
}: {
  bu: BuData
  kpiAtivo: KpiKey | null
  setKpiAtivo: (k: KpiKey | null) => void
  onNavegar: (target: { bu: BU; kpi: KpiKey }) => void
}) {
  const { kpis } = bu

  // Toggle: click no mesmo KPI ativo limpa o filtro.
  const onKpi = (k: KpiKey) => setKpiAtivo(kpiAtivo === k ? null : k)

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
        <LancamentosTabela bu={bu} kpiAtivo={null} onLimpar={() => {}} onNavegar={onNavegar} />
      </div>
    )
  }

  if (bu.bu === 'nao_operacional') {
    const accent = kpis.nao_operacional_total >= 0 ? 'var(--green)' : 'var(--red)'
    return (
      <div className="space-y-4">
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <KpiCard
            label="Resultado Não Operacional"
            value={fR(kpis.nao_operacional_total)}
            color={accent}
            onClick={() => onKpi('nao_op')}
            active={kpiAtivo === 'nao_op'}
          />
          <KpiCard label="Lançamentos no período" value={kpis.qtd_lancamentos.toLocaleString('pt-BR')} />
        </div>
        <div className="text-[11px] px-1" style={{ color: 'var(--ink3)' }}>
          Resultado líquido das categorias 5 (depreciação), 6 (financeiras) e 7
          (impostos s/ lucro). Clique no card para listar todos os lançamentos.
        </div>
        <EvolucaoChart bu={bu} />
        <TopCategorias bu={bu} />
        <LancamentosTabela bu={bu} kpiAtivo={kpiAtivo} onLimpar={() => setKpiAtivo(null)} onNavegar={onNavegar} />
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
          onClick={() => onKpi('receita_liquida')}
          active={kpiAtivo === 'receita_liquida'}
          sub={(
            <>
              <span style={{ color: deltaColor(kpis.delta_vs_m1.receita_liquida_pct) }}>
                {fPct(kpis.delta_vs_m1.receita_liquida_pct)} vs M-1
              </span>
              {/* Decomposição da líquida — sempre visível (mesmo se deduções=0) pra
                  evitar assimetria visual entre BUs. As deduções são rateadas:
                  o lançamento físico vive em Operação, e cada BU recebe a parcela
                  proporcional à sua receita bruta (`Rateio %`). */}
              <div className="mt-0.5" style={{ color: 'var(--ink3)' }}>
                Bruta {fR(kpis.receita_bruta)} · Deduções {fR(kpis.deducoes)} · Rateio {(kpis.proporcao * 100).toFixed(1).replace('.', ',')}%
              </div>
            </>
          )}
        />
        <KpiCard
          label="Custos"
          value={fR(kpis.custos)}
          color="var(--red)"
          onClick={() => onKpi('custos')}
          active={kpiAtivo === 'custos'}
          sub={<span style={{ color: 'var(--ink3)' }}>cat 3.x</span>}
        />
        <KpiCard
          label="Margem Bruta"
          value={fR(kpis.margem_bruta)}
          color={kpis.margem_bruta >= 0 ? 'var(--green)' : 'var(--red)'}
          onClick={() => onKpi('margem_bruta')}
          active={kpiAtivo === 'margem_bruta'}
          sub={<span style={{ color: 'var(--ink3)' }}>RL − Custos</span>}
        />
        <KpiCard
          label="Despesas Op."
          value={fR(kpis.despesas_op)}
          color="var(--red)"
          onClick={() => onKpi('despesas_op')}
          active={kpiAtivo === 'despesas_op'}
          sub={<span style={{ color: 'var(--ink3)' }}>cat 4.x</span>}
        />
        <KpiCard
          label="EBITDA"
          value={fR(kpis.ebitda)}
          color={kpis.ebitda >= 0 ? 'var(--green)' : 'var(--red)'}
          onClick={() => onKpi('ebitda')}
          active={kpiAtivo === 'ebitda'}
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
      <LancamentosTabela bu={bu} kpiAtivo={kpiAtivo} onLimpar={() => setKpiAtivo(null)} onNavegar={onNavegar} />
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

// ── Lançamentos (tabela com drill-down de KPI) ──────────────────────────────
const PAGE_SIZE = 50

function LancamentosTabela({
  bu, kpiAtivo, onLimpar, onNavegar,
}: {
  bu: BuData
  kpiAtivo: KpiKey | null
  onLimpar: () => void
  onNavegar: (target: { bu: BU; kpi: KpiKey }) => void
}) {
  // Default (sem KPI): 10 mais recentes. Com KPI: tudo que bate o L1 set.
  const filtradas = useMemo(() => {
    if (!kpiAtivo) return bu.lancamentos.slice(0, 10)
    const allow = new Set(KPI_TO_L1[kpiAtivo])
    return bu.lancamentos.filter(l => allow.has(l.categoria_l1))
  }, [bu.lancamentos, kpiAtivo])

  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  // Reset paginação ao trocar de KPI
  useEffect(() => { setPageSize(PAGE_SIZE) }, [kpiAtivo])

  const visiveis = kpiAtivo ? filtradas.slice(0, pageSize) : filtradas
  const sobram   = kpiAtivo ? Math.max(0, filtradas.length - pageSize) : 0

  const tituloDefault = bu.bu === 'sem_categoria' ? 'Lançamentos' : 'Lançamentos recentes'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[13px]">{kpiAtivo ? 'Lançamentos por KPI' : tituloDefault}</CardTitle>
      </CardHeader>
      <CardContent>
        {kpiAtivo && (
          <div
            className="mb-3 flex items-center justify-between rounded-md px-3 py-2"
            style={{ background: 'var(--surf2)', border: '1px solid var(--line)' }}
          >
            <div className="text-[11px]" style={{ color: 'var(--ink2)' }}>
              Mostrando: <strong>{KPI_LABEL[kpiAtivo]}</strong> · {filtradas.length.toLocaleString('pt-BR')} lançamento{filtradas.length === 1 ? '' : 's'}
            </div>
            <button
              onClick={onLimpar}
              className="text-[11px] px-2 py-1 rounded transition-colors"
              style={{ color: 'var(--ink3)', background: 'transparent', border: '1px solid var(--line)', cursor: 'pointer' }}
            >
              ✕ Limpar
            </button>
          </div>
        )}
        {visiveis.length === 0
          ? <div className="text-[11px]" style={{ color: 'var(--ink3)' }}>Sem lançamentos.</div>
          : (
            <>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th className="py-1.5 pl-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Data</th>
                  <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Descrição</th>
                  <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Cliente / Fornecedor</th>
                  <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Categoria</th>
                  <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>CC</th>
                  <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--ink3)' }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map(l => {
                  if (l._sintetica) {
                    // Linha sintética: rateio de deduções cuja contraparte física
                    // mora em outra BU. Fundo cinza claro, ícone, link de navegação.
                    return (
                      <tr key={l.id} style={{ borderBottom: '1px solid var(--line)', background: 'var(--surf2)' }}>
                        <td className="py-2 pl-3 text-[11px] whitespace-nowrap" style={{ color: 'var(--ink3)' }}>—</td>
                        <td className="py-2 text-[11px]" colSpan={4} style={{ color: 'var(--ink2)' }}>
                          <span className="inline-flex items-center gap-1.5">
                            <Calculator size={12} style={{ color: 'var(--ink3)' }} />
                            <span>{l.descricao}</span>
                            {l.link_target && (
                              <button
                                onClick={() => onNavegar(l.link_target!)}
                                className="ml-2 inline-flex items-center gap-1 text-[10px] underline"
                                style={{ color: 'var(--brand)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                              >
                                Ver lançamentos físicos <ArrowRight size={11} />
                              </button>
                            )}
                          </span>
                        </td>
                        <td
                          className="py-2 pr-3 text-right text-[11px] font-semibold whitespace-nowrap"
                          style={{ color: 'var(--red)', fontVariantNumeric: 'tabular-nums' }}
                        >
                          −{fR(l.valor)}
                        </td>
                      </tr>
                    )
                  }
                  return (
                    <tr key={l.id} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td className="py-2 pl-3 text-[11px] whitespace-nowrap" style={{ color: 'var(--ink3)' }}>{fDt(parseDataLocal(l.data))}</td>
                      <td className="py-2 text-[11px]" style={{ color: 'var(--ink2)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.descricao}>{l.descricao}</td>
                      <td className="py-2 text-[11px]" style={{ color: l.contraparte ? 'var(--ink2)' : 'var(--ink3)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.contraparte || ''}>{l.contraparte || '—'}</td>
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
                  )
                })}
              </tbody>
            </table>
            {sobram > 0 && (
              <div className="mt-3 flex justify-center">
                <button
                  onClick={() => setPageSize(p => p + PAGE_SIZE)}
                  className="text-[11px] px-3 py-1.5 rounded transition-colors"
                  style={{ color: 'var(--ink2)', background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer' }}
                >
                  Carregar mais ({sobram.toLocaleString('pt-BR')} restantes)
                </button>
              </div>
            )}
            </>
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
  // Estado controlado do drill-down. Liftado para BUs pra suportar
  // navegação cruzada (sintética → BU Operação com KPI RL ativo).
  const [kpiAtivo, setKpiAtivo] = useState<KpiKey | null>(null)

  // Sub-tab click: reset do KPI ativo (UX padrão).
  const onTrocarSub = (next: BU) => {
    setActiveSub(next)
    setKpiAtivo(null)
  }

  // Navegação intencional (sintética → outra BU + KPI). Sub-tab e KPI
  // mudam juntos sem o "reset por troca de sub-tab".
  const onNavegar = (target: { bu: BU; kpi: KpiKey }) => {
    setActiveSub(target.bu)
    setKpiAtivo(target.kpi)
  }

  const de  = filters.dateFrom
  const ate = filters.dateTo
  // Filtros do FilterBar global propagados pra route. Serializadas em
  // chaves estáveis (`.join('|')`) pra estabilizar as deps do useEffect:
  // como `filters.situacao` etc. são arrays, sem stringify o effect
  // dispararia a cada re-render mesmo sem mudança real.
  const tipo     = filters.tipo
  const sitKey   = filters.situacao.join('|')
  const catKey   = filters.categoria.join('|')
  const ccKey    = filters.cc.join('|')
  const contaKey = filters.conta.join('|')

  useEffect(() => {
    if (!de || !ate) return
    setLoading(true); setErro(null)
    const p = new URLSearchParams({ de, ate })
    if (tipo) p.set('tipo', tipo)
    filters.situacao .forEach(v => p.append('situacao',  v))
    filters.categoria.forEach(v => p.append('categoria', v))
    filters.cc       .forEach(v => p.append('cc',        v))
    filters.conta    .forEach(v => p.append('conta',     v))
    fetch(`/api/financeiro/bus?${p.toString()}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<BusApiResponse>
      })
      .then(d => { setResp(d); setLoading(false) })
      .catch(e => { setErro(String(e)); setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [de, ate, tipo, sitKey, catKey, ccKey, contaKey])

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
              onClick={() => onTrocarSub(b.bu)}
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

      {active && (
        <PainelBu
          bu={active}
          kpiAtivo={kpiAtivo}
          setKpiAtivo={setKpiAtivo}
          onNavegar={onNavegar}
        />
      )}
    </div>
  )
}
