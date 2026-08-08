import { filtraOperacional, detalheDRE } from '@/lib/financeiro/regime'
import { protegerDetalheFolha } from '@/lib/folha'
import { parseCatHier, getL2Label } from '@/lib/utils'
import type { Lancamento } from '@/lib/types'

/**
 * Agregação da DRE — resumo e detalhe.
 *
 * ESTE ARQUIVO TEM DUAS METADES
 *   1. RESUMO   `aggResumoDRE` — hierarquia com valores, subtotais, série
 *      mensal, KPIs executivos e KPIs inferiores. Função PURA, chamada pelos
 *      DOIS caminhos da flag: com AGG_BACKEND off ela roda no browser sobre o
 *      array cru; com on, roda no servidor. Não existem duas implementações
 *      para divergirem.
 *   2. DETALHE  `aggDetalheDRE` — o Sheet de conferência, sob demanda.
 *
 * O QUE O RESUMO NÃO FAZ: decidir o que está expandido. `exp1`/`exp2` são
 * estado de UI e continuam no componente. O servidor devolve valor para TODO
 * nó da árvore; abrir e fechar não refaz requisição nem muda payload.
 *
 * SEGURANÇA — o motivo do detalhe existir
 * O detalhe expõe, por lançamento, `contraparte` (nome da pessoa) e `desc`
 * ("6/14 - Remuneração de Fulano"). Quem não tem `ver_folha_detalhe` recebe
 * esses dois campos mascarados nas linhas de folha, e só nelas. Valor, data,
 * categoria, CC, situação, conta e tipo passam intactos: os totais precisam
 * continuar conferindo com a célula da DRE que foi clicada.
 *
 * O MATCHER NUNCA VEM DO CLIENTE
 * O componente monta o matcher como função (`matcherForRow`), o que não
 * atravessa HTTP — e não deve mesmo. O cliente manda um `linhaId` de uma
 * ALLOWLIST fechada, e o servidor reconstrói o predicado. Nenhuma regex,
 * expressão, nome de coluna ou fragmento de SQL do cliente entra no caminho.
 */

// ── O limite de grupo, num lugar só ──────────────────────────────────────────

/**
 * Teto de prefixo do último subtotal (Lucro Líquido).
 *
 * Existe como constante porque o grupo `Outros` — o que `parseCatHier` devolve
 * para categoria fora do plano 1..7 — tem prefixo 999 e precisa ficar de fora.
 * `Outros` guarda movimentação patrimonial e de financiamento (distribuição de
 * lucros, aporte de capital, parcelas de empréstimo), que não é linha de DRE.
 */
export const LIMITE_GRUPO_DRE = 99

/**
 * O grupo L1 entra no subtotal até `maxPfx`?
 *
 * ESTA É A ÚNICA REGRA. `groupSum` a aplica sobre os rótulos da hierarquia para
 * calcular a CÉLULA; `matcherAteGrupo` a aplica sobre o lançamento para montar
 * o DETALHE. Enquanto as duas passarem por aqui, a linha clicada não pode
 * listar população diferente da que gerou o número — que foi exatamente o que
 * aconteceu enquanto Lucro Líquido usava `() => true`.
 */
export function grupoDentroDoLimite(l1: string, maxPfx: number): boolean {
  return numPrefix(l1) <= maxPfx
}

/** Versão por lançamento da mesma regra. */
export function matcherAteGrupo(maxPfx: number): (r: Lancamento) => boolean {
  return r => grupoDentroDoLimite(parseCatHier(r.cat1).l1, maxPfx)
}

// ── Allowlist de linhas ──────────────────────────────────────────────────────

/**
 * Subtotais: id fixo → predicado. Cada um espelha a fórmula que produz a
 * célula correspondente em `aggResumoDRE.subtotais`, e agora pelo mesmo
 * `grupoDentroDoLimite` — não por um número repetido de cada lado.
 */
const SUBTOTAIS: Record<string, (r: Lancamento) => boolean> = {
  __recLiq__:      matcherAteGrupo(2.99),
  __lubruto__:     matcherAteGrupo(3.99),
  __margContrib__: r => {
    const h = parseCatHier(r.cat1)
    return grupoDentroDoLimite(h.l1, 3.99) || (h.l1 === '4 — Despesas' && h.l2 === '4.1')
  },
  __ebitda__:   matcherAteGrupo(4.99),
  __ebit__:     matcherAteGrupo(5.99),
  __ebt__:      matcherAteGrupo(6.99),
  __lucroliq__: matcherAteGrupo(LIMITE_GRUPO_DRE),
}

