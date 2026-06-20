/**
 * GET /api/financeiro/bus?de=YYYY-MM-DD&ate=YYYY-MM-DD
 *
 * Agrega KPIs + evolução 6 meses + top categorias + lançamentos recentes
 * por BU. Regime competência (data = COALESCE(data_competencia, data_vencimento),
 * igual DRE). Classificação via JOIN com ca.v_lancamento_bu.
 *
 * Regras de ouro aplicadas no SQL:
 *   - status NOT IN ('Cancelado', 'Renegociado')
 *   - origem NOT IN ('TRANSFERENCIA', 'SALDO_CONTA_BANCARIA')
 *   - categoria NOT LIKE '(-)%' / '(+)%' / '(Não DRE)%'
 *
 * Pagamento Parcial entra com `total` (valor face) — competência puro.
 *
 * Operação e Receita sempre vêm (mesmo zeradas, pra fixar as tabs).
 * Não Operacional e Sem Categoria só vêm se houver lançamentos.
 */

import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { requireScreen } from '@/lib/access'
import type { BU, BuData, BusApiResponse, BuKpis, BuEvolucaoPonto, BuTopItem, BuLancamento } from '@/lib/types/bus'

export const dynamic = 'force-dynamic'

const pool = getPool()

interface BaseRow {
  id_lancamento: string
  tipo_origem: 'receber' | 'pagar'
  tipo: 'Receita' | 'Despesa'
  descricao: string
  data_iso: string          // YYYY-MM-DD
  data_ym: string           // YYYY-MM
  valor: string             // numeric vem como string em pg
  status: string
  origem: string
  categoria_nome: string
  centro_custo_nome: string
  contraparte_nome: string
  bu: BU
}

// "YYYY-MM-DD" → primeiro dia do mês (YYYY-MM-01) deslocado -n meses
function shiftMonth(ate: string, deltaMonths: number): string {
  const [y, m] = ate.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + deltaMonths, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

// Último dia do mês de "YYYY-MM"
function endOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0))  // dia 0 do próximo mês = último do atual
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function ymOf(date: string): string {
  return date.slice(0, 7)
}

// Pega o prefixo numérico do nome da categoria. "3.2.05 Algo" → "3.2"
// Usado para os tops dentro de cada BU.
function catPrefix(nome: string): string {
  const m = nome.match(/^(\d+\.\d+(?:\.\d+)?)/)
  return m ? m[1] : nome
}

function l1Prefix(nome: string): number {
  const m = nome.match(/^(\d+)/)
  return m ? parseInt(m[1], 10) : 999
}

