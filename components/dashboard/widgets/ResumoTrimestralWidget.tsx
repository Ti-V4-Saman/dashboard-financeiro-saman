'use client'

/**
 * Resumo Trimestral — Competência
 *
 * 3 cards lado a lado mostrando DRE compacta de:
 *   • Mês de referência (derivado de filters.dateTo.slice(0,7))
 *   • M+1 e M+2 (próximos 2 meses)
 *
 * Sempre em REGIME DE COMPETÊNCIA (independente do seletor do dash).
 *
 * REGRAS DE NEGÓCIO (auditadas com o usuário antes de implementar):
 *
 *  • Período: mês inteiro derivado de `dateTo.slice(0,7)`. Mesmo se o filtro
 *    do dash for "01/04 a 15/04", o card mostra abril completo + mai + jun.
 *  • Fonte: `allData` (lançamentos sem filtro de data) com filtros
 *    NÃO-temporais aplicados (categoria, CC, tipo, situação, conta).
 *    Isso garante que o Δ vs mês anterior funciona mesmo quando M-1 está
 *    fora do range filtrado pelo usuário.
 *  • Status: exclui Cancelado/Renegociado. Inclui Quitado, Aberto,
 *    Atrasado, Parcial.
 *  • Transferências: excluídas via r.isTransfer.
 *  • Valor: usa `r.valor` (face do lançamento — alinhado com KPIs principais
 *    da VisaoGeral). NÃO usa `r.valorDRE` (que é valor_pago). Divergência
 *    consciente com DRE tab — rastreada em docs/decisoes-financeiras.md.
 *  • Pagamento Parcial: entra com `valor` cheio (replica Gap 1 conscientemente
 *    para alinhar com KPIs principais). Correção do split contábil rastreada
 *    em decisoes-financeiras.md (Fase 4).
 *  • Meta: cruzamento via tabela `metas` (mes_referencia = YYYY-MM), agrupada
 *    por categoria_nivel_1. Subtotais (ROL, LB, EBITDA, LL) derivam meta
 *    pela soma assinada dos grupos componentes.
 *  • Thresholds de cor (INVERTIDOS por tipo):
 *      Receita: ≥95% verde, 80-94 amarelo, <80 vermelho
 *      Despesa: ≤100% verde, 101-110 amarelo, >110 vermelho
 *  • Δ vs mês anterior: só em 4 linhas-chave (Rec. Op., LB, EBITDA, LL).
 *      Usa allData sem filtro de data. Receita: subida = bom (verde);
 *      Despesa: subida = ruim (vermelho); subtotais tratados como receita.
 */
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import type { Lancamento, Filters, Meta } from '@/lib/types'
import { parseCatHier } from '@/lib/utils'

interface Props {
  filters: Filters
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then(r => r.json())

const MES_LABEL_CURTO = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
                              'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function ymLabel(ym: string): string {
  if (!ym || ym.length < 7) return '—'
  const [y, m] = ym.split('-').map(Number)
  return `${MES_LABEL_CURTO[m]}/${String(y).slice(2)}`
}

function nextMonth(ym: string): string {
  if (!ym) return ''
  const [y, m] = ym.split('-').map(Number)
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1     : m + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

function prevMonth(ym: string): string {
  if (!ym) return ''
  const [y, m] = ym.split('-').map(Number)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12    : m - 1
  return `${py}-${String(pm).padStart(2, '0')}`
}

/** Primeiro dia do mês YYYY-MM-DD. */
function firstDayOf(ym: string): string {
  return `${ym}-01`
}

/** Último dia do mês YYYY-MM-DD. */
function lastDayOf(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m, 0).getDate() // dia 0 do mês seguinte = último do atual
  return `${ym}-${String(d).padStart(2, '0')}`
}

/** Formatação BRL sem centavos, com abreviação automática acima de R$ 1M.
 *  Garante caber em 88px com font 11px tabular-nums. */
