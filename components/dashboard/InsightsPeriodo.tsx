'use client'

import { fR } from '@/lib/utils'
import {
  calcTicketMedioReceita,
  calcDiaDePico,
  calcBurnDiario,
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

//── Trend badge ───────────────────────────────────────────────────────────────

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

  if (data.length === 0) return null

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
    </>
  )
}
