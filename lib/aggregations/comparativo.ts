import { filtraOperacional } from '@/lib/financeiro/regime'
import { applyFiltros, type FinanceiroFiltros } from '@/lib/financeiro-filtros'
import { mLbl, parseCatHier } from '@/lib/utils'
import type { Lancamento } from '@/lib/types'

/**
 * Agregação do Comparativo — função PURA, sem I/O.
 *
 * Mesmo padrão dos blocos anteriores: o cálculo sai do componente para cá e os
 * DOIS caminhos da flag chamam esta função. OFF roda no browser; ON roda no
 * servidor. Uma implementação só.
 *
 * ── `data` × `allData`: o que essas props REALMENTE são ────────────────────
 *
 * O nome engana. `allData` NÃO é um histórico mais largo: é o MESMO período
 * (`de`/`ate`), só que SEM os 5 filtros do usuário. Os dois saem da mesma
 * chamada de `/api/financeiro`, e `useFinanceiro` deriva
 * `filteredData = allData.filter(5 filtros)`.
 *
 *   data    → período + 5 filtros + descarta lançamento sem data  → `op`
 *   allData → período, sem filtro nenhum                          → `allOp`
 *
 * `allOp` é usado num lugar só: o lookup do mesmo mês no ano anterior, para o
 * YoY. Daí duas consequências, ambas anteriores a esta refatoração e
 * preservadas aqui de propósito:
 *
 *   1. O YoY fica VAZIO sempre que o período selecionado não alcança o ano
 *      anterior — que é o caso do padrão da tela (mês corrente). Medido: com
 *      período 2026 inteiro, 12 meses e nenhum com YoY.
 *
 *   2. Quando existe, o YoY compara o período FILTRADO contra o ano anterior
 *      NÃO filtrado. Com `tipo=Despesa`, a receita de 2025-06 vale 0 em `op` e
 *      548.542,63 em `allOp`.
 *
 * Mudar qualquer um dos dois altera número em relatório e é decisão do Felipe,
 * não desta refatoração. Por isso a função recebe os DOIS conjuntos e aplica os
 * filtros só em um.
 *
 * ── DATAS: string, sem Date ────────────────────────────────────────────────
 * Tudo opera sobre `data_ym`. O componente usava
 * `${r.data.getFullYear()}-${r.data.getMonth()+1}`, que exige Date e só existe
 * no browser. Conferi sobre 9238 lançamentos reais: `data_ym` e o par
 * getFullYear/getMonth concordam em 100% dos casos — `parseDataLocal` constrói
 * o Date a partir dos componentes locais da própria string, então não poderia
 * ser diferente. É isso que permite a MESMA função rodar nos dois lados.
 *
 * ── VALOR: `r.valor`, não `valorDRE` ───────────────────────────────────────
 * Como em Centros de Custo e ao contrário da DRE. Preservado.
 */

export interface PontoMensal {
  /** Rótulo já formatado (`mLbl`) — o eixo X do gráfico consome assim. */
  mes: string
  receita: number
  despesa: number
  resultado: number
}

export interface LinhaMM {
  ym: string
  mes: string
  rec: number
  desp: number
  res: number
  /** Variação vs mês anterior, em %. null quando a base é 0. */
  varRec: number | null
  varDesp: number | null
  varRes: number | null
  /** Variação vs mesmo mês do ano anterior, em %. null quando a base é 0. */
  varYoYRec: number | null
  varYoYDesp: number | null
  varYoYRes: number | null
  /** Havia dado no mesmo mês do ano anterior? Controla a coluna YoY na tela. */
  hasYoY: boolean
}

export interface YtdComparativo {
  rec: number
  desp: number
  res: number
  /** null quando a receita é 0 — a tela mostra '—'. */
  margem: number | null
}

/** mês → l1 → l2 → l3 → valor assinado. Alimenta o comparador mês×mês. */
export type HierPorMes = Record<string, Record<string, Record<string, Record<string, number>>>>

export interface ComparativoAgg {
  /** 'YYYY-MM' do período, ordenados. Derivados de `op`, não de `allOp`. */
  months: string[]
  monthly: PontoMensal[]
  mmTable: LinhaMM[]
  ytd: YtdComparativo
  hierPorMes: HierPorMes
}