function fRdre(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) {
    return `${v < 0 ? '-' : ''}R$ ${(abs / 1_000_000).toFixed(1).replace('.', ',')}M`
  }
  return v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

// ── Linha config ─────────────────────────────────────────────────────────────

type LinhaKind = 'receita' | 'despesa' | 'subtotal' | 'resultado'

interface LinhaCalc {
  id: string
  label: string
  total: number
  meta: number               // sempre signed (negativo para despesas)
  kind: LinhaKind
  delta: boolean             // mostra Δ vs mês anterior?
}

interface MesCalc {
  ym: string
  hasData: boolean
  linhas: LinhaCalc[]
}

// L1 labels conforme gM() em lib/utils.ts
const L1_REC_OP   = '1 — Rec. Operacionais'
const L1_DED      = '2 — Deduções'
const L1_CUSTOS   = '3 — Custos Operac.'
const L1_DESP     = '4 — Despesas'
const L1_REC_FIN  = '6.1 — Rec. Financeira'
const L1_DESP_FIN = '6.2 — Desp. Financeira'
const L1_DEPREC   = '5 — Depreciações'
const L1_IMP_LUC  = '7 — Impostos s/ Lucro'

/** Calcula linhas da DRE para um mês específico.
 *
 *  `excludeBaixados=true` filtra lançamentos com situacao === 'Quitado'.
 *  Usado para meses FUTUROS (M+1, M+2): em projeção, lançamentos já baixados
 *  pertencem ao mês em que foram pagos (caixa), não ao mês de competência
 *  futuro — evita double-counting com a visão de caixa realizado.
 *  Mês de referência (M) mantém competência completa (inclui Quitado).
 */
