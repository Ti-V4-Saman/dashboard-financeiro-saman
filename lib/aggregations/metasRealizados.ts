import type { Lancamento } from '@/lib/types'

/**
 * Realizado financeiro que a tela de Metas cruza com as metas cadastradas.
 *
 * Função PURA, chamada pelos DOIS caminhos da flag. OFF roda no browser sobre
 * `allData`; ON roda no servidor.
 *
 * ── O QUE ESTA AGREGAÇÃO É, E O QUE NÃO É ──────────────────────────────────
 * Devolve só o REALIZADO — números que saem dos lançamentos. NÃO devolve meta
 * nenhuma: metas vivem em `ca.metas`, têm tela própria e permissão própria, e
 * misturar as duas coisas num payload só é como se vaza meta para quem não
 * pode ver. Quem tem a tela `metas` busca as metas por `/api/metas`, como já
 * faz; este endpoint responde a quem tem `metas` e devolve apenas o realizado
 * com que ela vai cruzar.
 *
 * ── REGRA DE "REALIZADO", diferente de todas as outras telas ────────────────
 * `isRealizado` não é `filtraOperacional`:
 *
 *   competência → tudo menos Cancelado e Renegociado (inclui Aberto/Atrasado)
 *   caixa       → SOMENTE Quitado
 *
 * Em caixa isso é mais restrito que `filtraOperacional`, que aceita Parcial.
 * É a definição que a tela de Metas sempre usou; mexer aqui mudaria o
 * percentual de atingimento de toda meta cadastrada.
 *
 * ── COMPARAÇÃO DE NOMES É case-insensitive ─────────────────────────────────
 * A meta guarda o nome do centro de custo ou da categoria como texto digitado,
 * e o cruzamento sempre foi por `toLowerCase()`. Preservado: tornar sensível a
 * maiúscula quebraria metas já cadastradas.
 *
 * ── DATAS: string ──────────────────────────────────────────────────────────
 * O componente usava `r.data.getFullYear()/getMonth()`; aqui é `data_ym`, que
 * já foi provado equivalente no Bloco G (0 divergências em 9238 lançamentos) e
 * dispensa Date no servidor.
 */

export type Regime = 'competencia' | 'caixa'

/** Chave de uma meta, do jeito que ela identifica o que quer medir. */
export interface ChaveMeta {
  /** 'YYYY-MM' */
  mes_referencia: string
  tipo_lancamento: 'Receita' | 'Despesa'
  tipo: 'centro_de_custo' | string
  centro_de_custo?: string | null
  categoria_nivel_3?: string | null
  categoria?: string | null
}

export interface MetasRealizadosAgg {
  /** Realizado por meta, na MESMA ordem das chaves recebidas. */
  realizados: number[]
  /** Receita realizada no período — o KPI de faturamento da tela. */
  faturamento: number
  /** Realizado assinado por cat1, no período. Alimenta a hierarquia. */
  porCategoria: Record<string, number>
}

/** competência: tudo menos Cancelado/Renegociado. caixa: só Quitado. */
export function isRealizado(situacao: string, isCaixa: boolean): boolean {
  if (isCaixa) return situacao === 'Quitado'
  return situacao !== 'Cancelado' && situacao !== 'Renegociado'
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

/** 'YYYY-MM-DD' do lançamento, para o recorte por intervalo. */
function ymdOf(r: Lancamento): string | null {
  const d = r.data as unknown
  if (!d) return null
  if (typeof d === 'string') return (d as string).slice(0, 10)
  const dt = d as Date
  if (typeof dt.getFullYear !== 'function') return null
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export function aggMetasRealizados(
  todos: readonly Lancamento[],
  chaves: readonly ChaveMeta[],
  regime: Regime,
  periodo: { de: string; ate: string },
): MetasRealizadosAgg {
  const isCaixa = regime === 'caixa'

  // Base comum: exclui transferência e aplica a regra de realizado do regime.
  const base = todos.filter(r => !r.isTransfer && r.data && isRealizado(r.situacao, isCaixa))

  // Índice por mês para não varrer o array uma vez por meta.
  const porMes = new Map<string, Lancamento[]>()
  for (const r of base) {
    const ym = ymOf(r)
    if (!ym) continue
    const a = porMes.get(ym)
    if (a) a.push(r); else porMes.set(ym, [r])
  }

  const realizados = chaves.map(m => {
    const linhas = porMes.get(m.mes_referencia)
    if (!linhas) return 0
    const alvo = (m.tipo === 'centro_de_custo'
      ? (m.centro_de_custo || '')
      : (m.categoria_nivel_3 || m.categoria || '')).toLowerCase()
    let s = 0
    for (const r of linhas) {
      if (r.tipo !== m.tipo_lancamento) continue
      const campo = (m.tipo === 'centro_de_custo' ? (r.cc1 || '') : (r.cat1 || '')).toLowerCase()
      if (campo !== alvo) continue
      s += r.valor
    }
    return s
  })

  // Faturamento e realizado por categoria: recorte pelo período selecionado.
  // O componente comparava Date contra `new Date(dateTo + 'T23:59:59')`, ou
  // seja, o dia final INCLUSIVE — em string isso é simplesmente `<= ate`.
  let faturamento = 0
  const porCategoria: Record<string, number> = {}
  for (const r of base) {
    const d = ymdOf(r)
    if (!d || d < periodo.de || d > periodo.ate) continue
    if (r.tipo === 'Receita') faturamento += r.valor
    if (r.cat1) {
      const sign = r.tipo === 'Receita' ? 1 : -1
      porCategoria[r.cat1] = (porCategoria[r.cat1] ?? 0) + sign * r.valor
    }
  }

  return { realizados, faturamento, porCategoria }
}