/** 'YYYY-MM' do lançamento. Aceita `data_ym`, string ou Date. */
function ymOf(r: Lancamento): string | null {
  if (r.data_ym) return r.data_ym
  const d = r.data as unknown
  if (!d) return null
  if (typeof d === 'string') return d.slice(0, 7)
  const dt = d as Date
  if (typeof dt.getFullYear !== 'function') return null
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}

/** O lançamento tem data? `filteredData` descarta os que não têm; `allData` não. */
function temData(r: Lancamento): boolean {
  return !!r.data
}

/** Soma receita e despesa de um mês. Sobre `r.valor`, sem sinal. */
function somaMes(porMes: Map<string, { rec: number; desp: number }>, ym: string) {
  return porMes.get(ym) ?? { rec: 0, desp: 0 }
}

function indexaPorMes(rs: readonly Lancamento[]): Map<string, { rec: number; desp: number }> {
  const m = new Map<string, { rec: number; desp: number }>()
  for (const r of rs) {
    const ym = ymOf(r)
    if (!ym) continue
    let e = m.get(ym)
    if (!e) { e = { rec: 0, desp: 0 }; m.set(ym, e) }
    if (r.tipo === 'Receita') e.rec += r.valor
    else e.desp += r.valor
  }
  return m
}

/**
 * Agrega o Comparativo.
 *
 * @param todos   equivalente a `allData` — o período SEM os 5 filtros.
 * @param filtros os 5 filtros do usuário, aplicados só ao conjunto `data`.
 */
export function aggComparativo(
  todos: readonly Lancamento[],
  filtros: FinanceiroFiltros,
  regime: string,
): ComparativoAgg {
  // `data` do componente = allData filtrado, descartando lançamento sem data —
  // é exatamente o que `useFinanceiro.filteredData` faz, nessa ordem.
  const dataProp = applyFiltros(todos.filter(temData), filtros)

  const op    = filtraOperacional(dataProp as Lancamento[], regime)
  const allOp = filtraOperacional(todos as Lancamento[], regime)

  // `months` sai de `op`: a tela sempre respeitou o período E os filtros aqui.
  const months = [...new Set(op.map(ymOf).filter((x): x is string => !!x))].sort()

  const porMesOp    = indexaPorMes(op)
  const porMesAllOp = indexaPorMes(allOp)

  const monthly: PontoMensal[] = months.map(ym => {
    const { rec, desp } = somaMes(porMesOp, ym)
    return { mes: mLbl(ym), receita: rec, despesa: desp, resultado: rec - desp }
  })

  const mmTable: LinhaMM[] = months.map((ym, i) => {
    const { rec, desp } = somaMes(porMesOp, ym)
    const res = rec - desp

    // M/M — mês anterior DA LISTA, não do calendário. Se o período tem buraco,
    // o "anterior" é o mês visível anterior. Comportamento atual, preservado.
    const ant = i > 0 ? somaMes(porMesOp, months[i - 1]) : { rec: 0, desp: 0 }
    const prevRes = ant.rec - ant.desp
    const varRec  = ant.rec  > 0   ? ((rec  - ant.rec)  / ant.rec)            * 100 : null
    const varDesp = ant.desp > 0   ? ((desp - ant.desp) / ant.desp)           * 100 : null
    const varRes  = prevRes  !== 0 ? ((res  - prevRes)  / Math.abs(prevRes))  * 100 : null

    // YoY — mesmo mês do ano anterior, buscado em allOp (SEM filtros).
    const [yr, mo] = ym.split('-').map(Number)
    const py = somaMes(porMesAllOp, `${yr - 1}-${String(mo).padStart(2, '0')}`)
    const yoyRes = py.rec - py.desp
    const varYoYRec  = py.rec  > 0   ? ((rec  - py.rec)  / py.rec)           * 100 : null
    const varYoYDesp = py.desp > 0   ? ((desp - py.desp) / py.desp)          * 100 : null
    const varYoYRes  = yoyRes  !== 0 ? ((res  - yoyRes)  / Math.abs(yoyRes)) * 100 : null

    return {
      ym, mes: mLbl(ym), rec, desp, res,
      varRec, varDesp, varRes,
      varYoYRec, varYoYDesp, varYoYRes,
      hasYoY: py.rec > 0 || py.desp > 0,
    }
  })

  const ytdRec  = mmTable.reduce((s, r) => s + r.rec, 0)
  const ytdDesp = mmTable.reduce((s, r) => s + r.desp, 0)
  const ytdRes  = ytdRec - ytdDesp
  const ytd: YtdComparativo = {
    rec: ytdRec, desp: ytdDesp, res: ytdRes,
    margem: ytdRec > 0 ? (ytdRes / ytdRec) * 100 : null,
  }

  // Hierarquia de TODOS os meses. O seletor mês1/mês2 é estado de UI: mandando
  // a árvore inteira, trocar de mês não refaz requisição.
  const hierPorMes: HierPorMes = {}
  for (const r of op) {
    const ym = ymOf(r)
    if (!ym) continue
    const { l1, l2 } = parseCatHier(r.cat1)
    const l3 = r.cat1 || l2
    const sign = r.tipo === 'Receita' ? 1 : -1
    const m = (hierPorMes[ym] ??= {})
    const a = (m[l1] ??= {})
    const b = (a[l2] ??= {})
    b[l3] = (b[l3] ?? 0) + sign * r.valor
  }

  return { months, monthly, mmTable, ytd, hierPorMes }
}

