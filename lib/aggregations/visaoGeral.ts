import { filtraOperacional } from '@/lib/financeiro/regime'
import { applyFiltros, type FinanceiroFiltros } from '@/lib/financeiro-filtros'
import { asArray } from '@/lib/fetchJson'
import { calcTicketMedioReceita, calcDiaDePico, calcBurnDiario } from '@/lib/calcInsights'
import type { Lancamento } from '@/lib/types'

/**
 * Agregação da Visão Geral — função PURA, sem I/O.
 *
 * Mesmo padrão do Bloco C: o cálculo sai do componente para cá e os DOIS
 * caminhos da flag AGG_BACKEND chamam esta função. OFF roda no browser sobre
 * o array cru; ON roda no servidor. Não existem duas implementações para
 * divergirem.
 *
 * ── DOIS NÍVEIS DE FILTRO, de propósito ────────────────────────────────────
 * O componente usa DUAS coleções diferentes, e isso precisa ser preservado:
 *
 *   base = applyFiltros(cru)                      ← só os 5 filtros do usuário
 *   op   = filtraOperacional(base, regime)        ← + regras de ouro do regime
 *
 * KPIs de receita/despesa/resultado/margem, contagem, sem-cat/sem-CC, série
 * diária e tops usam `op`. O KPI **Atrasados** usa `base` — ou seja, conta
 * lançamentos que as regras de regime excluiriam. Não é descuido: "atrasado"
 * é uma pergunta sobre a carteira, não sobre o regime. Mantido como está.
 *
 * ── DATAS: string, sem Date ────────────────────────────────────────────────
 * Tudo opera sobre 'YYYY-MM-DD'. `fDt` do projeto formata a partir de
 * componentes LOCAIS, então 'YYYY-MM-DD' → 'DD/MM/YYYY' é recorte de string,
 * sem conversão de timezone. Por isso a Visão Geral NÃO precisa de
 * `fetchLancamentosComData`.
 *
 * `hojeYmd` é parâmetro e não `new Date()` interno: o cliente roda em GMT-3 e
 * o servidor em UTC, e às 22h BRT os dois discordariam sobre que dia é hoje —
 * o que mudaria o KPI de Atrasados entre os caminhos da flag. Recebendo o dia
 * de referência de fora, os dois caminhos comparam contra o mesmo valor.
 */

export interface VisaoGeralKpis {
  receita: number
  despesa: number
  resultado: number
  /** Percentual (não fração). 0 quando receita = 0, como hoje. */
  margem: number
  /** Contagem de lançamentos operacionais (op.length). */
  lancamentos: number
  atrasados: number
  semCat: number
  semCC: number
}

export interface PontoDiario {
  /** 'DD/MM/YYYY' — o mesmo label que o eixo X do gráfico usa hoje. */
  data: string
  rec: number
  desp: number
}

export interface ItemRanking {
  nome: string
  valor: number
}

export interface VisaoGeralInsights {
  /** Ticket médio das receitas. 0 quando não há receita, como hoje. */
  ticket: number
  /** Dia com maior soma de receitas. null quando não há receita. */
  pico: { label: string; valor: number } | null
  /** Burn diário médio. 0 sem período definido, como hoje. */
  burn: number
}

export interface VisaoGeralAgg {
  kpis: VisaoGeralKpis
  insights: VisaoGeralInsights
  graficos: { diario: PontoDiario[] }
  agrupamentos: {
    topDespesasCategoria: ItemRanking[]
    maxDespesaCategoria: number
    topCentrosCusto: ItemRanking[]
    maxCentroCusto: number
  }
}

