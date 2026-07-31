import { filtraOperacional } from '@/lib/financeiro/regime'
import { applyFiltros, type FinanceiroFiltros } from '@/lib/financeiro-filtros'
import { asArray } from '@/lib/fetchJson'
import { parseCatHier } from '@/lib/utils'
import type { Lancamento, Meta } from '@/lib/types'

/**
 * Agregação do Resumo Trimestral — função PURA, sem I/O.
 *
 * POR QUE ESTE MÓDULO EXISTE
 * O cálculo saiu do widget para cá para que os DOIS caminhos da flag
 * AGG_BACKEND chamem exatamente o mesmo código:
 *
 *   OFF → o widget baixa o array cru e chama `aggResumoTrimestral` no browser
 *   ON  → a rota /api/agg/resumo-trimestral chama a MESMA função no servidor
 *
 * Isso torna a paridade numérica estrutural em vez de coincidência: não há
 * duas implementações para divergirem.
 *
 * REGIME
 * Este card é SEMPRE competência, independente do seletor do dash — é uma
 * projeção de M-1..M+2, e o filtro de data do dash não cobre M+1/M+2. Por isso
 * `prepararDados` fixa 'competencia' ao chamar filtraOperacional.
 *
 * NÃO DUPLICA REGRA
 * As regras de ouro (excluir transferência e Cancelado/Renegociado) vêm de
 * `filtraOperacional`; os 5 filtros do usuário vêm de `applyFiltros`. O widget
 * antes inlinava as duas coisas — a inline era equivalente a
 * `filtraOperacional(data, 'competencia')`, porque a exclusão de Parcial só
 * acontece em caixa.
 *
 * METAS
 * `metas: Meta[] | null`. `null` significa SEM PERMISSÃO — e produz
 * `meta: null` em todas as linhas, nunca zero. Zero é um valor legítimo
 * ("meta cadastrada como 0"); usá-lo para representar ausência de permissão
 * misturaria as duas coisas.
 */

export type LinhaKind = 'receita' | 'despesa' | 'subtotal' | 'resultado'

export interface LinhaCalc {
  id: string
  label: string
  total: number
  /** Signed (negativo para despesas). `null` = usuário sem acesso a Metas. */
  meta: number | null
  kind: LinhaKind
  delta: boolean
}

export interface MesCalc {
  ym: string
  hasData: boolean
  linhas: LinhaCalc[]
}

export interface MesesRef {
  ant: string
  ref: string
  m1: string
  m2: string
}

export interface ResumoTrimestralAgg {
  meses: { ant: MesCalc; ref: MesCalc; m1: MesCalc; m2: MesCalc }
  /** Reflete a autorização EFETIVA calculada no servidor, não o pedido do client. */
  metasDisponiveis: boolean
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

/**
 * Regras de ouro + filtros do usuário, na ordem que o dashboard usa.
 * Não muta a entrada: filtraOperacional e applyFiltros devolvem novos arrays.
 */
export function prepararDados(
  data: readonly Lancamento[],
  filtros: FinanceiroFiltros,
): Lancamento[] {
  return applyFiltros(filtraOperacional(asArray<Lancamento>(data), 'competencia'), filtros)
}

/**
 * Linhas da DRE para um mês.
 *
 * `excludeBaixados=true` filtra situacao === 'Quitado'. Usado para meses
 * FUTUROS (M+1, M+2): em projeção, lançamentos já baixados pertencem ao mês em
 * que foram pagos (caixa), não ao mês de competência futuro — evita
 * double-counting com a visão de caixa realizado. O mês de referência mantém
 * competência completa.
 *
 * Cálculo idêntico ao que rodava no widget, movido sem alteração.
 */
export function calcMes(
  ym: string,
  data: readonly Lancamento[],
  metas: readonly Meta[] | null,
  excludeBaixados: boolean = false,
): MesCalc {
  if (!ym) return { ym: '', hasData: false, linhas: [] }

  const rows = asArray<Lancamento>(data).filter(r => {
    if (r.data_ym !== ym) return false
    if (excludeBaixados && r.situacao === 'Quitado') return false
    return true
  })

  // metas === null → sem permissão. Não há metasMes, e toda meta sai null.
  const semMetas = metas === null
  const metasMes = semMetas ? [] : asArray<Meta>(metas).filter(m => m.mes_referencia === ym)

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

  /** Sem permissão → null. Com permissão → o número calculado (0 inclusive). */
  const m = (v: number): number | null => (semMetas ? null : v)

  const linhas: LinhaCalc[] = [
    { id: 'rec_op',  label: '1 — Rec. Operacionais', total: totalRecOp,   meta: m(metaRecOp),   kind: 'receita',   delta: true  },
    { id: 'ded',     label: '2 — Deduções',          total: totalDed,     meta: m(metaDed),     kind: 'despesa',   delta: false },
    { id: 'rol',     label: '(=) Rec. Op. Líquida',  total: totalROL,     meta: m(metaROL),     kind: 'subtotal',  delta: false },
    { id: 'cu',      label: '3 — Custos Operac.',    total: totalCusto,   meta: m(metaCusto),   kind: 'despesa',   delta: false },
    { id: 'lb',      label: '(=) Lucro Bruto',       total: totalLB,      meta: m(metaLB),      kind: 'subtotal',  delta: true  },
    { id: 'desp',    label: '4 — Despesas',          total: totalDesp,    meta: m(metaDesp),    kind: 'despesa',   delta: false },
    { id: 'ebitda',  label: '(=) EBITDA',            total: totalEBITDA,  meta: m(metaEBITDA),  kind: 'subtotal',  delta: true  },
    { id: 'recf',    label: '6.1 — Rec. Financeira', total: totalRecFin,  meta: m(metaRecFin),  kind: 'receita',   delta: false },
    { id: 'despf',   label: '6.2 — Desp. Financeira',total: totalDespFin, meta: m(metaDespFin), kind: 'despesa',   delta: false },
    { id: 'outros',  label: 'Outros',                total: totalOutros,  meta: m(metaOutros),  kind: 'despesa',   delta: false },
    { id: 'll',      label: '(=) Lucro Líquido',     total: totalLL,      meta: m(metaLL),      kind: 'resultado', delta: true  },
  ]

  // hasData preservado: meta null não conta como dado (antes era 0, que também
  // não contava). Comportamento visual idêntico.
  const hasData = linhas.some(l => l.total !== 0 || (l.meta !== null && l.meta !== 0))
  return { ym, hasData, linhas }
}

/**
 * Os 4 meses do card. `metas === null` → metasDisponiveis false e toda meta null.
 *
 * Mês de referência e M-1: competência completa (inclui Quitado).
 * M+1 e M+2: competência menos baixados.
 */
export function aggResumoTrimestral(
  data: readonly Lancamento[],
  metas: readonly Meta[] | null,
  meses: MesesRef,
): ResumoTrimestralAgg {
  return {
    meses: {
      ant: calcMes(meses.ant, data, metas, false),
      ref: calcMes(meses.ref, data, metas, false),
      m1:  calcMes(meses.m1,  data, metas, true),
      m2:  calcMes(meses.m2,  data, metas, true),
    },
    metasDisponiveis: metas !== null,
  }
}
