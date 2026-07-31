import { detalheDRE } from '@/lib/financeiro/regime'
import { protegerDetalheFolha } from '@/lib/folha'
import { parseCatHier } from '@/lib/utils'
import type { Lancamento } from '@/lib/types'

/**
 * Agregação da DRE — detalhe sob demanda.
 *
 * ESCOPO DESTE ARQUIVO HOJE
 * Só o DETALHE (o Sheet de conferência). O resumo agregado — hierarquia,
 * mensal, executivo, KPIs — ainda não foi portado; ver relatório do Bloco E.
 *
 * SEGURANÇA — o motivo de existir
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

// ── Allowlist de linhas ──────────────────────────────────────────────────────

/** Subtotais: id fixo → faixa de prefixo. Espelha matcherForRow (DRE.tsx:199-219). */
const SUBTOTAIS: Record<string, (r: Lancamento) => boolean> = {
  __recLiq__:      r => numPrefix(parseCatHier(r.cat1).l1) <= 2.99,
  __lubruto__:     r => numPrefix(parseCatHier(r.cat1).l1) <= 3.99,
  __margContrib__: r => {
    const h = parseCatHier(r.cat1)
    return numPrefix(h.l1) <= 3.99 || (h.l1 === '4 — Despesas' && h.l2 === '4.1')
  },
  __ebitda__:    r => numPrefix(parseCatHier(r.cat1).l1) <= 4.99,
  __ebit__:      r => numPrefix(parseCatHier(r.cat1).l1) <= 5.99,
  __ebt__:       r => numPrefix(parseCatHier(r.cat1).l1) <= 6.99,
  __lucroliq__:  () => true,
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

/** Reconstrói o predicado no SERVIDOR. Espelha matcherForRow (DRE.tsx:185-223). */
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
