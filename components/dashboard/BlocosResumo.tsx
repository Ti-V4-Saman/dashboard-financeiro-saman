'use client'

import { fR } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ValorPct { valor: number; pct: number }

export interface IndicadoresData {
  receitaLiquida:  number
  mgOperacional:   ValorPct
  mgContribuicao:  ValorPct
  ebitda:          ValorPct
  csp:             ValorPct
  comercial:       ValorPct
  administrativa:  ValorPct
  gerais:          ValorPct
}

export interface ContratosData {
  ativos:            number
  receitaRecorrente: number
  ticketMedio:       number
  aVencer30:         number
  vencidosAtivos:    number
  inativos:          number
  semCC:             number
}

export interface NotasData {
  emitidas:           number
  lancamentosReceita: number
  coberturaPct:       number
  qtdSemNota:         number
  valorFaturado:      number
  canceladasFalha:    number
  detalheCancel:      string
  pagoSemNotaQtd:     number
  pagoSemNotaValor:   number
}

export interface BlocosData {
  indicadores: IndicadoresData | null
  contratos:   ContratosData   | null
  notas:       NotasData       | null
}

// ── Semantic colours ───────────────────────────────────────────────────────────
const C = {
  green:   '#1D9E75',
  red:     '#E24B4A',
  blue:    '#185FA5',
  amber:   '#B97D10',
  default: 'var(--ink)',
} as const

// ── Small helpers ──────────────────────────────────────────────────────────────

const pctFmt = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'

// Card skeleton
function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: 16,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      }}
    >
      {children}
    </div>
  )
}

// Card header (tag + title)
function CardHeader({ tag, title }: { tag: string; title: string }) {
  return (
    <div className="mb-3">
      <div
        style={{
          fontSize: 10,
          color: 'var(--ink3)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          marginBottom: 2,
        }}
      >
        {tag}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--ink)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {title}
      </div>
    </div>
  )
}

// Highlight row (background stripe)
function HighlightRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 8,
        background: 'var(--surf2)',
        margin: '0 -16px',
        padding: '9px 16px',
        borderBottom: '0.5px solid var(--line)',
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: 'var(--ink2)',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: 1,
          minWidth: 0,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 700, color: color || C.default, whiteSpace: 'nowrap', flexShrink: 0 }}>
        {value}
      </span>
    </div>
  )
}

// Regular row — label left, optional pct col, value right
function Row({
  label,
  value,
  pct,
  sub,
  color,
  last = false,
}: {
  label: string
  value: string
  pct?: string   // shown inline before value when provided
  sub?: string   // shown below value when pct is NOT provided
  color?: string
  last?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 0',
        borderBottom: last ? 'none' : '0.5px solid var(--line)',
      }}
    >
      {/* label */}
      <span
        style={{
          fontSize: 11,
          color: 'var(--ink3)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: 1,
          minWidth: 0,
        }}
      >
        {label}
      </span>

      {/* percentage column (only when pct is provided) */}
      {pct && (
        <span
          style={{
            fontSize: 10,
            color: color || 'var(--ink3)',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            minWidth: 36,
            textAlign: 'right',
            opacity: 0.75,
          }}
        >
          {pct}
        </span>
      )}

      {/* value */}
      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 80 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: color || C.default, whiteSpace: 'nowrap' }}>
          {value}
        </div>
        {!pct && sub && (
          <div style={{ fontSize: 10, color: 'var(--ink3)', whiteSpace: 'nowrap' }}>{sub}</div>
        )}
      </div>
    </div>
  )
}

// Dual value row: pct col + R$ value — single line
function DualRow({
  label,
  vp,
  color,
  last = false,
}: {
  label: string
  vp: ValorPct
  color?: string
  last?: boolean
}) {
  return (
    <Row
      label={label}
      value={fR(vp.valor)}
      pct={pctFmt(vp.pct)}
      color={color}
      last={last}
    />
  )
}

// Skeleton placeholder
function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 28,
            borderRadius: 4,
            background: 'var(--surf2)',
            animation: 'pulse 1.5s ease-in-out infinite',
            opacity: 0.7,
          }}
        />
      ))}
    </div>
  )
}

// ── Card: Indicadores ─────────────────────────────────────────────────────────

