'use client'

import { fR } from '@/lib/utils'
import {
  calcTicketMedioReceita,
  calcDiaDePico,
  calcBurnDiario,
  calcSaudeDiaria,
} from '@/lib/calcInsights'
import type { Lancamento } from '@/lib/types'

// ── Tipos vindos do endpoint ──────────────────────────────────────────────────

interface Variacao {
  percentual: number
  direcao: 'up' | 'down' | 'stable'
}

interface InsightsExtras {
  ticketVariacao: Variacao | null
  burnVariacao:   Variacao | null
}

interface Props {
  data: Lancamento[]
  dateFrom: string
  dateTo: string
  extras?: InsightsExtras | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** "2026-05-01" → "01/05" */
function fmtAxisDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

/** "2026-05-01" → "01/05/2026" */
function fmtFullDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/** Quantos dias pular no eixo X para não poluir. */
function labelStep(total: number): number {
  if (total <= 10)  return 1
  if (total <= 20)  return 3
  if (total <= 40)  return 5
  return 7
}

// ── Trend badge ───────────────────────────────────────────────────────────────

function Trend({
  variacao,
  positiveIsGood = true,
}: {
  variacao: Variacao | null | undefined
  positiveIsGood?: boolean
}) {
  if (!variacao) return null
  const isGood =
    variacao.direcao === 'stable' ? true
    : positiveIsGood
      ? variacao.direcao === 'up'
      : variacao.direcao === 'down'

  const arrow = variacao.direcao === 'up' ? '↑' : variacao.direcao === 'down' ? '↓' : '→'
  const cor   = isGood ? '#1D9E75' : '#E24B4A'

  return (
    <span className="text-[10px] font-medium" style={{ color: cor }}>
      {arrow} {variacao.percentual}% vs período anterior
    </span>
  )
}

// ── Sub-stat card ─────────────────────────────────────────────────────────────

function SubStat({
  label,
  value,
  sub,
  trend,
}: {
  label: string
  value: string
  sub?: string
  trend?: React.ReactNode
}) {
  return (
    <div
      className="rounded-md p-2.5"
      style={{ background: 'var(--surf2)', border: '0.5px solid var(--line2)' }}
    >
      <div
        className="text-[10px] font-semibold uppercase tracking-wider mb-1"
        style={{ color: 'var(--ink3)' }}
      >
        {label}
      </div>
      <div className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
        {value}
      </div>
      {sub && (
        <div className="text-[10px] mt-0.5" style={{ color: 'var(--ink3)' }}>
          {sub}
        </div>
      )}
      {trend && <div className="mt-0.5">{trend}</div>}
    </div>
  )
}

// ── InsightsPeriodo ───────────────────────────────────────────────────────────

export function InsightsPeriodo({ data, dateFrom, dateTo, extras }: Props) {
  const ticket = calcTicketMedioReceita(data)
  const pico   = calcDiaDePico(data)
  const burn   = calcBurnDiario(data, dateFrom, dateTo)
  const saude  = calcSaudeDiaria(data)

  if (data.length === 0) return null

  const maxAbs = saude.reduce((m, d) => Math.max(m, Math.abs(d.saldo)), 0) || 1

  // Contagens para o resumo
  const nPos    = saude.filter(d => d.saldo > 0).length
  const nNeg    = saude.filter(d => d.saldo < 0).length
  const nNeutro = saude.filter(d => d.saldo === 0).length

  const step = labelStep(saude.length)

  return (
    <>
      {/* Sub-stats: ticket, pico, burn */}
      <div
        className="text-[10px] font-semibold uppercase tracking-wider mt-4 mb-2.5 pb-1.5"
        style={{ color: 'var(--ink3)', letterSpacing: '0.04em', borderBottom: '0.5px solid var(--line)' }}
      >
        Insights do período
      </div>
      <div className="grid grid-cols-3 gap-2">
        <SubStat
          label="Ticket médio receita"
          value={ticket > 0 ? fR(ticket) : '—'}
          trend={<Trend variacao={extras?.ticketVariacao} positiveIsGood />}
        />
        <SubStat
          label="Dia de pico"
          value={pico?.label ?? '—'}
          sub={pico ? `${fR(pico.valor)} recebidos` : undefined}
        />
        <SubStat
          label="Burn diário médio"
          value={burn > 0 ? fR(burn) : '—'}
          trend={<Trend variacao={extras?.burnVariacao} positiveIsGood={false} />}
        />
      </div>

      {/* Timeline de saúde diária */}
      {saude.length > 0 && (
        <>
          {/* Header: título + legenda */}
          <div className="flex items-center justify-between mt-4 mb-2 pb-1.5" style={{ borderBottom: '0.5px solid var(--line)' }}>
            <span
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--ink3)', letterSpacing: '0.04em' }}
            >
              Saúde diária
            </span>
            <div className="flex items-center gap-3">
              {[
                { cor: '#1D9E75', label: 'Positivo' },
                { cor: '#E24B4A', label: 'Negativo' },
                { cor: 'var(--line2)', label: 'Sem mov.' },
              ].map(item => (
                <span key={item.label} className="flex items-center gap-1">
                  <span
                    className="inline-block rounded-full shrink-0"
                    style={{ width: 7, height: 7, background: item.cor }}
                  />
                  <span className="text-[10px]" style={{ color: 'var(--ink3)' }}>{item.label}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Resumo em texto */}
          <p className="text-[10px] mb-2" style={{ color: 'var(--ink3)' }}>
            <span style={{ color: '#1D9E75', fontWeight: 600 }}>{nPos} {nPos === 1 ? 'dia positivo' : 'dias positivos'}</span>
            {' · '}
            <span style={{ color: '#E24B4A', fontWeight: 600 }}>{nNeg} {nNeg === 1 ? 'dia negativo' : 'dias negativos'}</span>
            {nNeutro > 0 && (
              <>
                {' · '}
                <span style={{ color: 'var(--ink3)', fontWeight: 600 }}>{nNeutro} {nNeutro === 1 ? 'dia neutro' : 'dias neutros'}</span>
              </>
            )}
          </p>

          {/* Barras + eixo X — scroll horizontal apenas quando necessário */}
          <div style={{ overflowX: 'auto', overflowY: 'visible', marginInline: -4 }}>
            <div style={{ minWidth: saude.length * 5, padding: '0 4px' }}>

              {/* Barras */}
              <div
                className="flex items-end"
                style={{ height: 180, gap: saude.length > 60 ? 2 : 6 }}
              >
                {saude.map(d => {
                  const pct = Math.max(10, (Math.abs(d.saldo) / maxAbs) * 100)
                  const cor = d.saldo > 0 ? '#1D9E75' : d.saldo < 0 ? '#E24B4A' : 'var(--line2)'
                  return (
                    <div
                      key={d.data}
                      className="flex-1"
                      style={{
                        height: `${pct}%`,
                        background: cor,
                        minWidth: 3,
                        borderRadius: '3px 3px 0 0',
                        cursor: 'pointer',
                        transition: 'opacity 0.15s',
                      }}
                      title={`${fmtFullDate(d.data)} — ${fR(d.saldo)}`}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.opacity = '0.8' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.opacity = '1' }}
                    />
                  )
                })}
              </div>

              {/* Eixo X */}
              <div
                className="flex mt-1"
                style={{ gap: saude.length > 60 ? 2 : 6 }}
              >
                {saude.map((d, i) => (
                  <div
                    key={d.data}
                    className="flex-1 text-center"
                    style={{
                      fontSize: 8,
                      color: i % step === 0 ? 'var(--ink3)' : 'transparent',
                      minWidth: 3,
                      userSelect: 'none',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                    }}
                  >
                    {fmtAxisDate(d.data)}
                  </div>
                ))}
              </div>

            </div>
          </div>
        </>
      )}
    </>
  )
}