function calcMes(
  ym: string,
  data: Lancamento[],
  metas: Meta[],
  excludeBaixados: boolean = false,
): MesCalc {
  if (!ym) return { ym: '', hasData: false, linhas: [] }
  const rows = data.filter(r => {
    if (r.data_ym !== ym) return false
    if (excludeBaixados && r.situacao === 'Quitado') return false
    return true
  })
  const metasMes = metas.filter(m => m.mes_referencia === ym)

  /** Soma assinada (receita + / despesa −) das categorias do(s) L1. */
  const calcTotal = (l1: string | string[]): number => {
    const labels = Array.isArray(l1) ? l1 : [l1]
    return rows
      .filter(r => labels.includes(parseCatHier(r.cat1).l1))
      .reduce((s, r) => s + (r.tipo === 'Receita' ? r.valor : -r.valor), 0)
  }

  /** Soma absoluta (positiva) das metas do(s) L1. */
  const calcMetaAbs = (l1: string | string[]): number => {
    const labels = Array.isArray(l1) ? l1 : [l1]
    return metasMes
      .filter(m => labels.includes(parseCatHier(m.categoria_nivel_3 || m.categoria || '').l1))
      .reduce((s, m) => s + (m.valor_planejado || 0), 0)
  }

  const totalRecOp   = calcTotal(L1_REC_OP)
  const totalDed     = calcTotal(L1_DED)
  const totalROL     = totalRecOp + totalDed                  // dedução já é negativa
  const totalCusto   = calcTotal(L1_CUSTOS)
  const totalLB      = totalROL + totalCusto
  const totalDesp    = calcTotal(L1_DESP)
  const totalEBITDA  = totalLB + totalDesp
  const totalRecFin  = calcTotal(L1_REC_FIN)
  const totalDespFin = calcTotal(L1_DESP_FIN)
  const totalOutros  = calcTotal([L1_DEPREC, L1_IMP_LUC])     // depreciação + imp. sobre lucro
  const totalLL      = totalEBITDA + totalRecFin + totalDespFin + totalOutros

  // Meta SIGNED: receita = +abs, despesa = −abs
  const metaRecOp    = calcMetaAbs(L1_REC_OP)
  const metaDed      = -calcMetaAbs(L1_DED)
  const metaROL      = metaRecOp + metaDed
  const metaCusto    = -calcMetaAbs(L1_CUSTOS)
  const metaLB       = metaROL + metaCusto
  const metaDesp     = -calcMetaAbs(L1_DESP)
  const metaEBITDA   = metaLB + metaDesp
  const metaRecFin   = calcMetaAbs(L1_REC_FIN)
  const metaDespFin  = -calcMetaAbs(L1_DESP_FIN)
  const metaOutros   = -calcMetaAbs([L1_DEPREC, L1_IMP_LUC])
  const metaLL       = metaEBITDA + metaRecFin + metaDespFin + metaOutros

  const linhas: LinhaCalc[] = [
    { id: 'rec_op',  label: '1 — Rec. Operacionais', total: totalRecOp,   meta: metaRecOp,   kind: 'receita',   delta: true  },
    { id: 'ded',     label: '2 — Deduções',          total: totalDed,     meta: metaDed,     kind: 'despesa',   delta: false },
    { id: 'rol',     label: '(=) Rec. Op. Líquida',  total: totalROL,     meta: metaROL,     kind: 'subtotal',  delta: false },
    { id: 'cu',      label: '3 — Custos Operac.',    total: totalCusto,   meta: metaCusto,   kind: 'despesa',   delta: false },
    { id: 'lb',      label: '(=) Lucro Bruto',       total: totalLB,      meta: metaLB,      kind: 'subtotal',  delta: true  },
    { id: 'desp',    label: '4 — Despesas',          total: totalDesp,    meta: metaDesp,    kind: 'despesa',   delta: false },
    { id: 'ebitda',  label: '(=) EBITDA',            total: totalEBITDA,  meta: metaEBITDA,  kind: 'subtotal',  delta: true  },
    { id: 'recf',    label: '6.1 — Rec. Financeira', total: totalRecFin,  meta: metaRecFin,  kind: 'receita',   delta: false },
    { id: 'despf',   label: '6.2 — Desp. Financeira',total: totalDespFin, meta: metaDespFin, kind: 'despesa',   delta: false },
    { id: 'outros',  label: 'Outros',                total: totalOutros,  meta: metaOutros,  kind: 'despesa',   delta: false },
    { id: 'll',      label: '(=) Lucro Líquido',     total: totalLL,      meta: metaLL,      kind: 'resultado', delta: true  },
  ]

  const hasData = linhas.some(l => l.total !== 0 || l.meta !== 0)
  return { ym, hasData, linhas }
}

// ── Cor do badge de % meta (regra invertida por tipo) ────────────────────────

function pctBadgeStyle(ratio: number, kind: LinhaKind):
  { bg: string; fg: string }
{
  // Tratamos subtotal/resultado como Receita (queremos ≥ meta)
  const isReceita = kind === 'receita' || kind === 'subtotal' || kind === 'resultado'

  if (isReceita) {
    if (ratio >= 0.95) return { bg: '#EAF3DE', fg: '#27500A' }   // verde
    if (ratio >= 0.80) return { bg: '#FAEEDA', fg: '#633806' }   // amarelo
    return { bg: '#FCEBEB', fg: '#791F1F' }                       // vermelho
  }
  // Despesa: ratio > 1.0 significa gastou mais que o planejado (ruim)
  if (ratio <= 1.00) return { bg: '#EAF3DE', fg: '#27500A' }
  if (ratio <= 1.10) return { bg: '#FAEEDA', fg: '#633806' }
  return { bg: '#FCEBEB', fg: '#791F1F' }
}

// ── Δ vs mês anterior (cor) ──────────────────────────────────────────────────

interface DeltaInfo {
  pct: number             // pode ser negativo
  arrow: '▲' | '▼' | '—'
  color: string
}