// ── Comparação mês1 × mês2 ───────────────────────────────────────────────────

export interface NoComparacaoL3 { l3: string; v1: number; v2: number }
export interface NoComparacaoL2 { l2: string; v1: number; v2: number; children: NoComparacaoL3[] }
export interface NoComparacaoL1 { l1: string; v1: number; v2: number; children: NoComparacaoL2[] }

/** Cópia local de numPrefix (Comparativo.tsx) — mesma semântica. */
function numPrefix(s: string): number {
  const m = s.match(/^([\d.]+)/)
  return m ? parseFloat(m[1]) : 999
}

/**
 * Monta a hierarquia comparativa entre dois meses a partir de `hierPorMes`.
 *
 * Fica separada da agregação de propósito: `mes1`/`mes2` são estado de UI, e o
 * componente chama esta função nos DOIS caminhos da flag, sobre o mesmo
 * `hierPorMes` — vindo do servidor ou calculado no browser. A união de chaves
 * (um nível existir só num dos meses) é preservada: o nó aparece com 0 do lado
 * que não tem.
 */
export function comparaMeses(
  hierPorMes: HierPorMes,
  mes1: string,
  mes2: string,
): NoComparacaoL1[] {
  const m1 = hierPorMes[mes1] ?? {}
  const m2 = hierPorMes[mes2] ?? {}
  const l1s = [...new Set([...Object.keys(m1), ...Object.keys(m2)])]

  return l1s.sort((a, b) => numPrefix(a) - numPrefix(b)).map(l1 => {
    const a1 = m1[l1] ?? {}
    const a2 = m2[l1] ?? {}
    const l2s = [...new Set([...Object.keys(a1), ...Object.keys(a2)])]

    const children = l2s.sort((a, b) => numPrefix(a) - numPrefix(b)).map(l2 => {
      const b1 = a1[l2] ?? {}
      const b2 = a2[l2] ?? {}
      const l3s = [...new Set([...Object.keys(b1), ...Object.keys(b2)])]

      const netos = l3s.sort((a, b) => numPrefix(a) - numPrefix(b)).map(l3 => ({
        l3, v1: b1[l3] ?? 0, v2: b2[l3] ?? 0,
      }))
      return {
        l2,
        v1: netos.reduce((s, x) => s + x.v1, 0),
        v2: netos.reduce((s, x) => s + x.v2, 0),
        children: netos,
      }
    })

    return {
      l1,
      v1: children.reduce((s, x) => s + x.v1, 0),
      v2: children.reduce((s, x) => s + x.v2, 0),
      children,
    }
  })
}
