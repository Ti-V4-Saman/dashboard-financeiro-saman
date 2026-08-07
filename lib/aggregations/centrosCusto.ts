import { filtraOperacional } from '@/lib/financeiro/regime'
import { applyFiltros, type FinanceiroFiltros } from '@/lib/financeiro-filtros'
import { protegerDetalheFolha } from '@/lib/folha'
import type { Lancamento } from '@/lib/types'

/**
 * Agregação de Centros de Custo — resumo e detalhe. Funções PURAS, sem I/O.
 *
 * Mesmo padrão dos blocos anteriores: o cálculo sai do componente para cá e os
 * DOIS caminhos da flag AGG_BACKEND chamam estas funções. OFF roda no browser
 * sobre o array cru; ON roda no servidor. Uma implementação só.
 *
 * ── DUAS REGRAS QUE DIFEREM DA DRE, preservadas de propósito ────────────────
 *
 *   • O valor é `r.valor`, NÃO `r.valorDRE`. A DRE usa valorDRE porque precisa
 *     do realizado em pagamentos parciais; esta tela sempre usou o valor de
 *     face. Trocar aqui mudaria número na tela — e mudaria só aqui, criando
 *     divergência silenciosa entre duas telas que hoje concordam por acaso.
 *
 *   • Um lançamento é contado em CADA centro de custo do seu `_ccList`, com o
 *     valor CHEIO em cada um. Não há rateio. Se um dia um lançamento tiver dois
 *     CCs, a soma das linhas passa do total do período — é o comportamento
 *     atual, e o loop aninhado abaixo o preserva. Hoje `normalizeRow` cria no
 *     máximo um item por lançamento, então na prática não acontece.
 *
 * `(em branco)` é descartado dos dois lados (resumo e detalhe): a tela nunca
 * mostrou um CC vazio como se fosse um centro de custo real.
 *
 * ── ESTADO DE UI FICA NO COMPONENTE ────────────────────────────────────────
 * A busca textual da tabela (`search`) não entra aqui. O servidor devolve todos
 * os centros; filtrar e reordenar por nome é decisão de tela e não deve custar
 * uma requisição.
 */

export interface CentroCustoItem {
  nome: string
  rec: number
  desp: number
  /** rec − desp. Positivo = centro superavitário. */
  resultado: number
}

export interface KpiGrupoCC {
  label: string
  rec: number
  desp: number
  resultado: number
  /** Quantos centros casaram com o grupo. Grupos com 0 não são devolvidos. */
  count: number
}

/** Ponto de barra do recharts — o formato que os gráficos já consomem. */
export interface PontoBarraCC {
  name: string
  value: number
}

export interface CentrosCustoAgg {
  /** Todos os centros, ordenados por despesa decrescente. */
  centros: CentroCustoItem[]
  kpiGroups: KpiGrupoCC[]
  graficos: {
    receitas: PontoBarraCC[]
    despesas: PontoBarraCC[]
    resultado: PontoBarraCC[]
  }
  /**
   * Somatórios sobre `centros`. A tela não exibe isto hoje — entra no contrato
   * como conveniência e para dar um invariante fácil de checar em teste.
   */
  totais: {
    receita: number
    despesa: number
    resultado: number
    quantidadeCC: number
  }
}

/**
 * Os 5 grupos fixos de KPI. A associação é por PREDICADO sobre o nome em
 * minúsculas — foi assim que a tela nasceu, e o nome do centro é o único dado
 * disponível para agrupar. Mantido literal para não mudar a tela.
 */
const GRUPOS_KPI: { label: string; match: (n: string) => boolean }[] = [
  { label: 'Administrativo',       match: n => n.toLowerCase().startsWith('administrativo') },
  { label: 'Operação',             match: n => n.toLowerCase().startsWith('operação') || n.toLowerCase().startsWith('operacao') },
  { label: 'People & Performance', match: n => n.toLowerCase().includes('people') },
  { label: 'Aquisição e Expansão', match: n => n.toLowerCase().includes('venda') || n.toLowerCase().includes('monetização') || n.toLowerCase().includes('monetizacao') },
  { label: 'Tecnologia',           match: n => n.toLowerCase().startsWith('tecnologia') },
]

/** O centro de custo conta? Espelha o guard do loop original. */
function ccValido(nome: string | null | undefined): boolean {
  return !!nome && nome !== '(em branco)'
}