/** Calcula Δ comparando absolutos (intuitivo para despesa). */
function calcDelta(cur: number, prev: number, kind: LinhaKind): DeltaInfo | null {
  if (prev === 0 && cur === 0) return null
  if (prev === 0)              return null  // sem base de comparação

  const isReceita = kind === 'receita' || kind === 'subtotal' || kind === 'resultado'

  // Para receita/subtotal/resultado: usa signed (crescer é sempre bom)
  // Para despesa: usa absoluto (gasto aumentando é ruim, independente do sinal)
  const deltaPct = isReceita
    ? (cur - prev) / Math.abs(prev)
    : (Math.abs(cur) - Math.abs(prev)) / Math.abs(prev)

  if (Math.abs(deltaPct) < 0.005) {
    return { pct: 0, arrow: '—', color: '#6b7280' }
  }

  const subiu = deltaPct > 0
  const bom = isReceita ? subiu : !subiu
  return {
    pct: deltaPct,
    arrow: subiu ? '▲' : '▼',
    color: bom ? '#27500A' : '#791F1F',
  }
}

// ── Estilos compartilhados ───────────────────────────────────────────────────

// Grid template IDÊNTICO em header e em cada linha — garante alinhamento
// vertical das 3 colunas de número entre todas as linhas e entre os 3 cards.
const ROW_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 88px 88px 54px',
  columnGap: 6,
  alignItems: 'baseline',
}

// Css de célula numérica — aplicar em todas (Total, Meta, % meta).
const NUM_CELL: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  textAlign: 'right',
  overflow: 'hidden',
}

const DESC_CELL: React.CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
}

// ── Linha da tabela ──────────────────────────────────────────────────────────

function LinhaRow({ linha, anterior }: { linha: LinhaCalc; anterior?: LinhaCalc }) {
  const isSubtotal  = linha.kind === 'subtotal'
  const isResultado = linha.kind === 'resultado'
  const fontWeight  = isSubtotal || isResultado ? 700 : 500
  const labelColor  = isResultado ? 'var(--ink)' : isSubtotal ? 'var(--ink)' : 'var(--ink2)'
  // Cor do TOTAL:
  //   • receita    → verde
  //   • despesa    → vermelho
  //   • subtotal   → verde se >= 0, vermelho se < 0
  //   • resultado  → verde se >= 0, vermelho se < 0
  const totalColor =
    linha.kind === 'receita'  ? 'var(--green)' :
    linha.kind === 'despesa'  ? 'var(--red)'   :
    /* subtotal/resultado */    (linha.total >= 0 ? 'var(--green)' : 'var(--red)')

  // Ratio para badge de % meta
  const hasMeta = Math.abs(linha.meta) > 0.01
  const ratio   = hasMeta ? Math.abs(linha.total) / Math.abs(linha.meta) : 0
  const pctNum  = hasMeta ? Math.round(ratio * 100) : null
  const badge   = hasMeta ? pctBadgeStyle(ratio, linha.kind) : null

  // Δ vs mês anterior (só em 4 linhas-chave + se houver dado do mês anterior)
  const delta = linha.delta && anterior
    ? calcDelta(linha.total, anterior.total, linha.kind)
    : null

  return (
    <div style={{
      ...ROW_GRID,
      padding: '4px 0',
      fontSize: 11,
      borderTop: isSubtotal || isResultado ? '1px solid var(--line)' : undefined,
      background: isResultado ? 'var(--surf2)' : undefined,
    }}>
      {/* Descrição (única coluna que pode encurtar com ellipsis) */}
      <div style={{ ...DESC_CELL, color: labelColor, fontWeight }} title={linha.label}>
        {linha.label}
      </div>

      {/* Total */}
      <div style={{ ...NUM_CELL, color: totalColor, fontWeight }}>
        {fRdre(linha.total)}
        {delta && (
          <span style={{ marginLeft: 4, fontSize: 9, fontWeight: 600, color: delta.color }}>
            {delta.arrow}{Math.abs(Math.round(delta.pct * 100))}%
          </span>
        )}
      </div>

      {/* Meta */}
      <div style={{ ...NUM_CELL, color: hasMeta ? 'var(--ink3)' : 'var(--ink4, #9ca3af)', fontWeight: 400 }}>
        {hasMeta ? fRdre(linha.meta) : '—'}
      </div>

      {/* % meta — badge colorido */}
      <div style={{ ...NUM_CELL, fontWeight: 600 }}>
        {hasMeta && badge && pctNum !== null ? (
          <span style={{
            background:    badge.bg,
            color:         badge.fg,
            padding:       '1px 5px',
            borderRadius:  3,
            fontSize:      10,
            display:       'inline-block',
            minWidth:      36,
          }}>
            {pctNum}%
          </span>
        ) : (
          <span style={{ color: 'var(--ink4, #9ca3af)', fontSize: 10 }}>—</span>
        )}
      </div>
    </div>
  )
}