function zeroKpis(): BuKpis {
  return {
    receita_bruta: 0, deducoes: 0, proporcao: 0, receita_liquida: 0,
    custos: 0, margem_bruta: 0, despesas_op: 0, ebitda: 0,
    margem_ebitda_pct: 0,
    nao_operacional_total: 0,
    qtd_lancamentos: 0, total_bruto: 0,
    delta_vs_m1: { receita_liquida_pct: null, ebitda_pct: null, margem_ebitda_pp: null },
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/**
 * Aplica rateio das deduções entre Operação e Receita in-place sobre os KPIs
 * já calculados de cada BU. Garante soma exata (Op + Receita ≡ totalDeducoes)
 * dando o complemento à Receita pra não perder centavo no arredondamento.
 *
 * Pré-condição: calcKpisForBU já rodou em ambos. Após 0005, as cat 2.x
 * físicas caem todas em Operação, então kpisOp.deducoes carrega o total
 * antes do rateio — usamos isso como `totalDeducoes`.
 */
function aplicaRateio(kpisOp: BuKpis, kpisReceita: BuKpis): number {
  const totalDeducoes = kpisOp.deducoes  // pós-0005: tudo cai em Operação
  const totalBruta    = kpisOp.receita_bruta + kpisReceita.receita_bruta

  if (totalBruta <= 0) {
    // Sem receita no período → não há base para rateio. Mantém deducoes = 0
    // nas duas BUs (e ignora `totalDeducoes` ainda em kpisOp.deducoes).
    kpisOp.deducoes      = 0
    kpisReceita.deducoes = 0
    kpisOp.proporcao = 0
    kpisReceita.proporcao = 0
  } else {
    kpisOp.proporcao      = kpisOp.receita_bruta / totalBruta
    kpisReceita.proporcao = kpisReceita.receita_bruta / totalBruta

    kpisOp.deducoes      = round2(totalDeducoes * kpisOp.proporcao)
    // Receita pega o complemento — garante Op + Receita == totalDeducoes
    kpisReceita.deducoes = round2(totalDeducoes - kpisOp.deducoes)
  }

  // Recalcula os derivados em cada BU
  for (const k of [kpisOp, kpisReceita]) {
    k.receita_liquida   = k.receita_bruta - k.deducoes
    k.margem_bruta      = k.receita_liquida - k.custos
    k.ebitda            = k.margem_bruta - k.despesas_op
    k.margem_ebitda_pct = k.receita_liquida > 0 ? (k.ebitda / k.receita_liquida) * 100 : 0
  }

  return totalDeducoes
}

function calcKpisForBU(rows: BaseRow[], bu: BU): BuKpis {
  const k = zeroKpis()
  k.qtd_lancamentos = rows.length

  for (const r of rows) {
    const v = Math.abs(Number(r.valor))
    k.total_bruto += v

    const p1 = l1Prefix(r.categoria_nome)

    if (bu === 'nao_operacional') {
      // 5/6/7. Receita financeira (6.1) é receita; resto é despesa.
      if (r.tipo === 'Receita') k.nao_operacional_total += v
      else k.nao_operacional_total -= v
      continue
    }

    // Para operacao/receita/sem_categoria, decompõe por L1:
    if (p1 === 1) k.receita_bruta += v
    else if (p1 === 2) k.deducoes += v
    else if (p1 === 3) k.custos += v
    else if (p1 === 4) k.despesas_op += v
    // cat 5/6/7 não entra aqui (já tratada em nao_operacional)
  }

  k.receita_liquida = k.receita_bruta - k.deducoes
  k.margem_bruta = k.receita_liquida - k.custos
  k.ebitda = k.margem_bruta - k.despesas_op
  k.margem_ebitda_pct = k.receita_liquida > 0 ? (k.ebitda / k.receita_liquida) * 100 : 0

  return k
}

function calcEvolucao(rows: BaseRow[], window: string[]): BuEvolucaoPonto[] {
  // window = lista ordenada de YYYY-MM (6 itens)
  const acc = new Map<string, { receita: number; despesa: number; ebitda: number }>()
  for (const ym of window) acc.set(ym, { receita: 0, despesa: 0, ebitda: 0 })

  for (const r of rows) {
    const e = acc.get(r.data_ym)
    if (!e) continue
    const v = Math.abs(Number(r.valor))
    const p1 = l1Prefix(r.categoria_nome)
    if (p1 === 1) { e.receita += v; e.ebitda += v }
    else if (p1 === 2) { e.receita -= v; e.ebitda -= v }       // deduções: drenam receita líquida
    else if (p1 === 3) { e.despesa += v; e.ebitda -= v }       // custos
    else if (p1 === 4) { e.despesa += v; e.ebitda -= v }       // despesas op
    // 5/6/7 ficam fora do EBITDA por definição
  }

  return window.map(ym => ({ mes: ym, ...acc.get(ym)! }))
}

/**
 * Evolução para Operação + Receita com rateio mensal das deduções. Pós-0005
 * as cat 2.x vivem todas em Operação, então o total de deduções do mês é
 * exatamente `op.ded`. Rateia proporcional à receita bruta do mês de cada BU.
 */
function calcEvolucaoOpReceita(
  rowsOp: BaseRow[],
  rowsReceita: BaseRow[],
  window: string[],
): { op: BuEvolucaoPonto[]; receita: BuEvolucaoPonto[] } {
  const op = new Map<string, { rb: number; ded: number; cu: number; do_: number }>()
  const re = new Map<string, { rb: number; cu: number; do_: number }>()
  for (const ym of window) {
    op.set(ym, { rb: 0, ded: 0, cu: 0, do_: 0 })
    re.set(ym, { rb: 0,           cu: 0, do_: 0 })
  }

  for (const r of rowsOp) {
    const e = op.get(r.data_ym); if (!e) continue
    const v = Math.abs(Number(r.valor))
    const p1 = l1Prefix(r.categoria_nome)
    if      (p1 === 1) e.rb  += v
    else if (p1 === 2) e.ded += v   // pós-0005 todas as deduções caem aqui
    else if (p1 === 3) e.cu  += v
    else if (p1 === 4) e.do_ += v
  }
  for (const r of rowsReceita) {
    const e = re.get(r.data_ym); if (!e) continue
    const v = Math.abs(Number(r.valor))
    const p1 = l1Prefix(r.categoria_nome)
    if      (p1 === 1) e.rb  += v
    else if (p1 === 3) e.cu  += v   // 3.2 ISAAS
    else if (p1 === 4) e.do_ += v   // 4.1 despesas comerciais
  }

  const outOp:  BuEvolucaoPonto[] = []
  const outRe:  BuEvolucaoPonto[] = []
  for (const ym of window) {
    const o = op.get(ym)!
    const r = re.get(ym)!
    const totalBruta = o.rb + r.rb
    const propOp = totalBruta > 0 ? o.rb / totalBruta : 0
    const dedOp  = round2(o.ded * propOp)
    const dedRe  = round2(o.ded - dedOp)
    const rlOp   = o.rb - dedOp
    const rlRe   = r.rb - dedRe
    outOp.push({ mes: ym, receita: rlOp, despesa: o.cu + o.do_, ebitda: rlOp - o.cu - o.do_ })
    outRe.push({ mes: ym, receita: rlRe, despesa: r.cu + r.do_, ebitda: rlRe - r.cu - r.do_ })
  }
  return { op: outOp, receita: outRe }
}

function calcTops(rows: BaseRow[], n: number): { despesas: BuTopItem[]; receitas: BuTopItem[] } {
  const desp = new Map<string, number>()
  const rec  = new Map<string, number>()
  for (const r of rows) {
    const v = Math.abs(Number(r.valor))
    const key = catPrefix(r.categoria_nome) + (r.categoria_nome.slice(catPrefix(r.categoria_nome).length))
    const map = r.tipo === 'Receita' ? rec : desp
    map.set(key, (map.get(key) || 0) + v)
  }
  const toSorted = (m: Map<string, number>) =>
    Array.from(m.entries())
      .map(([categoria, valor]) => ({ categoria, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, n)
  return { despesas: toSorted(desp), receitas: toSorted(rec) }
}

// Retorna TODOS os lançamentos da BU no período, ordenados por data desc.
// O frontend usa slice(0,10) para a visão padrão e filtra por categoria_l1
// no drill-down dos KPIs — evita round-trip extra.
function buildLancamentos(rows: BaseRow[]): BuLancamento[] {
  return [...rows]
    .sort((a, b) => b.data_iso.localeCompare(a.data_iso))
    .map(r => ({
      id: `${r.tipo_origem}:${r.id_lancamento}`,
      data: r.data_iso,
      descricao: r.descricao,
      categoria: r.categoria_nome,
      categoria_l1: l1Prefix(r.categoria_nome),
      centro_custo: r.centro_custo_nome,
      contraparte: r.contraparte_nome,
      tipo: r.tipo,
      status: r.status,
      valor: Math.abs(Number(r.valor)),
    }))
}

function buildBuData(
  bu: BU,
  rowsPeriodo: BaseRow[],
  rowsM1: BaseRow[],
  rowsEvolucao: BaseRow[],
  windowYMs: string[],
): BuData {
  const kpis = calcKpisForBU(rowsPeriodo, bu)
  const k1   = calcKpisForBU(rowsM1, bu)

  kpis.delta_vs_m1 = {
    receita_liquida_pct: k1.receita_liquida > 0
      ? ((kpis.receita_liquida - k1.receita_liquida) / k1.receita_liquida) * 100
      : null,
    ebitda_pct: Math.abs(k1.ebitda) > 0
      ? ((kpis.ebitda - k1.ebitda) / Math.abs(k1.ebitda)) * 100
      : null,
    margem_ebitda_pp: k1.receita_liquida > 0
      ? kpis.margem_ebitda_pct - k1.margem_ebitda_pct
      : null,
  }

  const tops = calcTops(rowsPeriodo, 5)

  return {
    bu,
    kpis,
    evolucao: calcEvolucao(rowsEvolucao, windowYMs),
    top_despesas: tops.despesas,
    top_receitas: tops.receitas,
    lancamentos: buildLancamentos(rowsPeriodo),
  }
}

// COALESCE(data_competencia, data_vencimento) espelha o pattern do DRE em
// app/api/financeiro/route.ts. Hoje sem_competencia = 0 nas duas tabelas
// (verificado em prod 2026-06-20), mas mantemos o fallback por consistência
// com o resto do projeto — se um lançamento entrar sem competência amanhã, a
// /bus e a /dre comportam igual.
// Parâmetros do FETCH_SQL:
//   $1 date   — de
//   $2 date   — ate
//   $3 text   — tipo ('Receita' | 'Despesa' | NULL = ambos)
//   $4 text[] — situacao (NULL = todos)
//   $5 text[] — categoria por nome (NULL = todas)
//   $6 text[] — centro de custo por nome (NULL = todos)
//   $7 text[] — conta financeira por nome (NULL = todas)
//
// Convenção: $N::tipo[] IS NULL pula o filtro inteiro (nenhuma seleção no
// FilterBar = sem restrição). text vazio em $3 também não restringe.
const FETCH_SQL = `
  WITH base AS (
    SELECT
      cr.id::text                                          AS id_lancamento,
      'receber'::text                                      AS tipo_origem,
      'Receita'::text                                      AS tipo,
      cr.descricao                                         AS descricao,
      COALESCE(cr.data_competencia, cr.data_vencimento)    AS data,
      cr.total                                             AS valor,
      cr.status                                            AS status,
      COALESCE(cr.origem, '')                              AS origem,
      cr.categoria_id                                      AS categoria_id,
      cr.centro_custo_id                                   AS centro_custo_id,
      cr.conta_financeira_id                               AS conta_financeira_id,
      cr.pessoa_id                                         AS pessoa_id
    FROM ca.contas_receber cr
    WHERE COALESCE(cr.data_competencia, cr.data_vencimento) BETWEEN $1::date AND $2::date
      AND cr.status NOT IN ('Cancelado', 'Renegociado')
      AND COALESCE(cr.origem, '') NOT IN ('TRANSFERENCIA', 'SALDO_CONTA_BANCARIA')
      -- tipo: se $3 = 'Despesa', exclui receber inteiramente
      AND ($3::text IS NULL OR $3::text = '' OR $3::text = 'Receita')
      AND ($4::text[] IS NULL OR cr.status = ANY($4::text[]))

    UNION ALL

    SELECT
      cp.id::text, 'pagar', 'Despesa', cp.descricao,
      COALESCE(cp.data_competencia, cp.data_vencimento),
      cp.total, cp.status, COALESCE(cp.origem, ''),
      cp.categoria_id, cp.centro_custo_id, cp.conta_financeira_id, cp.pessoa_id
    FROM ca.contas_pagar cp
    WHERE COALESCE(cp.data_competencia, cp.data_vencimento) BETWEEN $1::date AND $2::date
      AND cp.status NOT IN ('Cancelado', 'Renegociado')
      AND COALESCE(cp.origem, '') NOT IN ('TRANSFERENCIA', 'SALDO_CONTA_BANCARIA')
      AND ($3::text IS NULL OR $3::text = '' OR $3::text = 'Despesa')
      AND ($4::text[] IS NULL OR cp.status = ANY($4::text[]))
  )
  SELECT
    b.id_lancamento,
    b.tipo_origem,
    b.tipo,
    b.descricao,
    b.status,
    b.origem,
    b.valor,
    TO_CHAR(b.data, 'YYYY-MM-DD')           AS data_iso,
    TO_CHAR(b.data, 'YYYY-MM')              AS data_ym,
    COALESCE(cat.nome, '')                  AS categoria_nome,
    COALESCE(cc.nome,  '')                  AS centro_custo_nome,
    COALESCE(p.nome,   '')                  AS contraparte_nome,
    COALESCE(bu.bu, 'sem_categoria')        AS bu
  FROM base b
  LEFT JOIN ca.v_lancamento_bu bu
    ON bu.id_lancamento::text = b.id_lancamento
   AND bu.tipo_origem = b.tipo_origem
  LEFT JOIN ca.categorias        cat ON cat.id = b.categoria_id
  LEFT JOIN ca.centros_custo     cc  ON cc.id  = b.centro_custo_id
  LEFT JOIN ca.contas_financeiras cf  ON cf.id  = b.conta_financeira_id
  LEFT JOIN ca.pessoas           p   ON p.id   = b.pessoa_id
  WHERE COALESCE(cat.nome, '') NOT LIKE '(-)%'
    AND COALESCE(cat.nome, '') NOT LIKE '(+)%'
    AND COALESCE(cat.nome, '') NOT LIKE '(Não DRE)%'
    AND ($5::text[] IS NULL OR cat.nome = ANY($5::text[]))
    AND ($6::text[] IS NULL OR cc.nome  = ANY($6::text[]))
    AND ($7::text[] IS NULL OR cf.nome  = ANY($7::text[]))
`

export async function GET(request: Request) {
  const denied = await requireScreen('bus')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const de  = searchParams.get('de')
  const ate = searchParams.get('ate')

  if (!de || !ate) {
    return NextResponse.json({ error: 'parâmetros `de` e `ate` obrigatórios (YYYY-MM-DD)' }, { status: 400 })
  }

  // Filtros do FilterBar global. Convenção: ausência (NULL) = sem restrição.
  // Pra arrays vazios também passamos NULL — o SQL pula o filtro.
  const tipoParam = searchParams.get('tipo')
  const tipo: string | null = tipoParam && (tipoParam === 'Receita' || tipoParam === 'Despesa') ? tipoParam : null
  const arrOrNull = (vs: string[]): string[] | null => vs.length > 0 ? vs : null
  const situacao  = arrOrNull(searchParams.getAll('situacao'))
  const categoria = arrOrNull(searchParams.getAll('categoria'))
  const cc        = arrOrNull(searchParams.getAll('cc'))
  const conta     = arrOrNull(searchParams.getAll('conta'))

  // Janelas:
  //   - Período atual (KPIs, tops, lançamentos recentes): [de..ate]
  //   - M-1 (delta_vs_m1): mês cheio anterior a mes_referencia
  //   - Evolução 6 meses: [M-5..M], mes inteiro
  const mesRef    = ymOf(ate)
  const m1Start   = shiftMonth(`${mesRef}-01`, -1)        // primeiro dia M-1
  const m1End     = endOfMonth(ymOf(m1Start))             // último dia M-1
  const evolStart = shiftMonth(`${mesRef}-01`, -5)        // primeiro dia M-5
  const evolEnd   = endOfMonth(mesRef)                    // último dia M

  const windowYMs: string[] = []
  for (let i = 5; i >= 0; i--) windowYMs.push(ymOf(shiftMonth(`${mesRef}-01`, -i)))

  try {
    const client = await pool.connect()
    try {
      const t0 = Date.now()
      // Filtros do FilterBar (tipo/situacao/categoria/cc/conta) aplicados
      // identicamente nas 3 janelas — período corrente, M-1 e evolução —
      // pra manter consistência entre KPIs, delta_vs_m1 e o chart.
      const filterArgs = [tipo, situacao, categoria, cc, conta] as const
      const [periodoRes, m1Res, evolRes] = await Promise.all([
        client.query<BaseRow>(FETCH_SQL, [de,        ate,    ...filterArgs]),
        client.query<BaseRow>(FETCH_SQL, [m1Start,   m1End,  ...filterArgs]),
        client.query<BaseRow>(FETCH_SQL, [evolStart, evolEnd, ...filterArgs]),
      ])
      const dbMs = Date.now() - t0

      const byBuPeriodo = groupByBu(periodoRes.rows)
      const byBuM1      = groupByBu(m1Res.rows)
      const byBuEvol    = groupByBu(evolRes.rows)

      const bus: BuData[] = []

      // ── Operação + Receita: rateio das deduções proporcional à RB ────────
      const opPeriodo  = byBuPeriodo.get('operacao') ?? []
      const recPeriodo = byBuPeriodo.get('receita')  ?? []
      const opM1       = byBuM1.get('operacao')      ?? []
      const recM1      = byBuM1.get('receita')       ?? []
      const opEvol     = byBuEvol.get('operacao')    ?? []
      const recEvol    = byBuEvol.get('receita')     ?? []

      // KPIs do período corrente — calcula → rateio
      const opKpis  = calcKpisForBU(opPeriodo,  'operacao')
      const recKpis = calcKpisForBU(recPeriodo, 'receita')
      const totalDeducoesPeriodo = aplicaRateio(opKpis, recKpis)

      // M-1 KPIs — mesma mecânica, pra alimentar delta_vs_m1
      const opKpisM1  = calcKpisForBU(opM1,  'operacao')
      const recKpisM1 = calcKpisForBU(recM1, 'receita')
      aplicaRateio(opKpisM1, recKpisM1)

      // delta_vs_m1 sobre os valores rateados
      const setDelta = (k: BuKpis, k1: BuKpis) => {
        k.delta_vs_m1 = {
          receita_liquida_pct: k1.receita_liquida > 0
            ? ((k.receita_liquida - k1.receita_liquida) / k1.receita_liquida) * 100
            : null,
          ebitda_pct: Math.abs(k1.ebitda) > 0
            ? ((k.ebitda - k1.ebitda) / Math.abs(k1.ebitda)) * 100
            : null,
          margem_ebitda_pp: k1.receita_liquida > 0
            ? k.margem_ebitda_pct - k1.margem_ebitda_pct
            : null,
        }
      }
      setDelta(opKpis, opKpisM1)
      setDelta(recKpis, recKpisM1)

      // Evolução 6 meses com rateio mensal
      const evol = calcEvolucaoOpReceita(opEvol, recEvol, windowYMs)

      // Tops e lançamentos
      const opTops  = calcTops(opPeriodo,  5)
      const recTops = calcTops(recPeriodo, 5)
      const opLancamentos  = buildLancamentos(opPeriodo)
      const recLancamentos = buildLancamentos(recPeriodo)

      // Linha sintética da Receita: representa a parcela rateada das deduções,
      // cujos lançamentos físicos vivem em Operação. Inserida no topo da
      // lista de Receita para aparecer no drill-down de Receita Líquida
      // (categoria_l1 = 2 cai no filtro KPI_TO_L1['receita_liquida']).
      if (recKpis.deducoes > 0) {
        const pctStr = (recKpis.proporcao * 100).toFixed(1).replace('.', ',') + '%'
        const totStr = totalDeducoesPeriodo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        recLancamentos.unshift({
          id: 'sintetica:deducoes-rateadas',
          data: '',
          descricao: `Deduções rateadas (${pctStr} × ${totStr})`,
          categoria: 'Deduções rateadas',
          categoria_l1: 2,
          centro_custo: '',
          contraparte: '',
          tipo: 'Despesa',
          status: '',
          valor: recKpis.deducoes,
          _sintetica: true,
          link_target: { bu: 'operacao', kpi: 'receita_liquida' },
        })
      }

      bus.push({
        bu: 'operacao',
        kpis: opKpis,
        evolucao: evol.op,
        top_despesas: opTops.despesas,
        top_receitas: opTops.receitas,
        lancamentos: opLancamentos,
      })
      bus.push({
        bu: 'receita',
        kpis: recKpis,
        evolucao: evol.receita,
        top_despesas: recTops.despesas,
        top_receitas: recTops.receitas,
        lancamentos: recLancamentos,
      })

      // ── Não Operacional e Sem Categoria: sem rateio, lógica antiga ───────
      for (const bu of ['nao_operacional', 'sem_categoria'] as const) {
        const rows = byBuPeriodo.get(bu) ?? []
        if (rows.length === 0) continue
        bus.push(buildBuData(
          bu,
          rows,
          byBuM1.get(bu) ?? [],
          byBuEvol.get(bu) ?? [],
          windowYMs,
        ))
      }

      const response: BusApiResponse = {
        periodo: { de, ate, mes_referencia: mesRef },
        bus,
      }

      return NextResponse.json(response, {
        headers: { 'x-bus-db-ms': String(dbMs) },
      })
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('[api/financeiro/bus]', err)
    return NextResponse.json({ error: 'erro interno' }, { status: 500 })
  }
}

function groupByBu(rows: BaseRow[]): Map<BU, BaseRow[]> {
  const m = new Map<BU, BaseRow[]>()
  for (const r of rows) {
    const arr = m.get(r.bu) ?? []
    arr.push(r)
    m.set(r.bu, arr)
  }
  return m
}
