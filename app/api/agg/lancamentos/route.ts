import { NextResponse } from 'next/server'

import { getUserAccess } from '@/lib/access'
import { fetchLancamentos } from '@/lib/financeiro-query'
import { parseFiltros } from '@/lib/financeiro-filtros'
import {
  aggLancamentos, isSortKey, isSortDir,
  PAGE_SIZE_PADRAO, PAGE_SIZE_MAX,
} from '@/lib/aggregations/lancamentos'

export const dynamic = 'force-dynamic'

/** Teto do texto de busca. Nada real chega perto; recusa entrada absurda. */
const MAX_Q = 200

/**
 * GET /api/agg/lancamentos
 *   ?de&ate&regime
 *   &categoria&cc&tipo&situacao&conta   (CSV, os 5 filtros globais)
 *   &q=<busca>&contaSel=<conta do select local>
 *   &sort=data|valor&dir=asc|desc&page=1&pageSize=50
 *
 * AUTORIZAÇÃO: exclusivamente admin OU a tela 'lancamentos'. O 403 sai ANTES
 * de qualquer consulta ao banco.
 *
 * ORDENAÇÃO POR ALLOWLIST: `sort` e `dir` são validados contra listas fechadas
 * (`data|valor`, `asc|desc`) e nunca chegam perto de SQL — a consulta é a de
 * `fetchLancamentos`, parametrizada só por datas, e a ordenação acontece em JS.
 * Valor fora da allowlist vira 400, não um default silencioso.
 *
 * PAGINAÇÃO: acontece AQUI, não no SQL. A query é um UNION sem ORDER BY
 * estável; pôr LIMIT/OFFSET nela exigiria inventar uma ordenação no banco e
 * arriscaria divergir do caminho legado, que ordena em JS. O que importa para
 * o objetivo do bloco é que o BROWSER não receba o array inteiro — e não
 * recebe: sai uma página por vez, com teto de PAGE_SIZE_MAX.
 *
 * FOLHA: `podeVerFolhaDetalhada` é decidido aqui e desce para
 * `fetchLancamentos`, que mascara antes de qualquer coisa. A busca portanto
 * opera sobre o texto JÁ mascarado — quem não tem a permissão não encontra uma
 * pessoa pelo nome, nem descobre que ela existe pela contagem de resultados.
 * Ver a nota extensa em lib/aggregations/lancamentos.ts.
 *
 * `contaSel` é o select LOCAL da tela, separado do filtro global `conta` do
 * FilterBar. Nomes distintos de propósito, para não depender de ordem de
 * parâmetro repetido.
 */
export async function GET(request: Request) {
  try {
    const acc = await getUserAccess()
    if (!acc.isAdmin && !acc.telasPermitidas.includes('lancamentos')) {
      return NextResponse.json(
        { error: 'Sem permissão para acessar esta tela.' },
        { status: 403 },
      )
    }

    const sp = new URL(request.url).searchParams

    const sortRaw = sp.get('sort') || 'data'
    const dirRaw  = sp.get('dir')  || 'desc'
    if (!isSortKey(sortRaw)) return NextResponse.json({ error: 'sort inválido' }, { status: 400 })
    if (!isSortDir(dirRaw))  return NextResponse.json({ error: 'dir inválido' },  { status: 400 })

    const q = (sp.get('q') || '').trim()
    if (q.length > MAX_Q) return NextResponse.json({ error: 'q longa demais' }, { status: 400 })

    const pageRaw = Number(sp.get('page') || '1')
    const sizeRaw = Number(sp.get('pageSize') || String(PAGE_SIZE_PADRAO))
    if (!Number.isFinite(pageRaw) || !Number.isFinite(sizeRaw) || pageRaw < 1 || sizeRaw < 1) {
      return NextResponse.json({ error: 'page/pageSize inválidos' }, { status: 400 })
    }

    const de     = sp.get('de')     || null
    const ate    = sp.get('ate')    || null
    const regime = sp.get('regime') || 'competencia'

    const podeVerFolhaDetalhada = acc.isAdmin || acc.verFolhaDetalhe === true

    const cru = await fetchLancamentos({ de, ate, regime, podeVerFolhaDetalhada })

    return NextResponse.json(
      aggLancamentos(cru, parseFiltros(sp), {
        q,
        contaSel: (sp.get('contaSel') || '').trim(),
        sort: sortRaw,
        dir: dirRaw,
        page: Math.floor(pageRaw),
        pageSize: Math.min(Math.floor(sizeRaw), PAGE_SIZE_MAX),
      }),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    // Sem `q`, contraparte ou desc no log.
    console.error('[agg/lancamentos]', err instanceof Error ? err.message : 'erro')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
