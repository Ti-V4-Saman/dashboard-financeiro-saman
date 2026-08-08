'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import type { Lancamento, Filters } from '@/lib/types'
import { useAccess } from '@/lib/useAccess'
import { isAggClientEnabled } from '@/lib/feature-aggregation'
import { aggFetcher, buildAggQuery, isForbidden } from '@/lib/agg-client'
import {
  aggResumoDRE, aggDetalheDRE, serializeLinhaRef,
  type ResumoDRE, type LinhaRef, type DetalheRow, type DetalheDREResp,
} from '@/lib/aggregations/dre'
import { fR, mLbl } from '@/lib/utils'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

// ─── Tooltip (fixed, segue cursor — não é cortado pelo overflow da tabela) ───

function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  return (
    <span
      style={{ position: 'relative', cursor: 'help' }}
      onMouseMove={e => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && (
        <span
          style={{
            position: 'fixed',
            left: pos.x + 14,
            top: pos.y - 10,
            transform: 'translateY(-100%)',
            zIndex: 9999,
            background: '#18181b',
            color: '#f4f4f5',
            borderRadius: 7,
            padding: '8px 12px',
            fontSize: 11,
            lineHeight: 1.6,
            whiteSpace: 'pre-line',
            maxWidth: 300,
            minWidth: 200,
            boxShadow: '0 6px 24px rgba(0,0,0,0.30)',
            fontWeight: 400,
            pointerEvents: 'none',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          {text}
        </span>
      )}
    </span>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────

type RowKind = 'l1' | 'l2' | 'l3' | 'subtotal' | 'ebitda' | 'resultado'

interface DRERow {
  id: string
  kind: RowKind
  label: string
  l1Key?: string
  l2Key?: string
  vals: number[]
  tip?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function numPrefix(s: string): number {
  const m = s.match(/^([\d.]+)/)
  return m ? parseFloat(m[1]) : 999
}

function fPct(val: number, base: number): string {
  if (!base) return '—'
  return ((val / base) * 100).toFixed(1).replace('.', ',') + '%'
}

function fPctAbs(val: number, base: number): string {
  if (!base) return '—'
  return (Math.abs(val / base) * 100).toFixed(1).replace('.', ',') + '%'
}

// ─── Visual config ────────────────────────────────────────────────────────────

const ROW_STYLE: Record<RowKind, { bg: string; fg: string; fw: number; fs: number; py: number }> = {
  l1:        { bg: 'var(--surf2)',   fg: 'var(--ink)',  fw: 700, fs: 12, py: 10 },
  l2:        { bg: 'var(--surface)', fg: 'var(--ink2)', fw: 600, fs: 11, py: 9  },
  l3:        { bg: 'var(--surface)', fg: 'var(--ink)',  fw: 400, fs: 11, py: 8  },
  subtotal:  { bg: 'var(--surf2)',   fg: 'var(--ink)',  fw: 700, fs: 12, py: 10 },
  ebitda:    { bg: '#fef9ec',        fg: '#92400e',     fw: 700, fs: 12, py: 11 },
  resultado: { bg: '#f0fdf4',        fg: '#166534',     fw: 700, fs: 12, py: 11 },
}

const INDENT: Record<RowKind, number> = {
  l1: 12, l2: 28, l3: 44, subtotal: 12, ebitda: 12, resultado: 12,
}

function valColor(val: number, kind: RowKind): string {
  if (kind === 'ebitda' || kind === 'resultado')
    return val >= 0 ? '#166534' : '#991b1b'
  return val >= 0 ? 'var(--green)' : 'var(--red)'
}

function accumBg(kind: RowKind): string {
  if (kind === 'ebitda')    return '#fef3c7'
  if (kind === 'resultado') return '#dcfce7'
  return 'rgba(22, 101, 52, 0.04)'
}

function accumFg(kind: RowKind): string {
  if (kind === 'ebitda')    return '#92400e'
  if (kind === 'resultado') return '#166534'
  return ''
}

// ─── Executive KPI card ───────────────────────────────────────────────────────

function ExecCard({
  label, value, sub, color, dim, tip,
}: {
  label: string
  value: string
  sub?: string
  color?: string
  dim?: boolean
  tip?: string
}) {
  return (
    <div
      className="rounded-lg p-3 overflow-hidden"
      style={{
        background: dim ? 'var(--surf2)' : 'var(--surface)',
        border: '1px solid var(--line)',
        opacity: dim ? 0.7 : 1,
      }}
    >
      <div
        className="text-[10px] font-semibold tracking-wider uppercase mb-1.5 leading-tight flex items-center gap-1"
        style={{ color: 'var(--ink3)' }}
      >
        {tip ? <Tip text={tip}><span>{label}</span></Tip> : label}
        {tip && (
          <span style={{ fontSize: 10, opacity: 0.5, lineHeight: 1 }}>ⓘ</span>
        )}
      </div>
      <div
        className="text-[18px] font-bold leading-none tracking-tight"
        style={{ color: color || 'var(--ink)' }}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[10px]" style={{ color: 'var(--ink3)' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

// ─── KPI inferior row ─────────────────────────────────────────────────────────

function KpiRow({ label, value, color, tip }: { label: string; value: string; color?: string; tip?: string }) {
  return (
    <div
      className="flex items-center justify-between py-1.5 px-3"
      style={{ borderBottom: '0.5px solid var(--line)' }}
    >
      <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--ink3)' }}>
        {tip ? <Tip text={tip}><span>{label}</span></Tip> : label}
        {tip && <span style={{ fontSize: 9, opacity: 0.45 }}>ⓘ</span>}
      </span>
      <span className="text-[11px] font-semibold" style={{ color: color || 'var(--ink)' }}>{value}</span>
    </div>
  )
}

// ─── Referência da linha para o modal de conferência ─────────────────────────
/**
 * Traduz a linha clicada num `LinhaRef` — a estrutura fechada que
 * lib/aggregations/dre já define e que os DOIS caminhos consomem:
 *
 *   OFF → `aggDetalheDRE(..., ref, ...)`, que chama `matcherFromLinhaRef`
 *   ON  → `serializeLinhaRef(ref)` vira `linhaId` na query, e o servidor
 *         reconstrói o MESMO predicado com `parseLinhaId` + `matcherFromLinhaRef`
 *
 * Antes esta função devolvia o matcher já resolvido, e por isso o detalhe só
 * existia no browser: função não atravessa HTTP. Devolver a REFERÊNCIA em vez
 * do predicado é o que permite a mesma linha clicada valer nos dois lados.
 *
 * Antes disso, ela ainda carregava sua própria cópia da tabela de subtotais,
 * com os limites 2.99 / 3.99 / 4.99 / 5.99 / 6.99 repetidos, e um comentário
 * pedindo para "mudar nos dois lugares". Não deu certo: Lucro Líquido ficou
 * como `() => true` enquanto a célula usava `groupSum(col, 99)`, e clicar na
 * linha listava o grupo 'Outros' inteiro — R$ 792.066,84 a mais em 2026. Hoje
 * existe uma regra só (`grupoDentroDoLimite`), e nenhuma cópia aqui.
 */
function linhaRefForRow(row: DRERow): LinhaRef | null {
  switch (row.kind) {
    case 'l1':
      return row.l1Key ? { kind: 'l1', l1: row.l1Key } : null
    case 'l2':
      return row.l1Key && row.l2Key
        ? { kind: 'l2', l1: row.l1Key, l2: row.l2Key }
        : null
    case 'l3':
      return row.label ? { kind: 'l3', cat1: row.label } : null
    case 'subtotal':
    case 'ebitda':
    case 'resultado':
      // Id fora da allowlist não vira ref: `serializeLinhaRef` devolve null e
      // `matcherFromLinhaRef` devolveria `() => false`. Mesmo default de antes.
      return { kind: 'subtotal', id: row.id }
    default:
      return null
  }
}

/**
 * 'YYYY-MM-DD' → 'DD/MM/YYYY'.
 *
 * O detalhe trafega data como STRING estável nos dois caminhos da flag —
 * `aggDetalheDRE` normaliza pelos componentes locais no browser e o Postgres
 * já devolve nesse formato no servidor. Formatar a string aqui, em vez de
 * reconstruir um `Date` só para chamar `fDt`, tira o fuso da equação: não
 * existe hora, então não existe deslocamento de dia.
 */
function fDtYmd(s: string | null | undefined): string {
  if (!s || s.length < 10) return '—'
  const [y, mo, d] = s.split('-')
  return `${d}/${mo}/${y}`
}

// "2026-06" → "Junho/2026"
const MES_NOME = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
function periodoLabel(mes: string | undefined, dateFrom?: string, dateTo?: string): string {
  if (mes && mes.length >= 7) {
    const [y, m] = mes.split('-').map(Number)
    return `${MES_NOME[m - 1]}/${y}`
  }
  if (dateFrom && dateTo) return `${fDtYmd(dateFrom)} → ${fDtYmd(dateTo)}`
  return '—'
}

/**
 * Placeholder enquanto a resposta agregada não chegou. `totalOperacional: 0`
 * faz a tela cair no estado vazio, que é o mesmo que ela mostra quando o
 * período realmente não tem lançamento — transitório, e o `keepPreviousData`
 * do SWR evita que reapareça a cada troca de filtro.
 */
const RESUMO_VAZIO: ResumoDRE = {
  months: [],
  hier: [],
  subtotais: {
    recBruta: [], recLiq: [], lucroBruto: [], margContrib: [],
    ebitda: [], ebit: [], ebt: [], lucroLiq: [],
  },
  exec: {
    recOp: 0, recFin: 0, recBruta: 0, recLiq: 0, lubruto: 0,
    margContrib: 0, ebitda: 0, ebit: 0, lucroLiq: 0, growthRate: null,
  },
  kpis: {
    recOp: 0, recLiq: 0, lubruto: 0, margContrib: 0, ebitda: 0, ebit: 0,
    lucroLiq: 0, deducoes: 0, csp: 0, terceiros: 0, despCom: 0, despAdmin: 0,
    despGerais: 0, gastosPessoas: 0, despAquisicao: 0, leadBroker: 0,
    despExpansao: 0, proLabore: 0, growthRate: null,
  },
  totalOperacional: 0,
}

/** Mesmo papel do RESUMO_VAZIO, para o detalhe: Sheet aberto e resposta a caminho. */
const DETALHE_VAZIO: DetalheDREResp = {
  titulo: '', total: 0, dadosProtegidos: false, rows: [],
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DRE({ data, filters }: { data: Lancamento[]; filters?: Filters }) {
  const aggOn = isAggClientEnabled()
  const regime = filters?.regime ?? 'competencia'

  // ── Os dois caminhos da flag chamam a MESMA função ────────────────────────
  // `aggResumoDRE` concentra filtraOperacional, a matriz mês×categoria, a
  // hierarquia ordenada, os oito subtotais, os KPIs executivos e os inferiores.
  // Com a flag ON ela roda no servidor; com OFF, aqui no browser sobre o array
  // que o DashboardLayout já passa por prop. Uma implementação só.
  const aggUrl = useMemo(
    () => (aggOn && filters ? `/api/agg/dre?${buildAggQuery(filters)}` : null),
    [aggOn, filters],
  )
  const { data: aggResp } = useSWR<ResumoDRE>(aggUrl, aggFetcher, { keepPreviousData: true })

  const local = useMemo(
    () => (aggOn ? null : aggResumoDRE(data, regime)),
    [aggOn, data, regime],
  )

  const resumo: ResumoDRE = aggOn ? (aggResp ?? RESUMO_VAZIO) : local!

  const { months, hier, subtotais, exec, kpis } = resumo
  const cols = useMemo(() => [...months, '__acc__'], [months])
  const recLiqVals = subtotais.recLiq

  // Collapse state — set de EXPANDIDOS (vazio = tudo fechado por padrão)
  const [exp1, setExp1] = useState<Set<string>>(new Set())
  const [exp2, setExp2] = useState<Set<string>>(new Set())
  const toggleL1 = (l1: string) =>
    setExp1(prev => { const n = new Set(prev); n.has(l1) ? n.delete(l1) : n.add(l1); return n })
  const toggleL2 = (l2: string) =>
    setExp2(prev => { const n = new Set(prev); n.has(l2) ? n.delete(l2) : n.add(l2); return n })

  // Modal de conferência por linha. Guarda a REFERÊNCIA da linha, não o
  // predicado: é ela que serve aos dois caminhos da flag (ver linhaRefForRow).
  const [linhaSel, setLinhaSel] = useState<{
    label: string
    ref: LinhaRef
    kind: 'n3' | 'agrupador' | 'subtotal'
  } | null>(null)
  const [mesSel, setMesSel] = useState<string | undefined>(undefined)
  const [open, setOpen] = useState(false)

  // Proteção de folha no caminho legado, agora como DEFESA EM PROFUNDIDADE.
  // /api/financeiro já mascara na origem (lib/financeiro-query), então para
  // quem não tem a permissão `data` chega aqui sem nome nenhum e este passo é
  // no-op. Fica porque é barato e porque cobre qualquer fonte futura que
  // esqueça de proteger — mascarar o que já está mascarado não muda nada.
  const { verFolhaDetalhe } = useAccess()

  // ── DETALHE: só ao abrir o Sheet ─────────────────────────────────────────
  // Com a flag ON a requisição só existe quando há linha selecionada E o Sheet
  // está aberto — nada é buscado antecipadamente, fechar não dispara nada, e
  // trocar de linha ou de mês muda a chave e refaz a busca.
  //
  // Este componente NÃO pode montar o detalhe a partir da prop `data`: com a
  // flag ON o DashboardLayout não busca mais /api/financeiro fora da aba
  // Qualidade, então `data` chega vazio. Era exatamente esse o bug — o Sheet
  // abria com 0 lançamentos e nenhuma requisição saía.
  const linhaId = useMemo(
    () => (linhaSel ? serializeLinhaRef(linhaSel.ref) : null),
    [linhaSel],
  )

  const urlDetalhe = useMemo(() => {
    if (!aggOn || !filters || !linhaId || !open) return null
    const extra: Record<string, string> = { linhaId }
    if (mesSel) extra.mes = mesSel
    return `/api/agg/dre/detalhe?${buildAggQuery(filters, extra)}`
  }, [aggOn, filters, linhaId, mesSel, open])

  const { data: detalheAgg, error: erroDetalhe } =
    useSWR<DetalheDREResp>(urlDetalhe, aggFetcher, { keepPreviousData: false })

  const detalheLocal = useMemo(
    () => (aggOn || !linhaSel
      ? null
      // A MESMA função que o endpoint executa. `verFolhaDetalhe` espelha a
      // regra do servidor (admin sempre vê); e como /api/financeiro já mascara
      // na origem, para quem não tem a permissão isto é no-op.
      : aggDetalheDRE(data, regime, linhaSel.ref, mesSel, linhaSel.label, verFolhaDetalhe)),
    [aggOn, linhaSel, data, regime, mesSel, verFolhaDetalhe],
  )

  const detalhe: DetalheDREResp = aggOn
    ? (detalheAgg ?? DETALHE_VAZIO)
    : (detalheLocal ?? DETALHE_VAZIO)

  const carregandoDetalhe = aggOn && !!linhaId && open && !detalheAgg && !erroDetalhe

  const kindModal = (rowKind: DRERow['kind']): 'n3' | 'agrupador' | 'subtotal' => {
    if (rowKind === 'l3') return 'n3'
    if (rowKind === 'l1' || rowKind === 'l2') return 'agrupador'
    return 'subtotal'
  }

  const selecionar = (row: DRERow, mes?: string) => {
    // TODO gate: se !admin && !temAcesso('lancamentos') → mensagem "sem permissão, contate o admin"
    const ref = linhaRefForRow(row)
    if (!ref) return
    setLinhaSel({ label: row.label, ref, kind: kindModal(row.kind) })
    setMesSel(mes)
    setOpen(true)
  }

  const abrirPeriodo = (row: DRERow) => selecionar(row)
  const abrirMes = (row: DRERow, mes: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    selecionar(row, mes)
  }

  // ── Build dreRows ──────────────────────────────────────────────────────────
  // Monta as linhas visíveis a partir da árvore JÁ VALORIZADA que veio da
  // agregação, intercalando os subtotais nas transições de grupo. Nenhum
  // cálculo financeiro acontece aqui: `vals` já vem pronto de aggResumoDRE.
  //
  // O estado de colapso mora só aqui, de propósito. O payload traz valor para
  // todo nó, então abrir e fechar um grupo não refaz requisição nem muda nada
  // no servidor.
  const dreRows = useMemo(() => {
    const rows: DRERow[] = []

    for (let i = 0; i < hier.length; i++) {
      const { l1, vals: l1Vals, children: l2s } = hier[i]
      const prefix  = numPrefix(l1)
      const nextPfx = i + 1 < hier.length ? numPrefix(hier[i + 1].l1) : Infinity

      rows.push({ id: `l1::${l1}`, kind: 'l1', label: l1, l1Key: l1, vals: l1Vals })

      if (exp1.has(l1)) {
        for (const { l2, label, vals: l2Vals, children: l3s } of l2s) {
          rows.push({ id: `l2::${l2}`, kind: 'l2', label, l1Key: l1, l2Key: l2, vals: l2Vals })
          if (exp2.has(l2)) {
            for (const n3 of l3s) {
              rows.push({
                id: `l3::${l1}::${l2}::${n3.l3}`, kind: 'l3', label: n3.l3,
                l1Key: l1, l2Key: l2, vals: n3.vals,
              })
            }
          }
          // Margem de Contribuição logo após 4.1
          if (l1 === '4 — Despesas' && l2 === '4.1') {
            rows.push({
              id: '__margContrib__', kind: 'subtotal',
              label: '(=) Margem de Contribuição',
              vals: subtotais.margContrib,
              tip: 'Lucro Bruto + Despesas Comerciais (4.1)\n\nMede quanto sobra para cobrir os custos fixos após pagar os custos operacionais e as despesas variáveis comerciais.\n\nFórmula: Lucro Bruto + Σ 4.1',
            })
          }
        }
      }

      // Subtotais nas transições de grupo
      if (prefix <= 2 && nextPfx > 2)
        rows.push({ id: '__recLiq__',   kind: 'subtotal',  label: '(=) Receita Operacional Líquida', vals: subtotais.recLiq,
          tip: 'Receita Operacional (grupo 1) + Deduções (grupo 2)\n\nGrupo 2 inclui impostos s/ faturamento (PIS, COFINS, ISS…), tarifas de recebimento (boleto, PIX, cartão) e royalties. Esses valores são negativos, então reduzem a receita bruta.\n\nFórmula: Σ grupos 1 + 2' })
      if (prefix <= 3 && nextPfx > 3)
        rows.push({ id: '__lubruto__',  kind: 'subtotal',  label: '(=) Lucro Bruto - R$',            vals: subtotais.lucroBruto,
          tip: 'Receita Operacional Líquida − Custos Operacionais (grupo 3)\n\nGrupo 3: mão de obra CSP (3.1), ISAAS (3.2) e serviços terceirizados (3.3).\n\nFórmula: Σ grupos 1 + 2 + 3' })
      if (prefix <= 4 && nextPfx > 4)
        rows.push({ id: '__ebitda__',   kind: 'ebitda',    label: '(=) EBITDA',                      vals: subtotais.ebitda,
          tip: 'Lucro Bruto − Todas as Despesas (grupos 4.1 + 4.2 + 4.3)\n\n4.1 Comerciais · 4.2 Administrativas · 4.3 Gerais\n\nAntes de depreciação, resultado financeiro e impostos sobre lucro.\n\nFórmula: Σ grupos 1 + 2 + 3 + 4' })
      if (prefix <= 5 && nextPfx > 5)
        rows.push({ id: '__ebit__',     kind: 'subtotal',  label: '(=) Lucro Operacional (EBIT)',     vals: subtotais.ebit,
          tip: 'EBITDA − Depreciações e Amortizações (grupo 5)\n\n5.1 Depreciação (reformas, equipamentos, mobiliário, imóveis)\n5.2 Amortização (software, carteira de clientes)\n\nFórmula: Σ grupos 1 + 2 + 3 + 4 + 5' })
      if (prefix < 7 && nextPfx >= 7)
        rows.push({ id: '__ebt__',      kind: 'subtotal',  label: '(=) EBT — Lucro Antes do IR e CS', vals: subtotais.ebt,
          tip: 'EBIT + Resultado Financeiro (grupo 6)\n\n6.1 Receitas financeiras (rendimentos, dividendos, câmbio)\n6.2 Despesas financeiras (juros, tarifas bancárias, inadimplência)\n\nFórmula: Σ grupos 1 + 2 + 3 + 4 + 5 + 6' })
      if (i === hier.length - 1)
        rows.push({ id: '__lucroliq__', kind: 'resultado', label: '(=) Lucro Líquido - R$',           vals: subtotais.lucroLiq,
          tip: 'EBT − Impostos sobre o Lucro (grupo 7)\n\n7.1 CSLL · 7.2 IRPJ\n\nResultado final após todos os custos, despesas e impostos.\n\nFórmula: Σ todos os grupos (1 a 7)' })
    }

    return rows
  }, [hier, subtotais, exp1, exp2])

  // ── Render ────────────────────────────────────────────────────────────────

  if (resumo.totalOperacional === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: 'var(--ink3)', fontSize: 12 }}>
        Nenhum lançamento quitado no período selecionado.
      </div>
    )
  }

  const { recBruta, recFin, recOp, recLiq, lubruto, margContrib, ebitda, lucroLiq, growthRate } = exec
  const pctColor = (v: number) => v >= 0 ? '#1D9E75' : '#E24B4A'

  return (
    <div className="space-y-4">

      {/* ── Executive KPI Cards ──────────────────────────────────────────── */}
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
        <ExecCard
          label="Receita Bruta"
          value={fR(recBruta)}
          sub={recFin > 0 ? `${fR(recFin)} financeira` : undefined}
          color="var(--green)"
          tip={'Receita total faturada antes das deduções.\n\nFórmula: Receita Operacional (grupo 1) + Receita Financeira (6.1)\n\nDiferença vs Receita Operacional: inclui rendimentos de aplicações, dividendos e outras receitas não operacionais.'}
        />
        <ExecCard
          label="Receita Operacional"
          value={fR(recOp)}
          color="var(--green)"
          tip={'Soma de todas as receitas operacionais (grupo 1)\n\n1.1 Aquisição · 1.2 Renovação · 1.3 Expansão · 1.4 Variáveis\n\nFórmula: Σ grupo 1'}
        />
        <ExecCard
          label="Receita Líquida"
          value={fR(recLiq)}
          sub={fPct(recLiq, recOp) + ' da bruta'}
          color="var(--green)"
          tip={'Receita Operacional − Deduções (grupo 2)\n\nGrupo 2: impostos s/ faturamento (PIS, COFINS, ISS…), tarifas de recebimento e royalties.\n\nFórmula: Σ grupos 1 + 2'}
        />
        <ExecCard
          label="Lucro Bruto"
          value={fR(lubruto)}
          sub={fPctAbs(lubruto, recLiq) + ' margem'}
          color={lubruto >= 0 ? 'var(--green)' : 'var(--red)'}
          tip={'Receita Líquida − Custos Operacionais (grupo 3)\n\nGrupo 3: mão de obra CSP (3.1), ISAAS (3.2) e terceirizados (3.3).\n\nFórmula: Σ grupos 1 + 2 + 3'}
        />
        <ExecCard
          label="Margem Bruta %"
          value={fPct(lubruto, recLiq)}
          color={pctColor(lubruto)}
          tip={'Lucro Bruto ÷ Receita Líquida × 100\n\nIndicador de eficiência da operação principal, antes das despesas fixas.'}
        />
        <ExecCard
          label="Margem de Contribuição"
          value={fR(margContrib)}
          sub={fPct(margContrib, recLiq)}
          color={margContrib >= 0 ? 'var(--green)' : 'var(--red)'}
          tip={'Lucro Bruto + Despesas Comerciais (4.1)\n\nComo as despesas são negativas, a soma as desconta do Lucro Bruto. Mede quanto sobra para cobrir os custos fixos.\n\nFórmula: Σ grupos 1 + 2 + 3 + 4.1'}
        />
        <ExecCard
          label="EBITDA"
          value={fR(ebitda)}
          sub={fPct(ebitda, recLiq)}
          color={ebitda >= 0 ? '#92400e' : '#E24B4A'}
          tip={'Lucro Bruto − Todas as Despesas (grupos 4.1 + 4.2 + 4.3)\n\nAntes de depreciação/amortização, resultado financeiro e impostos sobre lucro. Proxy do caixa operacional.\n\nFórmula: Σ grupos 1 + 2 + 3 + 4'}
        />
        <ExecCard
          label="Lucro Líquido"
          value={fR(lucroLiq)}
          sub={fPct(lucroLiq, recLiq)}
          color={lucroLiq >= 0 ? 'var(--green)' : 'var(--red)'}
          tip={'EBT − Impostos sobre Lucro (CSLL + IRPJ, grupo 7)\n\nResultado final após todos os custos, despesas, depreciações, resultado financeiro e impostos.\n\nFórmula: Σ todos os grupos (1 a 7)'}
        />
        <ExecCard
          label="Growth Rate"
          value={growthRate !== null
            ? (growthRate >= 0 ? '+' : '') + (growthRate * 100).toFixed(1).replace('.', ',') + '%'
            : '—'}
          sub={months.length >= 2
            ? `${mLbl(months[months.length - 2])} → ${mLbl(months[months.length - 1])}`
            : 'Selecione ≥ 2 meses'}
          color={growthRate === null ? 'var(--ink3)' : pctColor(growthRate)}
          tip={'( Receita Líquida mês atual − Receita Líquida mês anterior ) ÷ |Receita Líquida mês anterior|\n\nCompara os dois últimos meses visíveis no filtro de período. Selecione ≥ 2 meses para ver o valor.'}
        />
      </div>

      {/* ── DRE Table ────────────────────────────────────────────────────── */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              borderCollapse: 'collapse',
              fontSize: 11,
              minWidth: Math.max(800, 300 + months.length * 180),
              width: '100%',
            }}
          >
            <thead>
              <tr style={{ background: 'var(--surf2)' }}>
                <th
                  rowSpan={2}
                  style={{
                    position: 'sticky', left: 0, zIndex: 3,
                    background: 'var(--surf2)',
                    padding: '10px 16px',
                    textAlign: 'left',
                    fontSize: 11, fontWeight: 600, color: 'var(--ink3)',
                    minWidth: 280, whiteSpace: 'nowrap',
                    borderRight: '2px solid var(--line)',
                    borderBottom: '1px solid var(--line)',
                  }}
                >
                  Descrição
                </th>
                {cols.map((col, ci) => {
                  const isAcc = ci === cols.length - 1
                  return (
                    <th
                      key={col}
                      colSpan={2}
                      style={{
                        padding: '8px 10px',
                        textAlign: 'center',
                        fontSize: 11, fontWeight: 700,
                        whiteSpace: 'nowrap',
                        borderLeft: '1px solid var(--line)',
                        borderBottom: '1px solid var(--line)',
                        background: isAcc ? '#dcfce7' : 'var(--surf2)',
                        color: isAcc ? '#166534' : 'var(--ink)',
                      }}
                    >
                      {isAcc ? 'Acumulado' : mLbl(col)}
                    </th>
                  )
                })}
              </tr>
              <tr style={{ background: 'var(--surf2)', borderBottom: '2px solid var(--line2)' }}>
                {cols.flatMap((col, ci) => {
                  const isAcc = ci === cols.length - 1
                  const bg    = isAcc ? '#bbf7d0' : 'var(--surf2)'
                  const fg    = isAcc ? '#166534' : 'var(--ink3)'
                  const base: React.CSSProperties = {
                    padding: '5px 8px', fontSize: 10, fontWeight: 600,
                    color: fg, background: bg, whiteSpace: 'nowrap',
                  }
                  return [
                    <th key={`${col}-r`} style={{ ...base, textAlign: 'right', borderLeft: '1px solid var(--line)' }}>R$</th>,
                    <th key={`${col}-p`} style={{ ...base, textAlign: 'right' }} title="% da Receita Líquida">% R.Líq.</th>,
                  ]
                })}
              </tr>
            </thead>

            <tbody>
              {dreRows.map(row => {
                const s    = ROW_STYLE[row.kind]
                const ind  = INDENT[row.kind]
                const canT = row.kind === 'l1' || row.kind === 'l2'
                const isExpanded =
                  row.kind === 'l1' ? exp1.has(row.l1Key!) :
                  row.kind === 'l2' ? exp2.has(row.l2Key!) : false
                const arrow = canT ? (isExpanded ? '▾ ' : '▸ ') : ''

                return (
                  <tr
                    key={row.id}
                    style={{
                      background: s.bg,
                      borderBottom: '1px solid var(--line)',
                      borderTop: (row.kind === 'subtotal' || row.kind === 'ebitda' || row.kind === 'resultado')
                        ? '2px solid var(--line2)' : undefined,
                    }}
                  >
                    <td
                      onClick={canT ? () => {
                        if (row.kind === 'l1') toggleL1(row.l1Key!)
                        else if (row.kind === 'l2') toggleL2(row.l2Key!)
                      } : undefined}
                      style={{
                        position: 'sticky', left: 0, zIndex: 2,
                        background: s.bg,
                        color: s.fg,
                        fontWeight: s.fw,
                        fontSize: s.fs,
                        padding: `${s.py}px 16px ${s.py}px ${ind}px`,
                        cursor: canT ? 'pointer' : 'default',
                        whiteSpace: 'nowrap',
                        borderRight: '2px solid var(--line)',
                        userSelect: 'none',
                      }}
                    >
                      {arrow}
                      {row.tip
                        ? <Tip text={row.tip}><span>{row.label}</span></Tip>
                        : row.label}
                      {row.tip && <span style={{ fontSize: 9, opacity: 0.45, marginLeft: 4 }}>ⓘ</span>}
                    </td>

                    {cols.flatMap((col, ci) => {
                      const isAcc = ci === cols.length - 1
                      const val   = row.vals[ci]
                      const bg    = isAcc && accumBg(row.kind) ? accumBg(row.kind) : s.bg
                      const fg    = isAcc && accumFg(row.kind) ? accumFg(row.kind) : valColor(val, row.kind)
                      const pctFg = row.kind === 'ebitda' || row.kind === 'resultado'
                        ? 'rgba(0,0,0,0.45)' : 'var(--ink3)'

                      const cellOnClick = isAcc ? (() => abrirPeriodo(row)) : abrirMes(row, col)
                      return [
                        <td
                          key={`${row.id}-${col}-r`}
                          onClick={cellOnClick}
                          style={{
                            padding: `${s.py}px 8px`,
                            textAlign: 'right',
                            fontWeight: row.kind === 'l3' ? 400 : s.fw,
                            fontSize: s.fs,
                            color: fg,
                            background: bg,
                            borderLeft: '1px solid var(--line)',
                            whiteSpace: 'nowrap',
                            cursor: 'pointer',
                          }}
                        >
                          {fR(val)}
                        </td>,
                        <td
                          key={`${row.id}-${col}-p`}
                          onClick={cellOnClick}
                          style={{
                            padding: `${s.py}px 8px`,
                            textAlign: 'right',
                            fontWeight: 400,
                            fontSize: 10,
                            color: pctFg,
                            background: bg,
                            whiteSpace: 'nowrap',
                            cursor: 'pointer',
                          }}
                        >
                          {fPct(val, recLiqVals[ci])}
                        </td>,
                      ]
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── KPIs Inferiores ──────────────────────────────────────────────── */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        <div
          className="px-3 py-2"
          style={{
            borderBottom: '1px solid var(--line)',
            background: 'var(--surf2)',
            fontSize: 11, fontWeight: 700, color: 'var(--ink3)',
            letterSpacing: '0.04em', textTransform: 'uppercase',
          }}
        >
          KPIs do Período
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
          {/* Col 1 — Valores R$ */}
          <div style={{ borderRight: '1px solid var(--line)' }}>
            <div className="px-3 py-1.5" style={{ background: 'var(--surf2)', borderBottom: '1px solid var(--line)', fontSize: 10, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase' }}>
              Valores (R$)
            </div>
            <KpiRow label="$ Despesas Variáveis"       value={fR(kpis.despCom)}       color={kpis.despCom >= 0 ? 'var(--green)' : 'var(--red)'}
              tip={'Soma das Despesas Totais Comerciais (grupo 4.1)\n\nItens que variam conforme volume de vendas: comissões, brokers, marketing, eventos de aquisição.\n\nFórmula: Σ 4.1'} />
            <KpiRow label="$ Gastos Totais c/ Pessoas"  value={fR(kpis.gastosPessoas)} color={kpis.gastosPessoas >= 0 ? 'var(--green)' : 'var(--red)'}
              tip={'3.1 Mão de Obra CSP\n+ 3.2 ISAAS\n+ 4.1.01 a 4.1.05 e 4.1.23 (remunerações e encargos comerciais)\n+ 4.2.01 a 4.2.09 (remunerações e encargos adm.)\n+ 4.2.25 Pró-Labore + 4.2.26 INSS s/ Pró-Labore\n\nTotal investido em pessoas na empresa.'} />
          </div>

          {/* Col 2 — Margens */}
          <div style={{ borderRight: '1px solid var(--line)' }}>
            <div className="px-3 py-1.5" style={{ background: 'var(--surf2)', borderBottom: '1px solid var(--line)', fontSize: 10, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase' }}>
              Margens (% Rec. Líq.)
            </div>
            <KpiRow label="% Deduções"                value={fPctAbs(kpis.deducoes, kpis.recOp)}     color="var(--red)"
              tip={'|Deduções (grupo 2)| ÷ Receita Operacional × 100\n\nPeso dos impostos, tarifas e royalties sobre a receita bruta.\n\nFórmula: |Σ grupo 2| ÷ Σ grupo 1'} />
            <KpiRow label="% Receita Líquida"         value={fPct(kpis.recLiq, kpis.recOp)}          color={pctColor(kpis.recLiq)}
              tip={'Receita Líquida ÷ Receita Operacional × 100\n\nQuanto da receita bruta sobra após todas as deduções.\n\nFórmula: (Σ grupos 1+2) ÷ Σ grupo 1'} />
            <KpiRow label="% Margem Bruta"            value={fPct(kpis.lubruto, kpis.recLiq)}        color={pctColor(kpis.lubruto)}
              tip={'Lucro Bruto ÷ Receita Líquida × 100\n\nEficiência da operação principal antes das despesas fixas.\n\nFórmula: (Σ grupos 1+2+3) ÷ Rec. Líquida'} />
            <KpiRow label="% Margem de Contribuição"  value={fPct(kpis.margContrib, kpis.recLiq)}    color={pctColor(kpis.margContrib)}
              tip={'Margem de Contribuição ÷ Receita Líquida × 100\n\nCapacidade de cobertura dos custos fixos.\n\nFórmula: (Lucro Bruto + 4.1) ÷ Rec. Líquida'} />
            <KpiRow label="% EBITDA"                  value={fPct(kpis.ebitda, kpis.recLiq)}         color={pctColor(kpis.ebitda)}
              tip={'EBITDA ÷ Receita Líquida × 100\n\nProxy de eficiência operacional antes de itens não caixa.\n\nFórmula: (Σ grupos 1 a 4) ÷ Rec. Líquida'} />
            <KpiRow label="% Lucro Operacional (EBIT)" value={fPct(kpis.ebit, kpis.recLiq)}          color={pctColor(kpis.ebit)}
              tip={'EBIT ÷ Receita Líquida × 100\n\nResultado operacional após depreciar os ativos.\n\nFórmula: (Σ grupos 1 a 5) ÷ Rec. Líquida'} />
            <KpiRow label="% Lucro Líquido"           value={fPct(kpis.lucroLiq, kpis.recLiq)}       color={pctColor(kpis.lucroLiq)}
              tip={'Lucro Líquido ÷ Receita Líquida × 100\n\nQuanto de cada R$ de receita vira lucro real.\n\nFórmula: (Σ grupos 1 a 7) ÷ Rec. Líquida'} />
            <KpiRow label="% Growth Rate"
              value={kpis.growthRate !== null
                ? (kpis.growthRate >= 0 ? '+' : '') + (kpis.growthRate * 100).toFixed(1).replace('.', ',') + '%'
                : '—'}
              color={kpis.growthRate === null ? 'var(--ink3)' : pctColor(kpis.growthRate)}
              tip={'( Rec. Líquida mês atual − Rec. Líquida mês anterior ) ÷ |Rec. Líquida mês anterior| × 100\n\nCompara os dois últimos meses visíveis no filtro.'} />
          </div>

          {/* Col 3 — Custos */}
          <div style={{ borderRight: '1px solid var(--line)' }}>
            <div className="px-3 py-1.5" style={{ background: 'var(--surf2)', borderBottom: '1px solid var(--line)', fontSize: 10, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase' }}>
              Custos (% Rec. Líq.)
            </div>
            <KpiRow label="% CSP (atividade principal)"  value={fPctAbs(kpis.csp, kpis.recLiq)}          color="var(--red)"
              tip={'|Custos Operacionais (grupo 3)| ÷ Receita Líquida × 100\n\nGrupo 3: mão de obra CSP (3.1) + ISAAS (3.2) + terceirizados (3.3).\n\nFórmula: |Σ grupo 3| ÷ Rec. Líquida'} />
            <KpiRow label="% Terceirizados (CSP)"        value={fPctAbs(kpis.terceiros, kpis.recLiq)}      color="var(--red)"
              tip={'|3.3 Serviços Terceirizados| ÷ Receita Líquida × 100\n\nCSP terceirizados: account, GT, design e copy para cada produto.\n\nFórmula: |Σ 3.3| ÷ Rec. Líquida'} />
            <KpiRow label="% Despesas Comerciais"        value={fPctAbs(kpis.despCom, kpis.recLiq)}        color="var(--red)"
              tip={'|4.1 Despesas Comerciais| ÷ Receita Líquida × 100\n\nTodas as despesas do grupo 4.1 (23 itens).\n\nFórmula: |Σ 4.1| ÷ Rec. Líquida'} />
            <KpiRow label="% Desp. Totais Aquisição"     value={fPctAbs(kpis.despAquisicao, kpis.recLiq)}  color="var(--red)"
              tip={'Soma de 4.1.02, 4.1.04, 4.1.06 a 4.1.08, 4.1.10 a 4.1.17\n÷ Receita Líquida × 100\n\nInvestimentos diretos em aquisição: remuneração comercial, brokers, CAC, eventos, marketing.\n\nFórmula: |Σ itens acima| ÷ Rec. Líquida'} />
            <KpiRow label="% Lead Broker"                value={fPctAbs(kpis.leadBroker, kpis.recLiq)}     color="var(--red)"
              tip={'4.1.06 Lead Broker ÷ Receita Líquida × 100\n\nCusto específico de geração de leads via broker externo.'} />
            <KpiRow label="% Desp. Totais Expansão"      value={fPctAbs(kpis.despExpansao, kpis.recLiq)}   color="var(--red)"
              tip={'Soma de 4.1.18 a 4.1.23 ÷ Receita Líquida × 100\n\nEventos renov./expansão, visitas, brindes, comissão renovação e Líder de Expansão (CSM).\n\nFórmula: |Σ 4.1.18-23| ÷ Rec. Líquida'} />
          </div>

          {/* Col 4 — G&A */}
          <div>
            <div className="px-3 py-1.5" style={{ background: 'var(--surf2)', borderBottom: '1px solid var(--line)', fontSize: 10, fontWeight: 700, color: 'var(--ink3)', textTransform: 'uppercase' }}>
              G&A (% Rec. Líq.)
            </div>
            <KpiRow label="% Despesas Administrativas"  value={fPctAbs(kpis.despAdmin, kpis.recLiq)}             color="var(--red)"
              tip={'|4.2 Despesas Adm.| ÷ Receita Líquida × 100\n\nGrupo 4.2: remunerações, encargos, software, contabilidade, jurídico, benefícios, pró-labore e demais (27 itens).\n\nFórmula: |Σ 4.2| ÷ Rec. Líquida'} />
            <KpiRow label="% Despesas Gerais"           value={fPctAbs(kpis.despGerais, kpis.recLiq)}            color="var(--red)"
              tip={'|4.3 Despesas Gerais| ÷ Receita Líquida × 100\n\nGrupo 4.3: telefone, energia, aluguel, IPTU, materiais, limpeza, segurança e seguros (10 itens).\n\nFórmula: |Σ 4.3| ÷ Rec. Líquida'} />
            <KpiRow label="% G&A (Admin + Gerais)"
              value={fPctAbs(kpis.despAdmin + kpis.despGerais, kpis.recLiq)}
              color="var(--red)"
              tip={'|(4.2 + 4.3)| ÷ Receita Líquida × 100\n\nTotal das despesas de suporte à operação (back-office).\n\nFórmula: |Σ 4.2 + Σ 4.3| ÷ Rec. Líquida'} />
            <KpiRow label="% Pró-labore"                 value={fPctAbs(kpis.proLabore, kpis.recLiq)}             color="var(--red)"
              tip={'|(4.2.25 + 4.2.26)| ÷ Receita Líquida × 100\n\n4.2.25 Pró-Labore dos sócios\n4.2.26 INSS s/ pró-labore\n\nFórmula: |Σ 4.2.25 + 4.2.26| ÷ Rec. Líquida'} />
          </div>
        </div>
      </div>

      <DRESheet
        open={open}
        onOpenChange={setOpen}
        linhaSel={linhaSel}
        linhas={detalhe.rows}
        dadosProtegidos={detalhe.dadosProtegidos}
        carregando={carregandoDetalhe}
        erro={erroDetalhe}
        periodo={periodoLabel(mesSel, filters?.dateFrom, filters?.dateTo)}
      />

    </div>
  )
}

// ─── Sheet de conferência por linha ──────────────────────────────────────────

function DRESheet({
  open, onOpenChange, linhaSel, linhas, dadosProtegidos, carregando, erro, periodo,
}: {
  open: boolean
  onOpenChange: (b: boolean) => void
  linhaSel: { label: string; ref: LinhaRef; kind: 'n3' | 'agrupador' | 'subtotal' } | null
  linhas: DetalheRow[]
  /** Alguma linha teve contraparte/descrição mascaradas por falta de ver_folha_detalhe. */
  dadosProtegidos: boolean
  /** Só no caminho agregado: resposta a caminho. Com a flag OFF é sempre false. */
  carregando: boolean
  /** Só no caminho agregado: a requisição do detalhe falhou. */
  erro?: unknown
  periodo: string
}) {
  // Enquanto carrega (ou em erro) não dá para afirmar contagem, categoria nem
  // total: o array está vazio porque a resposta não chegou, não porque a linha
  // não tem lançamento. Mostrar "0 lançamentos · Total R$ 0,00" nesse instante
  // é exatamente o sintoma do bug que esta correção resolve — então esses
  // números só aparecem quando existem de verdade.
  const pendente = carregando || !!erro

  const hasReceita = linhas.some(l => l.tipo === 'Receita')
  const hasDespesa = linhas.some(l => l.tipo === 'Despesa')
  const isMixed = hasReceita && hasDespesa

  const totalRec = linhas.filter(l => l.tipo === 'Receita').reduce((s, l) => s + l.valor, 0)
  const totalDesp = linhas.filter(l => l.tipo === 'Despesa').reduce((s, l) => s + l.valor, 0)
  const totalLiq = totalRec + totalDesp

  const catCount = new Set(linhas.map(l => l.categoria)).size

  const badgeLabel = isMixed
    ? 'Receita + dedução'
    : hasReceita ? 'Receita' : hasDespesa ? 'Despesa' : '—'
  const badgeBg = isMixed
    ? 'var(--surf2)'
    : hasReceita ? 'var(--green-l, #e7f7ef)' : 'var(--red-l, #fde9ec)'
  const badgeFg = isMixed
    ? 'var(--ink3)'
    : hasReceita ? 'var(--green)' : 'var(--red)'

  const showCategoria = linhaSel?.kind !== 'n3'

  const fRSigned = (v: number) => (v > 0 ? '+' : '') + fR(v)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[60vw] sm:max-w-[60vw] overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <SheetTitle className="text-[14px]">{linhaSel?.label ?? ''}</SheetTitle>
            {!pendente && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none"
                style={{ background: badgeBg, color: badgeFg }}
              >
                {badgeLabel}
              </span>
            )}
          </div>
          <div className="mt-1 text-[11px]" style={{ color: 'var(--ink3)' }}>
            {periodo}
            {!pendente && (
              <>
                {' · '}{linhas.length} lançamento{linhas.length === 1 ? '' : 's'}
                {linhaSel && linhaSel.kind !== 'n3' && (
                  <> · {catCount} categoria{catCount === 1 ? '' : 's'}</>
                )}
              </>
            )}
          </div>
          {dadosProtegidos && !pendente && (
            <div className="mt-1 text-[11px]" style={{ color: 'var(--ink3)' }}>
              Alguns lançamentos estão com contraparte e descrição ocultas.
              Os valores e o total não foram alterados.
            </div>
          )}
          {!pendente && (
            <div className="mt-2 flex gap-4 text-[11px]" style={{ color: 'var(--ink3)' }}>
              {isMixed ? (
                <>
                  <span>Receita: <strong style={{ color: 'var(--green)' }}>{fRSigned(totalRec)}</strong></span>
                  <span>Despesa: <strong style={{ color: 'var(--red)' }}>{fRSigned(totalDesp)}</strong></span>
                  <span>Líquido: <strong style={{ color: totalLiq >= 0 ? 'var(--green)' : 'var(--red)' }}>{fRSigned(totalLiq)}</strong></span>
                </>
              ) : (
                <span>Total: <strong style={{ color: hasReceita ? 'var(--green)' : 'var(--red)' }}>{fRSigned(totalLiq)}</strong></span>
              )}
            </div>
          )}
        </SheetHeader>

        {/* Erro e carregamento vivem DENTRO do Sheet: a DRE já está renderizada
            e não depende desta chamada, então falhar aqui não derruba a tela.
            Só existe no caminho agregado — com a flag OFF o cálculo é síncrono
            e nenhuma requisição pode falhar. */}
        {erro ? (
          <div className="mt-6 text-[11px]" style={{ color: isForbidden(erro) ? 'var(--ink3)' : 'var(--red)' }}>
            {isForbidden(erro)
              ? 'Você não tem permissão para ver o detalhe desta linha.'
              : `Não foi possível carregar o detalhe: ${String(erro)}`}
          </div>
        ) : carregando ? (
          <div className="mt-6 text-[11px]" style={{ color: 'var(--ink3)' }}>Carregando lançamentos…</div>
        ) : (
        <div className="mt-4">
          <table className="w-full" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 84 }} />
              <col />
              <col style={{ width: '22%' }} />
              <col style={{ width: '18%' }} />
              {showCategoria && <col style={{ width: '20%' }} />}
              <col style={{ width: 130 }} />
            </colgroup>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                {/* TODO 1ª coluna "Código Lançamento" após expor o campo no SELECT da API + tipo Lancamento */}
                <th className="py-1.5 pl-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Data</th>
                <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Descrição</th>
                <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Fornecedor ou Cliente</th>
                <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>CC</th>
                {showCategoria && (
                  <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Categoria</th>
                )}
                <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--ink3)' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td className="py-2 pl-3 text-[11px] whitespace-nowrap" style={{ color: 'var(--ink3)' }}>{fDtYmd(l.data)}</td>
                  <td className="py-2 text-[11px]" style={{ color: 'var(--ink2)', overflow: 'hidden', textOverflow: 'ellipsis' }} title={l.desc}>{l.desc}</td>
                  <td className="py-2 text-[11px]" style={{ color: 'var(--ink2)', overflow: 'hidden', textOverflow: 'ellipsis' }} title={l.contraparte}>{l.contraparte}</td>
                  <td className="py-2 text-[11px]" style={{ color: 'var(--ink3)', overflow: 'hidden', textOverflow: 'ellipsis' }} title={l.cc}>{l.cc}</td>
                  {showCategoria && (
                    <td className="py-2 text-[11px]" style={{ color: 'var(--ink3)', overflow: 'hidden', textOverflow: 'ellipsis' }} title={l.categoria}>{l.categoria}</td>
                  )}
                  <td
                    className="py-2 pr-3 text-right text-[11px] font-semibold whitespace-nowrap"
                    style={{
                      color: l.tipo === 'Receita' ? 'var(--green)' : 'var(--red)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {fRSigned(l.valor)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--line)' }}>
                <td colSpan={showCategoria ? 5 : 4} className="py-2 pl-3 text-[11px] font-semibold" style={{ color: 'var(--ink3)' }}>
                  Total líquido
                </td>
                <td
                  className="py-2 pr-3 text-right text-[11px] font-bold whitespace-nowrap"
                  style={{
                    color: isMixed ? 'var(--ink)' : hasReceita ? 'var(--green)' : 'var(--red)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {fRSigned(totalLiq)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