function CardIndicadores({ data }: { data: IndicadoresData | null }) {
  return (
    <CardShell>
      <CardHeader tag="Período" title="Indicadores" />
      {!data ? (
        <Skeleton rows={8} />
      ) : (
        <>
          <HighlightRow label="Receita líquida" value={fR(data.receitaLiquida)} color={C.green} />
          <DualRow label="Mg. operacional"  vp={data.mgOperacional}  color={C.green} />
          <DualRow label="Mg. contribuição" vp={data.mgContribuicao} color={C.green} />
          <DualRow label="EBITDA"           vp={data.ebitda}         color={C.green} />
          <DualRow label="CSP"              vp={data.csp}            color={C.red}   />
          <DualRow label="Comercial"        vp={data.comercial}      color={C.red}   />
          <DualRow label="Administrativa"   vp={data.administrativa} color={C.red}   />
          <DualRow label="Gerais"           vp={data.gerais}         color={C.red}   last />
        </>
      )}
    </CardShell>
  )
}

// ── Card: Contratos ───────────────────────────────────────────────────────────

function CardContratos({ data }: { data: ContratosData | null }) {
  return (
    <CardShell>
      <CardHeader tag="Recorrência" title="Contratos" />
      {!data ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <HighlightRow
            label="Contratos ativos"
            value={data.ativos.toLocaleString('pt-BR')}
            color={C.green}
          />
          <Row
            label="Receita recorrente"
            value={fR(data.receitaRecorrente)}
            color={C.green}
          />
          <Row
            label="Ticket médio"
            value={data.ticketMedio > 0 ? fR(data.ticketMedio) : '—'}
          />
          <Row
            label="A vencer em 30 dias"
            value={data.aVencer30.toLocaleString('pt-BR')}
            color={data.aVencer30 > 0 ? C.amber : C.default}
            sub={data.aVencer30 > 0 ? 'contratos' : undefined}
          />
          <Row
            label="Vencidos (ativos)"
            value={data.vencidosAtivos.toLocaleString('pt-BR')}
            color={data.vencidosAtivos > 0 ? C.red : C.default}
            sub={data.vencidosAtivos > 0 ? 'data fim passada' : undefined}
          />
          <Row
            label="Inativos"
            value={data.inativos.toLocaleString('pt-BR')}
          />
          <Row
            label="Sem CC vinculado"
            value={data.semCC.toLocaleString('pt-BR')}
            color={data.semCC > 0 ? C.amber : C.default}
            last
          />
        </>
      )}
    </CardShell>
  )
}

// ── Card: Notas Fiscais ───────────────────────────────────────────────────────

function CardNotas({ data }: { data: NotasData | null }) {
  const coberturaColor =
    !data        ? C.default
    : data.coberturaPct >= 90 ? C.green
    : C.amber

  return (
    <CardShell>
      <CardHeader tag="Conciliação" title="Notas fiscais" />
      {!data ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <HighlightRow
            label="Emitidas no período"
            value={data.emitidas.toLocaleString('pt-BR')}
            color={C.blue}
          />
          <Row
            label="Lançamentos receita"
            value={data.lancamentosReceita.toLocaleString('pt-BR')}
          />
          <Row
            label="Cobertura nota/receita"
            value={pctFmt(data.coberturaPct)}
            color={coberturaColor}
            sub={data.qtdSemNota > 0 ? `${data.qtdSemNota} sem nota` : 'completo'}
          />
          <Row
            label="Valor faturado"
            value={fR(data.valorFaturado)}
          />
          <Row
            label="Canceladas / falha"
            value={data.canceladasFalha.toLocaleString('pt-BR')}
            color={data.canceladasFalha > 0 ? C.red : C.default}
            sub={data.detalheCancel || undefined}
          />
          <Row
            label="Pago sem nota"
            value={data.pagoSemNotaQtd.toLocaleString('pt-BR')}
            color={data.pagoSemNotaQtd > 0 ? C.amber : C.default}
            sub={data.pagoSemNotaQtd > 0 ? fR(data.pagoSemNotaValor) : undefined}
            last
          />
        </>
      )}
    </CardShell>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

interface Props {
  blocos:  BlocosData | null
  loading: boolean
}

export function BlocosResumo({ blocos, loading }: Props) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)',
        gap: 12,
      }}
    >
      <CardIndicadores data={loading ? null : (blocos?.indicadores ?? null)} />
      <CardContratos   data={loading ? null : (blocos?.contratos   ?? null)} />
      <CardNotas       data={loading ? null : (blocos?.notas        ?? null)} />
    </div>
  )
}