/** 'YYYY-MM-DD' a partir de Date (componentes locais) ou string já normalizada. */
function ymd(d: Date | string | null | undefined): string | null {
  if (!d) return null
  if (typeof d === 'string') return d.slice(0, 10)
  const dt = d as Date
  if (typeof dt.getFullYear !== 'function') return null
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY'. Equivale a fDt sobre a data local. */
function labelBR(y: string): string {
  return `${y.slice(8, 10)}/${y.slice(5, 7)}/${y.slice(0, 4)}`
}

export function aggVisaoGeral(
  cru: readonly Lancamento[],
  filtros: FinanceiroFiltros,
  regime: string,
  hojeYmd: string,
  periodo: { de: string; ate: string },
): VisaoGeralAgg {
  const base = applyFiltros(asArray<Lancamento>(cru), filtros)
  const op = filtraOperacional(base, regime)

  // ── KPIs ────────────────────────────────────────────────────────────────
  let receita = 0
  let despesa = 0
  for (const r of op) {
    if (r.tipo === 'Receita') receita += r.valor
    else despesa += r.valor
  }

  // Atrasados sobre `base` (ver nota acima). `r.data < hoje` no componente
  // compara meia-noite local com o instante atual — o que inclui o próprio
  // dia de hoje. Em string isso equivale a `<=`.
  let atrasados = 0
  for (const r of base) {
    if (r.situacao !== 'Atrasado' && r.situacao !== 'Aberto') continue
    const d = ymd(r.data)
    if (d && d <= hojeYmd) atrasados += r.valor
  }

  const resultado = receita - despesa

  const kpis: VisaoGeralKpis = {
    receita,
    despesa,
    resultado,
    margem: receita > 0 ? (resultado / receita) * 100 : 0,
    lancamentos: op.length,
    atrasados,
    semCat: op.filter(r => !r.cat1 || r.cat1 === '(em branco)').length,
    semCC:  op.filter(r => !r.cc1  || r.cc1  === '(em branco)').length,
  }

  // ── Série diária ────────────────────────────────────────────────────────
  // Agrupa pela data ISO (ordenável direto) e só depois formata o label,
  // preservando a mesma ordenação cronológica de hoje.
  const porDia = new Map<string, { rec: number; desp: number }>()
  for (const r of op) {
    const d = ymd(r.data)
    if (!d) continue
    const e = porDia.get(d) ?? { rec: 0, desp: 0 }
    if (r.tipo === 'Receita') e.rec += r.valor
    else e.desp += r.valor
    porDia.set(d, e)
  }
  const diario: PontoDiario[] = [...porDia.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([d, v]) => ({ data: labelBR(d), rec: v.rec, desp: v.desp }))

  // ── Tops (só despesas), 10 primeiros ────────────────────────────────────
  const porCat = new Map<string, number>()
  const porCC = new Map<string, number>()
  for (const r of op) {
    if (r.tipo !== 'Despesa') continue
    const k = r.cat1 || 'Sem categoria'
    porCat.set(k, (porCat.get(k) || 0) + r.valor)
    for (const c of r._ccList) porCC.set(c.nome, (porCC.get(c.nome) || 0) + r.valor)
  }
  const top = (m: Map<string, number>): ItemRanking[] =>
    [...m.entries()].map(([nome, valor]) => ({ nome, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 10)

  const topDespesasCategoria = top(porCat)
  const topCentrosCusto = top(porCC)

  // Insights: reusa lib/calcInsights (as MESMAS funções que o componente
  // usava), sobre `op` — exatamente o array que ele recebia.
  const insights: VisaoGeralInsights = {
    ticket: calcTicketMedioReceita(op),
    pico:   calcDiaDePico(op),
    burn:   calcBurnDiario(op, periodo.de, periodo.ate),
  }

  return {
    kpis,
    insights,
    graficos: { diario },
    agrupamentos: {
      topDespesasCategoria,
      // `|| 1` preservado do componente: evita divisão por zero na barra.
      maxDespesaCategoria: topDespesasCategoria[0]?.valor || 1,
      topCentrosCusto,
      maxCentroCusto: topCentrosCusto[0]?.valor || 1,
    },
  }
}
