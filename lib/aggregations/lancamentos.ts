import { applyFiltros, type FinanceiroFiltros } from '@/lib/financeiro-filtros'
import type { Lancamento } from '@/lib/types'

/**
 * Agregação da tela de Lançamentos — busca, ordenação e paginação.
 *
 * Mesmo padrão dos blocos anteriores: função PURA, chamada pelos DOIS caminhos
 * da flag. OFF roda no browser sobre o array da prop; ON roda no servidor.
 *
 * ── ESTA TELA NÃO USA filtraOperacional ────────────────────────────────────
 * Todas as outras telas passam por `filtraOperacional`, que além de excluir
 * transferência também derruba Cancelado, Renegociado e o Parcial em caixa.
 * Lançamentos NÃO faz isso: exclui só `isTransfer`. É uma tela de conferência,
 * e esconder um lançamento cancelado dela seria esconder justamente o que o
 * usuário veio procurar. Comportamento atual, preservado — e é por isso que os
 * totais daqui não batem com os da DRE.
 *
 * ── BUSCA E PROTEÇÃO DE FOLHA ──────────────────────────────────────────────
 * A busca varre `desc` e `fornecedor`, que são exatamente os dois campos que a
 * proteção mascara. A regra aqui é: **mascarar primeiro, buscar depois**.
 *
 * Consequências, todas deliberadas:
 *
 *   • Quem NÃO tem `ver_folha_detalhe` busca sobre o texto que ele está
 *     autorizado a enxergar. Digitar o nome de uma pessoa não retorna nada —
 *     nem uma linha mascarada, nem uma contagem diferente de zero. Não existe
 *     canal lateral: o predicado nunca toca o valor original.
 *
 *   • Quem TEM a permissão busca sobre o texto real, como sempre.
 *
 *   • Buscar por "Dados protegidos" encontra as linhas protegidas. Isso não
 *     revela nada — é o texto que já está na tela dele.
 *
 * Isto não é uma escolha nova: com a proteção central publicada, o array que
 * chega ao browser já vem mascarado, então a busca do caminho legado JÁ se
 * comporta assim. A função apenas reproduz o mesmo no servidor.
 */

export type SortKey = 'data' | 'valor'
export type SortDir = 'asc' | 'desc'

/** Allowlist de ordenação. Nada fora daqui é aceito — nunca um campo do cliente. */
export const SORT_KEYS: readonly SortKey[] = ['data', 'valor'] as const
export const SORT_DIRS: readonly SortDir[] = ['asc', 'desc'] as const

export function isSortKey(v: string): v is SortKey {
  return (SORT_KEYS as readonly string[]).includes(v)
}
export function isSortDir(v: string): v is SortDir {
  return (SORT_DIRS as readonly string[]).includes(v)
}

export const PAGE_SIZE_PADRAO = 50
/** Teto de página. Impede que o cliente peça o array inteiro por `pageSize`. */
export const PAGE_SIZE_MAX = 200

/** Uma linha da tabela. Exatamente as 11 colunas renderizadas, nada além. */
export interface LancamentoRow {
  /** 'YYYY-MM-DD' — formato estável, sem timezone. */
  data: string | null
  desc: string
  fornecedor: string
  tipo: 'Receita' | 'Despesa'
  conta: string
  forma: string
  valor: number
  situacao: string
  cat1: string
  /** Supergrupo exibido acima da categoria na mesma célula. */
  catSup: string
  cc1: string
  origem: string
}

export interface LancamentosAgg {
  rows: LancamentoRow[]
  page: number
  pageSize: number
  /** Total de linhas APÓS busca e filtro local — a base da barra de resumo. */
  total: number
  totalPages: number
  /** Somatórios sobre TODAS as linhas filtradas, não só a página. */
  totais: { rec: number; desp: number; resultado: number }
  /** Opções do select local de conta, derivadas do conjunto sem busca. */
  contas: string[]
}

export interface LancamentosParams {
  /** Busca textual. Vazio = sem busca. */
  q: string
  /** Conta escolhida no select LOCAL da tela. Vazio = todas. */
  contaSel: string
  sort: SortKey
  dir: SortDir
  page: number
  pageSize: number
}

/** 'YYYY-MM-DD' a partir de Date (componentes locais) ou string. */
function ymd(d: unknown): string | null {
  if (!d) return null
  if (typeof d === 'string') return d.slice(0, 10)
  const dt = d as Date
  if (typeof dt.getFullYear !== 'function') return null
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** Ordenável de data: 'YYYY-MM-DD' compara lexicograficamente como cronológico. */
function chaveData(d: unknown): string {
  return ymd(d) ?? ''
}

export function aggLancamentos(
  cru: readonly Lancamento[],
  filtros: FinanceiroFiltros,
  params: LancamentosParams,
): LancamentosAgg {
  // Os 5 filtros globais e, depois, a única exclusão desta tela.
  const op = applyFiltros(cru, filtros).filter(r => !r.isTransfer)

  // Opções do select local: do conjunto ANTES da busca, como hoje. Assim a
  // lista de contas não encolhe enquanto o usuário digita.
  const contas = [...new Set(op.map(r => r.conta).filter(c => c && c !== '(em branco)'))].sort()

  let filtrado = op
  if (params.q) {
    const q = params.q.toLowerCase()
    // `desc` e `fornecedor` já vêm mascarados quando o usuário não pode ver —
    // o predicado nunca enxerga o original. Ver nota no topo.
    filtrado = filtrado.filter(r =>
      r.desc.toLowerCase().includes(q) ||
      r.fornecedor.toLowerCase().includes(q) ||
      r.cat1.toLowerCase().includes(q) ||
      r.conta.toLowerCase().includes(q) ||
      r.cc1.toLowerCase().includes(q))
  }
  if (params.contaSel) filtrado = filtrado.filter(r => r.conta === params.contaSel)

  // Totais sobre TUDO que passou nos filtros, não só a página visível.
  let rec = 0, desp = 0
  for (const r of filtrado) {
    if (r.tipo === 'Receita') rec += r.valor
    else desp += r.valor
  }

  // `sort` é estável (ES2019), e os dois caminhos percorrem o mesmo array na
  // mesma ordem — então empates saem iguais nos dois lados.
  const ordenado = [...filtrado].sort((a, b) => {
    if (params.sort === 'data') {
      const ka = chaveData(a.data), kb = chaveData(b.data)
      const cmp = ka < kb ? -1 : ka > kb ? 1 : 0
      return params.dir === 'desc' ? -cmp : cmp
    }
    return params.dir === 'desc' ? b.valor - a.valor : a.valor - b.valor
  })

  const pageSize = Math.min(Math.max(1, params.pageSize), PAGE_SIZE_MAX)
  const totalPages = Math.max(1, Math.ceil(ordenado.length / pageSize))
  const page = Math.min(Math.max(1, params.page), totalPages)

  const rows: LancamentoRow[] = ordenado
    .slice((page - 1) * pageSize, page * pageSize)
    .map(r => ({
      data: ymd(r.data),
      desc: r.desc,
      fornecedor: r.fornecedor,
      tipo: r.tipo,
      conta: r.conta,
      forma: r.forma,
      valor: r.valor,
      situacao: r.situacao,
      cat1: r.cat1,
      catSup: r.catSup,
      cc1: r.cc1,
      origem: r.origem,
    }))

  return {
    rows, page, pageSize,
    total: ordenado.length,
    totalPages,
    totais: { rec, desp, resultado: rec - desp },
    contas,
  }
}
