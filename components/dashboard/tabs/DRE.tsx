'use client'

import { useMemo, useState } from 'react'
import type { Lancamento, Filters } from '@/lib/types'
import { filtraOperacional } from '@/lib/financeiro/regime'
import { fR, getMonths, mLbl, parseCatHier, getL2Label } from '@/lib/utils'

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

// ─── Component ────────────────────────────────────────────────────────────────

export function DRE({ data, filters }: { data: Lancamento[]; filters?: Filters }) {
  const op = useMemo(
    () => filtraOperacional(data, filters?.regime ?? 'competencia'),
    [data, filters?.regime]
  )

  const months = useMemo(() => getMonths(op), [op])
  const cols   = useMemo(() => [...months, '__acc__'], [months])

  // month → l1 → l2 → l3 → signed value
  const vm = useMemo(() => {
    const r: Record<string, Record<string, Record<string, Record<string, number>>>> = {}
    for (const row of op) {
      if (!row.data) continue
      // Prioriza data_ym do backend (TZ-safe). Fallback: getFullYear/Month
      // do Date (já criado com parseDataLocal — também TZ-safe).
      const ym = row.data_ym ?? `${row.data.getFullYear()}-${String(row.data.getMonth() + 1).padStart(2, '0')}`
      const sign = row.tipo === 'Receita' ? 1 : -1
      const { l1, l2 } = parseCatHier(row.cat1)
      const l3 = row.cat1 || l2
      if (!r[ym])          r[ym]          = {}
      if (!r[ym][l1])      r[ym][l1]      = {}
      if (!r[ym][l1][l2])  r[ym][l1][l2]  = {}
      if (!r[ym][l1][l2][l3]) r[ym][l1][l2][l3] = 0
      r[ym][l1][l2][l3] += sign * row.valorDRE
    }
    return r
  }, [op])

  const hier = useMemo(() => {
    const l1m = new Map<string, Map<string, Set<string>>>()
    for (const row of op) {
      const { l1, l2 } = parseCatHier(row.cat1)
      const l3 = row.cat1 || l2
      if (!l1m.has(l1)) l1m.set(l1, new Map())
      if (!l1m.get(l1)!.has(l2)) l1m.get(l1)!.set(l2, new Set())
      l1m.get(l1)!.get(l2)!.add(l3)
    }
    return [...l1m.entries()]
      .sort(([a], [b]) => numPrefix(a) - numPrefix(b))
      .map(([l1, l2m]) => ({
        l1,
        children: [...l2m.entries()]
          .sort(([a], [b]) => numPrefix(a) - numPrefix(b))
          .map(([l2, l3s]) => ({
            l2,
            children: [...l3s].sort((a, b) => numPrefix(a) - numPrefix(b)),
          })),
      }))
  }, [op])

  // Value getters
  const getL3 = (col: string, l1: string, l2: string, l3: string): number => {
    if (col === '__acc__') return months.reduce((s, m) => s + (vm[m]?.[l1]?.[l2]?.[l3] ?? 0), 0)
    return vm[col]?.[l1]?.[l2]?.[l3] ?? 0
  }

  const getL2 = (col: string, l1: string, l2: string): number => {
    if (col === '__acc__') return months.reduce((s, m) => s + getL2(m, l1, l2), 0)
    return Object.values(vm[col]?.[l1]?.[l2] ?? {}).reduce((s, v) => s + v, 0)
  }

  const getL1 = (col: string, l1: string): number => {
    if (col === '__acc__') return months.reduce((s, m) => s + getL1(m, l1), 0)
    let s = 0
    for (const l2v of Object.values(vm[col]?.[l1] ?? {}))
      for (const v of Object.values(l2v)) s += v
    return s
  }

  const groupSum = (col: string, maxPfx: number): number =>
    hier.filter(h => numPrefix(h.l1) <= maxPfx).reduce((s, h) => s + getL1(col, h.l1), 0)

  const makeVals = (fn: (col: string) => number) => cols.map(fn)

  // Collapse state — set de EXPANDIDOS (vazio = tudo fechado por padrão)
  const [exp1, setExp1] = useState<Set<string>>(new Set())
  const [exp2, setExp2] = useState<Set<string>>(new Set())
  const toggleL1 = (l1: string) =>
    setExp1(prev => { const n = new Set(prev); n.has(l1) ? n.delete(l1) : n.add(l1); return n })
  const toggleL2 = (l2: string) =>
    setExp2(prev => { const n = new Set(prev); n.has(l2) ? n.delete(l2) : n.add(l2); return n })

  // ── Build dreRows ──────────────────────────────────────────────────────────
  const { dreRows, recLiqVals } = useMemo(() => {
    const recBrutaVals    = makeVals(col => groupSum(col, 1.99))
    const recLiqVals      = makeVals(col => groupSum(col, 2.99))
    const lucroBrutoVals  = makeVals(col => groupSum(col, 3.99))
    const margContribVals = makeVals(col => groupSum(col, 3.99) + getL2(col, '4 — Despesas', '4.1'))
    const ebitdaVals      = makeVals(col => groupSum(col, 4.99))
    const ebitVals        = makeVals(col => groupSum(col, 5.99))
    const ebtVals         = makeVals(col => groupSum(col, 6.99))
    const lucroLiqVals    = makeVals(col => groupSum(col, 99))

    const dreRows: DRERow[] = []

    for (let i = 0; i < hier.length; i++) {
      const { l1, children: l2s } = hier[i]
      const prefix  = numPrefix(l1)
      const nextPfx = i + 1 < hier.length ? numPrefix(hier[i + 1].l1) : Infinity

      dreRows.push({
        id: `l1::${l1}`, kind: 'l1', label: l1, l1Key: l1,
        vals: makeVals(col => getL1(col, l1)),
      })

      if (exp1.has(l1)) {
        for (const { l2, children: l3s } of l2s) {
          dreRows.push({
            id: `l2::${l2}`, kind: 'l2', label: getL2Label(l2), l1Key: l1, l2Key: l2,
            vals: makeVals(col => getL2(col, l1, l2)),
          })
          if (exp2.has(l2)) {
            for (const l3 of l3s) {
              dreRows.push({
                id: `l3::${l1}::${l2}::${l3}`, kind: 'l3', label: l3,
                l1Key: l1, l2Key: l2,
                vals: makeVals(col => getL3(col, l1, l2, l3)),
              })
            }
          }
          // Margem de Contribuição after 4.1
          if (l1 === '4 — Despesas' && l2 === '4.1') {
            dreRows.push({
              id: '__margContrib__', kind: 'subtotal',
              label: '(=) Margem de Contribuição',
              vals: margContribVals,
              tip: 'Lucro Bruto + Despesas Comerciais (4.1)\n\nMede quanto sobra para cobrir os custos fixos após pagar os custos operacionais e as despesas variáveis comerciais.\n\nFórmula: Lucro Bruto + Σ 4.1',
            })
          }
        }
      }

      // Subtotals at group transitions
      if (prefix <= 2 && nextPfx > 2)
        dreRows.push({ id: '__recLiq__',   kind: 'subtotal',  label: '(=) Receita Operacional Líquida', vals: recLiqVals,
          tip: 'Receita Operacional (grupo 1) + Deduções (grupo 2)\n\nGrupo 2 inclui impostos s/ faturamento (PIS, COFINS, ISS…), tarifas de recebimento (boleto, PIX, cartão) e royalties. Esses valores são negativos, então reduzem a receita bruta.\n\nFórmula: Σ grupos 1 + 2' })
      if (prefix <= 3 && nextPfx > 3)
        dreRows.push({ id: '__lubruto__',  kind: 'subtotal',  label: '(=) Lucro Bruto - R$',            vals: lucroBrutoVals,
          tip: 'Receita Operacional Líquida − Custos Operacionais (grupo 3)\n\nGrupo 3: mão de obra CSP (3.1), ISAAS (3.2) e serviços terceirizados (3.3).\n\nFórmula: Σ grupos 1 + 2 + 3' })
      if (prefix <= 4 && nextPfx > 4)
        dreRows.push({ id: '__ebitda__',   kind: 'ebitda',    label: '(=) EBITDA',                      vals: ebitdaVals,
          tip: 'Lucro Bruto − Todas as Despesas (grupos 4.1 + 4.2 + 4.3)\n\n4.1 Comerciais · 4.2 Administrativas · 4.3 Gerais\n\nAntes de depreciação, resultado financeiro e impostos sobre lucro.\n\nFórmula: Σ grupos 1 + 2 + 3 + 4' })
      if (prefix <= 5 && nextPfx > 5)
        dreRows.push({ id: '__ebit__',     kind: 'subtotal',  label: '(=) Lucro Operacional (EBIT)',     vals: ebitVals,
          tip: 'EBITDA − Depreciações e Amortizações (grupo 5)\n\n5.1 Depreciação (reformas, equipamentos, mobiliário, imóveis)\n5.2 Amortização (software, carteira de clientes)\n\nFórmula: Σ grupos 1 + 2 + 3 + 4 + 5' })
      if (prefix < 7 && nextPfx >= 7)
        dreRows.push({ id: '__ebt__',      kind: 'subtotal',  label: '(=) EBT — Lucro Antes do IR e CS', vals: ebtVals,
          tip: 'EBIT + Resultado Financeiro (grupo 6)\n\n6.1 Receitas financeiras (rendimentos, dividendos, câmbio)\n6.2 Despesas financeiras (juros, tarifas bancárias, inadimplência)\n\nFórmula: Σ grupos 1 + 2 + 3 + 4 + 5 + 6' })
      if (i === hier.length - 1)
        dreRows.push({ id: '__lucroliq__', kind: 'resultado', label: '(=) Lucro Líquido - R$',           vals: lucroLiqVals,
          tip: 'EBT − Impostos sobre o Lucro (grupo 7)\n\n7.1 CSLL · 7.2 IRPJ\n\nResultado final após todos os custos, despesas e impostos.\n\nFórmula: Σ todos os grupos (1 a 7)' })
    }

    return { dreRows, recBrutaVals, recLiqVals }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hier, exp1, exp2, months, vm])

  // ── Executive KPIs (accumulated) ──────────────────────────────────────────
  const exec = useMemo(() => {
    const recOp       = groupSum('__acc__', 1.99)
    const recFin      = getL1('__acc__', '6.1 — Rec. Financeira')
    const recBruta    = recOp + recFin
    const recLiq      = groupSum('__acc__', 2.99)
    const lubruto     = groupSum('__acc__', 3.99)
    const despCom     = getL2('__acc__', '4 — Despesas', '4.1')
    const margContrib = lubruto + despCom
    const ebitda      = groupSum('__acc__', 4.99)
    const ebit        = groupSum('__acc__', 5.99)
    const lucroLiq    = groupSum('__acc__', 99)

    // Growth Rate: compare last two visible months
    let growthRate: number | null = null
    if (months.length >= 2) {
      const cur = months[months.length - 1]
      const prv = months[months.length - 2]
      const curRL = groupSum(cur, 2.99)
      const prvRL = groupSum(prv, 2.99)
      if (prvRL) growthRate = (curRL - prvRL) / Math.abs(prvRL)
    }

    return { recOp, recFin, recBruta, recLiq, lubruto, margContrib, ebitda, ebit, lucroLiq, growthRate }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, vm, hier])

  // ── KPIs inferiores ────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    // Helper: sum op rows matching any of the given cat1 prefixes
    const S = (...pfx: string[]) =>
      op.filter(r => pfx.some(p => (r.cat1 || '').startsWith(p)))
        .reduce((s, r) => s + (r.tipo === 'Receita' ? 1 : -1) * r.valorDRE, 0)

    const recOp      = groupSum('__acc__', 1.99)
    const recLiq     = groupSum('__acc__', 2.99)
    const lubruto    = groupSum('__acc__', 3.99)
    const despCom    = getL2('__acc__', '4 — Despesas', '4.1')
    const margContrib = lubruto + despCom
    const ebitda     = groupSum('__acc__', 4.99)
    const ebit       = groupSum('__acc__', 5.99)
    const lucroLiq   = groupSum('__acc__', 99)
    const deducoes   = groupSum('__acc__', 2.99) - groupSum('__acc__', 1.99)
    const csp        = getL1('__acc__', '3 — Custos Operac.')
    const terceiros  = getL2('__acc__', '3 — Custos Operac.', '3.3')
    const despAdmin  = getL2('__acc__', '4 — Despesas', '4.2')
    const despGerais = getL2('__acc__', '4 — Despesas', '4.3')

    const maoObraCSP   = getL2('__acc__', '3 — Custos Operac.', '3.1')
    const isaas        = getL2('__acc__', '3 — Custos Operac.', '3.2')
    const remuCom      = S('4.1.01','4.1.02','4.1.03','4.1.04','4.1.05','4.1.23')
    const admPessoas   = S('4.2.01','4.2.02','4.2.03','4.2.04','4.2.05','4.2.06','4.2.07','4.2.08','4.2.09','4.2.25','4.2.26')
    const gastosPessoas = maoObraCSP + isaas + remuCom + admPessoas

    const despAquisicao = S('4.1.02','4.1.04','4.1.06','4.1.07','4.1.08','4.1.10','4.1.11','4.1.12','4.1.13','4.1.14','4.1.15','4.1.16','4.1.17')
    const leadBroker    = S('4.1.06')
    const despExpansao  = S('4.1.18','4.1.19','4.1.20','4.1.21','4.1.22','4.1.23')
    const proLabore     = S('4.2.25','4.2.26')

    const growthRate = exec.growthRate

    return {
      recOp, recLiq, lubruto, margContrib, ebitda, ebit, lucroLiq, deducoes,
      csp, terceiros, despCom, despAdmin, despGerais, gastosPessoas,
      despAquisicao, leadBroker, despExpansao, proLabore, growthRate,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op, months, vm, hier, exec])

  // ── Render ────────────────────────────────────────────────────────────────

  if (op.length === 0) {
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
                      onClick={() => {
                        if (row.kind === 'l1') toggleL1(row.l1Key!)
                        if (row.kind === 'l2') toggleL2(row.l2Key!)
                      }}
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

                      return [
                        <td
                          key={`${row.id}-${col}-r`}
                          style={{
                            padding: `${s.py}px 8px`,
                            textAlign: 'right',
                            fontWeight: row.kind === 'l3' ? 400 : s.fw,
                            fontSize: s.fs,
                            color: fg,
                            background: bg,
                            borderLeft: '1px solid var(--line)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {fR(val)}
                        </td>,
                        <td
                          key={`${row.id}-${col}-p`}
                          style={{
                            padding: `${s.py}px 8px`,
                            textAlign: 'right',
                            fontWeight: 400,
                            fontSize: 10,
                            color: pctFg,
                            background: bg,
                            whiteSpace: 'nowrap',
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

    </div>
  )
}