export function aggCentrosCusto(
  cru: readonly Lancamento[],
  filtros: FinanceiroFiltros,
  regime: string,
): CentrosCustoAgg {
  const op = filtraOperacional(applyFiltros(cru, filtros), regime)

  // Map preserva ordem de inserção, e `Array.prototype.sort` é estável desde o
  // ES2019. Como os dois caminhos percorrem `op` na mesma ordem, empates em
  // `desp` saem na mesma ordem nos dois — daí a paridade de ordenação.
  const mapa = new Map<string, { rec: number; desp: number }>()
  for (const r of op) {
    for (const c of r._ccList) {
      if (!ccValido(c.nome)) continue
      let e = mapa.get(c.nome)
      if (!e) { e = { rec: 0, desp: 0 }; mapa.set(c.nome, e) }
      if (r.tipo === 'Receita') e.rec += r.valor
      else e.desp += r.valor
    }
  }

  const centros: CentroCustoItem[] = [...mapa.entries()]
    .map(([nome, { rec, desp }]) => ({ nome, rec, desp, resultado: rec - desp }))
    .sort((a, b) => b.desp - a.desp)

  const kpiGroups: KpiGrupoCC[] = GRUPOS_KPI
    .map(g => {
      const ccs = centros.filter(c => g.match(c.nome))
      const rec = ccs.reduce((s, c) => s + c.rec, 0)
      const desp = ccs.reduce((s, c) => s + c.desp, 0)
      return { label: g.label, rec, desp, resultado: rec - desp, count: ccs.length }
    })
    .filter(g => g.count > 0)

  // Os três recortes de gráfico. `receitas` filtra `> 0` e os outros dois não —
  // assimetria do componente original, preservada.
  const top = (
    ordena: (a: CentroCustoItem, b: CentroCustoItem) => number,
    valor: (c: CentroCustoItem) => number,
    filtra?: (c: CentroCustoItem) => boolean,
  ): PontoBarraCC[] => {
    const l = [...centros].sort(ordena)
    return (filtra ? l.filter(filtra) : l).slice(0, 15).map(c => ({ name: c.nome, value: valor(c) }))
  }

  return {
    centros,
    kpiGroups,
    graficos: {
      receitas:  top((a, b) => b.rec - a.rec, c => c.rec, c => c.rec > 0),
      despesas:  top((a, b) => b.desp - a.desp, c => c.desp),
      resultado: top((a, b) => b.resultado - a.resultado, c => c.resultado),
    },
    totais: {
      receita:   centros.reduce((s, c) => s + c.rec, 0),
      despesa:   centros.reduce((s, c) => s + c.desp, 0),
      resultado: centros.reduce((s, c) => s + c.resultado, 0),
      quantidadeCC: centros.length,
    },
  }
}

// ── Detalhe por centro de custo ──────────────────────────────────────────────

/** Linha do modal. Exatamente as colunas que a tabela renderiza, nada além. */
export interface CCDetalheRow {
  desc: string
  contraparte: string
  categoria: string
  tipo: 'Receita' | 'Despesa'
  valor: number
}

export interface CCDetalheResp {
  cc: string
  /** Recorte de tipo quando o usuário clicou numa barra de Receita ou Despesa. */
  tipo: 'Receita' | 'Despesa' | null
  rows: CCDetalheRow[]
  totais: { rec: number; desp: number; resultado: number }
  /** true se alguma linha teve contraparte/descrição mascaradas. */
  dadosProtegidos: boolean
}

/**
 * Detalhe de um centro de custo, já protegido.
 *
 * REUSA `filtraOperacional` — a mesma função que produz a barra —, então a soma
 * do modal fecha com a célula por construção, não por coincidência. Era essa a
 * intenção do comentário original em `detalhePorCC`, e ela é preservada.
 *
 * O nome do centro NUNCA entra em SQL: a consulta é a de `fetchLancamentos`,
 * parametrizada só por datas. Aqui ele é usado em comparação de igualdade
 * dentro do JS, contra `_ccList[].nome`. Centro inexistente devolve lista
 * vazia, que é exatamente o que o caminho legado faz — e não 404, porque o
 * usuário pode ter o modal aberto enquanto troca o filtro de período.
 */
export function aggDetalheCC(
  cru: readonly Lancamento[],
  filtros: FinanceiroFiltros,
  regime: string,
  cc: string,
  tipo: 'Receita' | 'Despesa' | null,
  podeVerFolhaDetalhada: boolean,
): CCDetalheResp {
  const brutas: CCDetalheRow[] = filtraOperacional(applyFiltros(cru, filtros), regime)
    .filter(r => r._ccList.some(c => ccValido(c.nome) && c.nome === cc))
    .filter(r => !tipo || r.tipo === tipo)
    .map(r => ({
      desc: r.desc,
      contraparte: r.fornecedor,
      categoria: r.cat1,
      tipo: r.tipo,
      valor: r.valor,
    }))
    .sort((a, b) => b.valor - a.valor)

  // `protegerDetalheFolha` decide por `categoria` e mascara `contraparte`/`desc`
  // — os mesmos nomes de campo que esta linha usa, então reusa direto o
  // protetor do detalhe da DRE. Uma regra só para as duas telas.
  const { rows, dadosProtegidos } = protegerDetalheFolha(brutas, podeVerFolhaDetalhada)

  // Totais sobre as linhas ORIGINAIS: o mascaramento não altera valor.
  let rec = 0, desp = 0
  for (const l of brutas) {
    if (l.tipo === 'Receita') rec += l.valor
    else desp += l.valor
  }

  return { cc, tipo, rows, totais: { rec, desp, resultado: rec - desp }, dadosProtegidos }
}