export const SUBTOTAL_IDS = Object.keys(SUBTOTAIS)

/** Cópia local de numPrefix (DRE.tsx:71) — mesma semântica. */
function numPrefix(s: string): number {
  const m = (s || '').match(/^(\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) : 999
}

/**
 * Referência de linha aceita pelo endpoint de detalhe. Estrutura fechada:
 * ou é um subtotal da allowlist, ou é um nó da hierarquia identificado por
 * rótulos que o servidor compara por igualdade — nunca interpola em query.
 */
export type LinhaRef =
  | { kind: 'subtotal'; id: string }
  | { kind: 'l1'; l1: string }
  | { kind: 'l2'; l1: string; l2: string }
  | { kind: 'l3'; cat1: string }

/** Erro de validação de `linhaId` — o chamador transforma em 400. */
export class LinhaRefInvalida extends Error {}

/**
 * Interpreta o `linhaId` recebido. Formatos aceitos, e SÓ estes:
 *
 *   "__ebitda__"                    subtotal da allowlist
 *   "l1:<rótulo>"                   nível 1
 *   "l2:<rótuloL1>|<rótuloL2>"      nível 2
 *   "l3:<cat1>"                     nível 3 (categoria folha da árvore)
 *
 * Qualquer outra coisa lança. Note que mesmo os rótulos livres só são usados
 * em comparação de igualdade dentro do JS, jamais concatenados em SQL.
 */
export function parseLinhaId(linhaId: string): LinhaRef {
  const s = (linhaId || '').trim()
  if (!s) throw new LinhaRefInvalida('linhaId ausente')

  if (s.startsWith('__')) {
    // hasOwnProperty, NÃO `in`: `'__proto__' in {}` é true pela cadeia de
    // protótipos, e o `in` deixava passar '__proto__' como se fosse subtotal
    // válido — SUBTOTAIS['__proto__'] devolveria Object.prototype e o
    // chamador estouraria ao invocá-lo. Aqui vira 400, como deve ser.
    if (!Object.prototype.hasOwnProperty.call(SUBTOTAIS, s)) {
      throw new LinhaRefInvalida(`subtotal desconhecido: ${s}`)
    }
    return { kind: 'subtotal', id: s }
  }
  if (s.startsWith('l1:')) {
    const l1 = s.slice(3)
    if (!l1) throw new LinhaRefInvalida('l1 vazio')
    return { kind: 'l1', l1 }
  }
  if (s.startsWith('l2:')) {
    const [l1, l2] = s.slice(3).split('|')
    if (!l1 || !l2) throw new LinhaRefInvalida('l2 malformado')
    return { kind: 'l2', l1, l2 }
  }
  if (s.startsWith('l3:')) {
    const cat1 = s.slice(3)
    if (!cat1) throw new LinhaRefInvalida('l3 vazio')
    return { kind: 'l3', cat1 }
  }
  throw new LinhaRefInvalida('formato de linhaId não suportado')
}

/**
 * Inverso exato de `parseLinhaId`. Existe para o CLIENTE: o componente monta o
 * `LinhaRef` da linha clicada e precisa mandá-lo na query string do endpoint de
 * detalhe — matcher é função e não atravessa HTTP.
 *
 * NENHUMA REGRA NASCE AQUI. A allowlist de subtotais, os quatro níveis e o
 * separador são os mesmos objetos que `parseLinhaId` lê logo acima; esta função
 * só escreve o que aquela lê. O teste de round-trip
 * (`parseLinhaId(serializeLinhaRef(ref))` === ref) prova a simetria e quebra na
 * hora se alguém mexer em um lado só.
 *
 * Devolve `null` — em vez de uma string que não volta — quando o ref não é
 * serializável sem ambiguidade: subtotal fora da allowlist, campo vazio, ou
 * rótulo de L2 contendo o separador. O chamador trata `null` como "sem chave":
 * nenhuma requisição sai, e o 400 do servidor nunca chega a ser necessário.
 */
export function serializeLinhaRef(ref: LinhaRef): string | null {
  switch (ref.kind) {
    case 'subtotal':
      // Mesma checagem do parse, pelo mesmo motivo: '__proto__' não é subtotal.
      return Object.prototype.hasOwnProperty.call(SUBTOTAIS, ref.id) ? ref.id : null
    case 'l1':
      return ref.l1 ? `l1:${ref.l1}` : null
    case 'l2':
      if (!ref.l1 || !ref.l2) return null
      // `parseLinhaId` corta o l2 no primeiro '|'. Um rótulo que contivesse o
      // separador voltaria diferente do que saiu — hoje não acontece (os
      // rótulos são '4 — Despesas' e '4.1'), e recusar aqui mantém o
      // round-trip verdadeiro por construção, não por sorte.
      if (ref.l1.includes('|') || ref.l2.includes('|')) return null
      return `l2:${ref.l1}|${ref.l2}`
    case 'l3':
      return ref.cat1 ? `l3:${ref.cat1}` : null
  }
}

/** Reconstrói o predicado no SERVIDOR. Espelha linhaRefForRow (DRE.tsx). */
export function matcherFromLinhaRef(ref: LinhaRef): (r: Lancamento) => boolean {
  switch (ref.kind) {
    case 'subtotal': {
      // Segunda barreira: mesmo que um LinhaRef chegue por outro caminho que
      // não o parseLinhaId, só uma função própria da tabela é aceita.
      const f = Object.prototype.hasOwnProperty.call(SUBTOTAIS, ref.id)
        ? SUBTOTAIS[ref.id]
        : undefined
      return typeof f === 'function' ? f : () => false
    }
    case 'l1':
      return r => parseCatHier(r.cat1).l1 === ref.l1
    case 'l2':
      return r => {
        const h = parseCatHier(r.cat1)
        return h.l1 === ref.l1 && h.l2 === ref.l2
      }
    case 'l3':
      return r => r.cat1 === ref.cat1
  }
}

// ── Contrato do detalhe ──────────────────────────────────────────────────────

export interface DetalheRow {
  /** 'YYYY-MM-DD' — formato estável, sem timezone. */
  data: string | null
  desc: string
  contraparte: string
  cc: string
  categoria: string
  tipo: 'Receita' | 'Despesa'
  /** Assinado (+Receita, −Despesa), sobre valorDRE — como detalheDRE já faz. */
  valor: number
}

export interface DetalheDREResp {
  titulo: string
  total: number
  /** true se ao menos uma linha teve contraparte/desc mascaradas. */
  dadosProtegidos: boolean
  rows: DetalheRow[]
}

/** 'YYYY-MM-DD' a partir de Date (componentes locais) ou string. */
function ymd(d: unknown): string | null {
  if (!d) return null
  if (typeof d === 'string') return d.slice(0, 10)
  const dt = d as Date
  if (typeof dt.getFullYear !== 'function') return null
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/**
 * Detalhe de uma linha da DRE, já protegido.
 *
 * REUSA `detalheDRE` de lib/financeiro/regime.ts — não reimplementa a regra.
 * De lá vêm o filtro operacional, o recorte por mês, o sinal do valor (sobre
 * `valorDRE`) e a ordenação por |valor| decrescente. Aqui só normalizamos a
 * data para 'YYYY-MM-DD' e aplicamos o mascaramento.
 *
 * O contrato devolve EXATAMENTE as seis colunas que a tabela do Sheet
 * renderiza (data, desc, contraparte, cc, categoria, valor). `situacao` e
 * `conta` existem no lançamento mas não aparecem na tela, então não saem do
 * servidor — payload menor e uma superfície a menos para vazar.
 */
export function aggDetalheDRE(
  data: readonly Lancamento[],
  regime: string,
  ref: LinhaRef,
  mes: string | undefined,
  titulo: string,
  podeVerFolhaDetalhada: boolean,
): DetalheDREResp {
  const matcher = matcherFromLinhaRef(ref)

  // `detalheDRE` já devolve {data, desc, contraparte, cc, categoria, tipo,
  // valor} — o conjunto exato que o Sheet mostra. Só a data muda de forma.
  const brutas: DetalheRow[] = detalheDRE(data as Lancamento[], regime, matcher, mes)
    .map(l => ({
      data: ymd(l.data),
      desc: l.desc,
      contraparte: l.contraparte,
      cc: l.cc,
      categoria: l.categoria,
      tipo: l.tipo,
      valor: l.valor,
    }))

  const { rows, dadosProtegidos } = protegerDetalheFolha(brutas, podeVerFolhaDetalhada)

  return {
    titulo,
    // Total sobre as linhas ORIGINAIS: o mascaramento não altera valor.
    total: brutas.reduce((s, r) => s + r.valor, 0),
    dadosProtegidos,
    rows,
  }
}

// ── Resumo ───────────────────────────────────────────────────────────────────

/** Nó folha da árvore: uma categoria `cat1` inteira. */
export interface NoL3 {
  l3: string
  /** Valores por coluna, na ordem de `cols`. */
  vals: number[]
}

export interface NoL2 {
  l2: string
  /** Rótulo descritivo (`getL2Label`) — o que a tabela mostra. */
  label: string
  vals: number[]
  children: NoL3[]
}

export interface NoL1 {
  l1: string
  vals: number[]
  children: NoL2[]
}

/** As oito séries de subtotal, cada uma por coluna. */
export interface SubtotaisDRE {
  recBruta: number[]
  recLiq: number[]
  lucroBruto: number[]
  margContrib: number[]
  ebitda: number[]
  ebit: number[]
  ebt: number[]
  lucroLiq: number[]
}

/** KPIs executivos — os cards do topo. Acumulados do período. */
export interface ExecDRE {
  recOp: number
  recFin: number
  recBruta: number
  recLiq: number
  lubruto: number
  margContrib: number
  ebitda: number
  ebit: number
  lucroLiq: number
  /** null quando há menos de 2 meses ou o mês anterior fechou em zero. */
  growthRate: number | null
}

/** KPIs da faixa inferior. Todos acumulados. */
export interface KpisDRE {
  recOp: number
  recLiq: number
  lubruto: number
  margContrib: number
  ebitda: number
  ebit: number
  lucroLiq: number
  deducoes: number
  csp: number
  terceiros: number
  despCom: number
  despAdmin: number
  despGerais: number
  gastosPessoas: number
  despAquisicao: number
  leadBroker: number
  despExpansao: number
  proLabore: number
  growthRate: number | null
}

export interface ResumoDRE {
  /** 'YYYY-MM' ordenados. As colunas são [...meses, '__acc__']. */
  months: string[]
  hier: NoL1[]
  subtotais: SubtotaisDRE
  exec: ExecDRE
  kpis: KpisDRE
  /** Lançamentos operacionais no período. 0 → a tela mostra o estado vazio. */
  totalOperacional: number
}

/**
 * 'YYYY-MM' do lançamento.
 *
 * Prioriza `data_ym`, calculado no Postgres — sem ambiguidade de fuso. O
 * fallback aceita Date (caminho legado, onde `useFinanceiro` já converteu) e
 * string 'YYYY-MM-DD' (caminho servidor, onde `data` continua string). É essa
 * tolerância que permite a MESMA função rodar nos dois lados; `getMonths` de
 * lib/utils assume Date e quebraria no servidor.
 */
function ymOf(r: Lancamento): string | null {
  if (r.data_ym) return r.data_ym
  const d = r.data as unknown
  if (!d) return null
  if (typeof d === 'string') return d.slice(0, 7)
  const dt = d as Date
  if (typeof dt.getFullYear !== 'function') return null
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Resumo completo da DRE. Função pura, sem I/O e sem React.
 *
 * Espelha, na ordem, o que o componente fazia: `filtraOperacional` → `vm`
 * (mês → l1 → l2 → l3 → valor assinado) → `hier` ordenada por prefixo numérico
 * → getters → subtotais → exec → kpis.
 *
 * DUAS SUTILEZAS PRESERVADAS DE PROPÓSITO
 *
 *   • `vm` ignora lançamento sem data; `hier` NÃO. Uma categoria que só tem
 *     lançamento sem data aparece na árvore com todos os valores zerados. É o
 *     comportamento atual e mexer nisso mudaria a tela.
 *
 *   • O sinal vem de `valorDRE`, não de `valor` (regime.ts:59 documenta o
 *     mesmo acoplamento no detalhe). Trocar aqui sem trocar lá quebraria a
 *     conferência "rodapé do modal == valor da célula".
 */
export function aggResumoDRE(data: readonly Lancamento[], regime: string): ResumoDRE {
  const op = filtraOperacional(data as Lancamento[], regime)

  const monthsSet = new Set<string>()
  for (const r of op) { const ym = ymOf(r); if (ym) monthsSet.add(ym) }
  const months = [...monthsSet].sort()
  const cols = [...months, '__acc__']

  // mês → l1 → l2 → l3 → valor assinado
  const vm: Record<string, Record<string, Record<string, Record<string, number>>>> = {}
  for (const row of op) {
    const ym = ymOf(row)
    if (!ym) continue
    const sign = row.tipo === 'Receita' ? 1 : -1
    const { l1, l2 } = parseCatHier(row.cat1)
    const l3 = row.cat1 || l2
    if (!vm[ym])         vm[ym]         = {}
    if (!vm[ym][l1])     vm[ym][l1]     = {}
    if (!vm[ym][l1][l2]) vm[ym][l1][l2] = {}
    vm[ym][l1][l2][l3] = (vm[ym][l1][l2][l3] ?? 0) + sign * row.valorDRE
  }

  // Estrutura da árvore — sobre TODO op, inclusive sem data (ver nota acima).
  const l1m = new Map<string, Map<string, Set<string>>>()
  for (const row of op) {
    const { l1, l2 } = parseCatHier(row.cat1)
    const l3 = row.cat1 || l2
    if (!l1m.has(l1)) l1m.set(l1, new Map())
    if (!l1m.get(l1)!.has(l2)) l1m.get(l1)!.set(l2, new Set())
    l1m.get(l1)!.get(l2)!.add(l3)
  }
  const estrutura = [...l1m.entries()]
    .sort(([a], [b]) => numPrefix(a) - numPrefix(b))
    .map(([l1, l2m]) => ({
      l1,
      children: [...l2m.entries()]
        .sort(([a], [b]) => numPrefix(a) - numPrefix(b))
        .map(([l2, l3s]) => ({ l2, children: [...l3s].sort((a, b) => numPrefix(a) - numPrefix(b)) })),
    }))

  // Getters — idênticos aos do componente.
  const getL3 = (col: string, l1: string, l2: string, l3: string): number =>
    col === '__acc__'
      ? months.reduce((s, m) => s + (vm[m]?.[l1]?.[l2]?.[l3] ?? 0), 0)
      : vm[col]?.[l1]?.[l2]?.[l3] ?? 0

  const getL2 = (col: string, l1: string, l2: string): number =>
    col === '__acc__'
      ? months.reduce((s, m) => s + getL2(m, l1, l2), 0)
      : Object.values(vm[col]?.[l1]?.[l2] ?? {}).reduce((s, v) => s + v, 0)

  const getL1 = (col: string, l1: string): number => {
    if (col === '__acc__') return months.reduce((s, m) => s + getL1(m, l1), 0)
    let s = 0
    for (const l2v of Object.values(vm[col]?.[l1] ?? {}))
      for (const v of Object.values(l2v)) s += v
    return s
  }

  // Mesma regra do detalhe (`matcherAteGrupo`), aplicada sobre os rótulos.
  const groupSum = (col: string, maxPfx: number): number =>
    estrutura.filter(h => grupoDentroDoLimite(h.l1, maxPfx))
      .reduce((s, h) => s + getL1(col, h.l1), 0)

  const makeVals = (fn: (col: string) => number) => cols.map(fn)

  // Árvore com valores em cada nó.
  const hier: NoL1[] = estrutura.map(({ l1, children }) => ({
    l1,
    vals: makeVals(col => getL1(col, l1)),
    children: children.map(({ l2, children: l3s }) => ({
      l2,
      label: getL2Label(l2),
      vals: makeVals(col => getL2(col, l1, l2)),
      children: l3s.map(l3 => ({ l3, vals: makeVals(col => getL3(col, l1, l2, l3)) })),
    })),
  }))

  const subtotais: SubtotaisDRE = {
    recBruta:    makeVals(col => groupSum(col, 1.99)),
    recLiq:      makeVals(col => groupSum(col, 2.99)),
    lucroBruto:  makeVals(col => groupSum(col, 3.99)),
    margContrib: makeVals(col => groupSum(col, 3.99) + getL2(col, '4 — Despesas', '4.1')),
    ebitda:      makeVals(col => groupSum(col, 4.99)),
    ebit:        makeVals(col => groupSum(col, 5.99)),
    ebt:         makeVals(col => groupSum(col, 6.99)),
    lucroLiq:    makeVals(col => groupSum(col, LIMITE_GRUPO_DRE)),
  }

  // ── KPIs executivos ────────────────────────────────────────────────────────
  const recOp    = groupSum('__acc__', 1.99)
  const recFin   = getL1('__acc__', '6.1 — Rec. Financeira')
  const recLiq   = groupSum('__acc__', 2.99)
  const lubruto  = groupSum('__acc__', 3.99)
  const despCom  = getL2('__acc__', '4 — Despesas', '4.1')
  const ebitda   = groupSum('__acc__', 4.99)
  const ebit     = groupSum('__acc__', 5.99)
  const lucroLiq = groupSum('__acc__', LIMITE_GRUPO_DRE)

  // Growth Rate: dois últimos meses VISÍVEIS, não os dois últimos do calendário.
  let growthRate: number | null = null
  if (months.length >= 2) {
    const prvRL = groupSum(months[months.length - 2], 2.99)
    const curRL = groupSum(months[months.length - 1], 2.99)
    if (prvRL) growthRate = (curRL - prvRL) / Math.abs(prvRL)
  }

  const exec: ExecDRE = {
    recOp, recFin,
    recBruta: recOp + recFin,
    recLiq, lubruto,
    margContrib: lubruto + despCom,
    ebitda, ebit, lucroLiq, growthRate,
  }

  // ── KPIs inferiores ────────────────────────────────────────────────────────
  // `S` soma por PREFIXO de cat1 — recortes que não coincidem com a hierarquia
  // L1/L2 (ex.: "gastos com pessoas" cruza 3.1, 3.2, 4.1 e 4.2).
  const S = (...pfx: string[]) =>
    op.filter(r => pfx.some(p => (r.cat1 || '').startsWith(p)))
      .reduce((s, r) => s + (r.tipo === 'Receita' ? 1 : -1) * r.valorDRE, 0)

  const maoObraCSP = getL2('__acc__', '3 — Custos Operac.', '3.1')
  const isaas      = getL2('__acc__', '3 — Custos Operac.', '3.2')
  const remuCom    = S('4.1.01', '4.1.02', '4.1.03', '4.1.04', '4.1.05', '4.1.23')
  const admPessoas = S('4.2.01', '4.2.02', '4.2.03', '4.2.04', '4.2.05', '4.2.06',
                       '4.2.07', '4.2.08', '4.2.09', '4.2.25', '4.2.26')

  const kpis: KpisDRE = {
    recOp, recLiq, lubruto,
    margContrib: exec.margContrib,
    ebitda, ebit, lucroLiq,
    deducoes:    groupSum('__acc__', 2.99) - groupSum('__acc__', 1.99),
    csp:         getL1('__acc__', '3 — Custos Operac.'),
    terceiros:   getL2('__acc__', '3 — Custos Operac.', '3.3'),
    despCom,
    despAdmin:   getL2('__acc__', '4 — Despesas', '4.2'),
    despGerais:  getL2('__acc__', '4 — Despesas', '4.3'),
    gastosPessoas: maoObraCSP + isaas + remuCom + admPessoas,
    despAquisicao: S('4.1.02', '4.1.04', '4.1.06', '4.1.07', '4.1.08', '4.1.10',
                     '4.1.11', '4.1.12', '4.1.13', '4.1.14', '4.1.15', '4.1.16', '4.1.17'),
    leadBroker:    S('4.1.06'),
    despExpansao:  S('4.1.18', '4.1.19', '4.1.20', '4.1.21', '4.1.22', '4.1.23'),
    proLabore:     S('4.2.25', '4.2.26'),
    growthRate,
  }

  return { months, hier, subtotais, exec, kpis, totalOperacional: op.length }
}