// ── Tooltip de regra ─────────────────────────────────────────────────────────

/**
 * Ícone (i) com tooltip explicando a regra híbrida competência/caixa do widget.
 *
 * O widget tenta projetar o CAIXA dos próximos meses — por isso o mês de
 * referência inclui Quitados (competência completa), mas M+1 e M+2 excluem
 * Quitados, já que esses lançamentos já foram pagos e contam no mês do
 * pagamento (não no mês de competência futuro).
 */
function InfoTooltip() {
  const [open, setOpen] = useState(false)
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span
        tabIndex={0}
        aria-label="Como o Resumo Trimestral é calculado"
        style={{
          display:        'inline-flex',
          alignItems:     'center',
          justifyContent: 'center',
          width:          16,
          height:         16,
          borderRadius:   '50%',
          border:         '1px solid var(--ink3)',
          color:          'var(--ink3)',
          fontSize:       10,
          fontWeight:     700,
          cursor:         'help',
          lineHeight:     1,
          userSelect:     'none',
        }}
      >
        i
      </span>
      {open && (
        <div
          role="tooltip"
          style={{
            position:    'absolute',
            top:         'calc(100% + 6px)',
            left:        0,
            zIndex:      50,
            width:       360,
            background:  'var(--surface)',
            border:      '1px solid var(--line)',
            borderRadius: 8,
            padding:     12,
            fontSize:    11,
            lineHeight:  1.45,
            color:       'var(--ink2)',
            boxShadow:   '0 4px 12px rgba(0,0,0,0.08)',
          }}
        >
          <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>
            Como ler este resumo
          </div>
          <p style={{ margin: '0 0 8px' }}>
            O objetivo é <strong>prever o caixa</strong> dos próximos meses —
            não reproduzir a DRE em competência.
          </p>
          <ul style={{ margin: '0 0 8px', paddingLeft: 16 }}>
            <li style={{ marginBottom: 4 }}>
              <strong>Mês de referência:</strong> competência completa
              (inclui Recebidos/Pagos + em aberto).
            </li>
            <li style={{ marginBottom: 4 }}>
              <strong>M+1 e M+2:</strong> apenas lançamentos em aberto
              (Aberto, Atrasado, Parcial). Quitados são <em>excluídos</em>
              porque já entraram no caixa do mês do pagamento.
            </li>
          </ul>
          <p style={{ margin: 0, color: 'var(--ink3)' }}>
            Por isso o total pode <strong>divergir da DRE</strong> em
            competência: lá os quitados aparecem na competência futura;
            aqui eles ficam no mês em que o dinheiro entrou.
          </p>
        </div>
      )}
    </span>
  )
}

// ── Card de mês ──────────────────────────────────────────────────────────────

function CardMes({
  mes, anterior, badge, badgeColor, isRef,
}: {
  mes: MesCalc
  anterior?: MesCalc
  badge: string
  badgeColor: string
  isRef: boolean
}) {
  return (
    <div style={{
      background:    'var(--surface)',
      border:        isRef ? '2px solid var(--blue)' : '1px solid var(--line)',
      borderRadius:  10,
      padding:       12,
      minWidth:      0,
    }}>
      {/* Header do card: badge + label do mês */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        marginBottom:   8,
        gap:            6,
      }}>
        <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
          {ymLabel(mes.ym)}
        </h4>
        <span style={{
          fontSize:       9,
          fontWeight:     700,
          padding:        '2px 6px',
          borderRadius:   3,
          background:     badgeColor,
          color:          '#fff',
          textTransform:  'uppercase',
          letterSpacing:  '0.04em',
          whiteSpace:     'nowrap',
        }}>{badge}</span>
      </div>

      {/* Header de colunas (mesmo grid das linhas) */}
      <div style={{
        ...ROW_GRID,
        paddingBottom: 4,
        borderBottom:  '1px solid var(--line)',
        marginBottom:  2,
        fontSize:      9,
        fontWeight:    700,
        color:         'var(--ink3)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}>
        <div>Descrição</div>
        <div style={{ ...NUM_CELL, fontWeight: 700 }}>Total</div>
        <div style={{ ...NUM_CELL, fontWeight: 700 }}>Meta</div>
        <div style={{ ...NUM_CELL, fontWeight: 700 }}>% meta</div>
      </div>

      {/* Sem dados — placeholder neutro */}
      {!mes.hasData && (
        <div style={{
          padding:    '24px 0',
          textAlign:  'center',
          fontSize:   11,
          color:      'var(--ink3)',
          fontStyle:  'italic',
        }}>
          Sem lançamentos no período
        </div>
      )}

      {/* Linhas */}
      {mes.hasData && mes.linhas.map(linha => {
        const ant = anterior?.linhas.find(l => l.id === linha.id)
        return <LinhaRow key={linha.id} linha={linha} anterior={ant} />
      })}
    </div>
  )
}

// ── Skeleton durante loading ─────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div style={{
      background:   'var(--surface)',
      border:       '1px solid var(--line)',
      borderRadius: 10,
      padding:      12,
      minHeight:    340,
      opacity:      0.55,
    }}>
      <div style={{
        height: 14, width: 90,
        background: 'var(--surf2)', borderRadius: 4,
        marginBottom: 16,
        animation: 'pulse 1.5s ease-in-out infinite',
      }} />
      {Array.from({ length: 11 }).map((_, i) => (
        <div key={i} style={{
          height: 12, marginTop: 6,
          background: 'var(--surf2)', borderRadius: 3,
          animation: 'pulse 1.5s ease-in-out infinite',
        }} />
      ))}
    </div>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────

export default function ResumoTrimestralWidget({ filters }: Props) {
  const { data: metas = [], isLoading: metasLoading } = useSWR<Meta[]>(
    '/api/metas',
    fetcher,
    { refreshInterval: 5 * 60 * 1000 },
  )

  // Mês de referência = dateTo.slice(0,7). Quando o filtro for "todo-periodo"
  // (dateTo vazio), assume o mês atual.
  const mesRef = useMemo(() => {
    if (filters.dateTo && filters.dateTo.length >= 7) {
      return filters.dateTo.slice(0, 7)
    }
    const h = new Date()
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`
  }, [filters.dateTo])

  const mesM1  = useMemo(() => nextMonth(mesRef), [mesRef])
  const mesM2  = useMemo(() => nextMonth(mesM1),  [mesM1])
  const mesAnt = useMemo(() => prevMonth(mesRef), [mesRef])

  // Range próprio (M-1 .. M+2) em regime de competência — independente do
  // filtro de data do dash, que não cobre M+1/M+2.
  const rangeDe  = useMemo(() => firstDayOf(mesAnt), [mesAnt])
  const rangeAte = useMemo(() => lastDayOf(mesM2),   [mesM2])

  const apiUrl = useMemo(
    () => `/api/financeiro?de=${rangeDe}&ate=${rangeAte}&regime=competencia`,
    [rangeDe, rangeAte],
  )

  const { data: apiResp, isLoading: dataLoading } = useSWR<{ lancamentos: Lancamento[] }>(
    apiUrl,
    fetcher,
    { refreshInterval: 5 * 60 * 1000, keepPreviousData: true },
  )

  const apiData = useMemo<Lancamento[]>(
    () => apiResp?.lancamentos ?? [],
    [apiResp],
  )

  // Aplica filtros NÃO-temporais (mantém o card alinhado com filtros do dash
  // exceto data). Filtros: categoria, cc, tipo, situacao, conta + regras de
  // ouro: !isTransfer, !Cancelado, !Renegociado.
  const dataFiltradaNaoTemporal = useMemo(() => {
    return apiData.filter(r => {
      if (r.isTransfer) return false
      if (r.situacao === 'Cancelado' || r.situacao === 'Renegociado') return false

      if (filters.categoria.length > 0) {
        const cats = r.categorias.map(c => c.nome)
        if (!filters.categoria.some(c => cats.includes(c))) return false
      }
      if (filters.cc.length > 0) {
        const ccs = r._ccList.map(c => c.nome)
        if (!filters.cc.some(c => ccs.includes(c))) return false
      }
      if (filters.tipo            && r.tipo     !== filters.tipo)     return false
      if (filters.situacao.length > 0 && !filters.situacao.includes(r.situacao)) return false
      if (filters.conta.length    > 0 && !filters.conta.includes(r.conta))       return false
      return true
    })
  }, [apiData, filters.categoria, filters.cc, filters.tipo, filters.situacao, filters.conta])

  // Mês de referência: competência completa (inclui Quitado).
  // Próximos meses (M+1, M+2): competência menos baixados — quitados já
  // pertencem ao mês do pagamento (caixa), não ao mês de competência futuro.
  // Mês anterior (para Δ): competência completa, para comparação consistente
  // com o mês de referência.
  const calcRef  = useMemo(() => calcMes(mesRef,  dataFiltradaNaoTemporal, metas, false), [mesRef,  dataFiltradaNaoTemporal, metas])
  const calcM1   = useMemo(() => calcMes(mesM1,   dataFiltradaNaoTemporal, metas, true),  [mesM1,   dataFiltradaNaoTemporal, metas])
  const calcM2   = useMemo(() => calcMes(mesM2,   dataFiltradaNaoTemporal, metas, true),  [mesM2,   dataFiltradaNaoTemporal, metas])
  const calcAnt  = useMemo(() => calcMes(mesAnt,  dataFiltradaNaoTemporal, metas, false), [mesAnt,  dataFiltradaNaoTemporal, metas])

  const loading = (metasLoading && metas.length === 0) || (dataLoading && !apiResp)

  return (
    <section>
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <h3 style={{
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--ink)',
            margin: 0,
          }}>
            Resumo Trimestral — Projeção de Caixa
          </h3>
          <InfoTooltip />
        </div>
        <p style={{
          fontSize: 11,
          color: 'var(--ink3)',
          margin: '2px 0 0',
        }}>
          Mês de referência (filtro do dash) + 2 meses seguintes · meta cruzada via módulo Metas
        </p>
      </div>

      <div
        className="grid"
        style={{
          // Desktop: 3 colunas iguais; em telas estreitas o auto-fit empilha.
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 12,
          alignItems: 'start',
        }}
      >
        {loading ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          <>
            <CardMes
              mes={calcRef}
              anterior={calcAnt}
              badge="REFERÊNCIA"
              badgeColor="var(--blue, #1B55A3)"
              isRef
            />
            <CardMes
              mes={calcM1}
              anterior={calcRef}
              badge="M+1"
              badgeColor="var(--ink3)"
              isRef={false}
            />
            <CardMes
              mes={calcM2}
              anterior={calcM1}
              badge="M+2"
              badgeColor="var(--ink3)"
              isRef={false}
            />
          </>
        )}
      </div>
    </section>
  )
}
