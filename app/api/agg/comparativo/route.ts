import { NextResponse } from 'next/server'

import { getUserAccess } from '@/lib/access'
import { fetchLancamentos } from '@/lib/financeiro-query'
import { parseFiltros } from '@/lib/financeiro-filtros'
import { aggComparativo } from '@/lib/aggregations/comparativo'

export const dynamic = 'force-dynamic'

/**
 * GET /api/agg/comparativo
 *   ?de&ate&regime
 *   &categoria&cc&tipo&situacao&conta   (CSV, os 5 filtros do dash)
 *
 * Evolução mensal, tabela M/M + YoY + YTD, e a hierarquia por mês que alimenta
 * o comparador mês1 × mês2.
 *
 * AUTORIZAÇÃO: exclusivamente admin OU a tela 'comparativo'. Ter visao_geral,
 * dre, centros_custo, lancamentos, metas ou bus NÃO dá acesso. O 403 sai ANTES
 * de qualquer consulta ao banco.
 *
 * ── UMA CONSULTA, DOIS CONJUNTOS ───────────────────────────────────────────
 * A tela recebe hoje duas props, `data` e `allData`, e o nome engana: `allData`
 * não é histórico, é o MESMO período sem os 5 filtros do usuário. As duas saem
 * da mesma chamada de /api/financeiro. Aqui é igual: uma consulta por período,
 * e `aggComparativo` deriva internamente o conjunto filtrado. Duas queries
 * seriam desperdício — o recorte é idêntico.
 *
 * NÃO devolve o array bruto, nem `fornecedor`, nem `desc`. Só séries, tabela e
 * a árvore de valores por mês.
 *
 * FOLHA: nenhum campo de texto por lançamento sai daqui, então mascarar não
 * muda um número — e há teste provando que o payload é idêntico com e sem a
 * permissão. `podeVerFolhaDetalhada` é passado mesmo assim, com o valor real:
 * fixar `true` porque "aqui não vaza" cria a exceção que alguém copia para uma
 * rota que devolve detalhe.
 *
 * ESTADO DE UI FICA NO CLIENTE: o seletor mês1/mês2 e o colapso da hierarquia
 * não passam por aqui. `hierPorMes` cobre todos os meses do período, então
 * trocar de mês não refaz requisição.
 */
export async function GET(request: Request) {
  try {
    const acc = await getUserAccess()
    if (!acc.isAdmin && !acc.telasPermitidas.includes('comparativo')) {
      return NextResponse.json(
        { error: 'Sem permissão para acessar esta tela.' },
        { status: 403 },
      )
    }

    const sp = new URL(request.url).searchParams
    const de     = sp.get('de')     || null
    const ate    = sp.get('ate')    || null
    const regime = sp.get('regime') || 'competencia'

    const podeVerFolhaDetalhada = acc.isAdmin || acc.verFolhaDetalhe === true

    const todos = await fetchLancamentos({ de, ate, regime, podeVerFolhaDetalhada })

    return NextResponse.json(aggComparativo(todos, parseFiltros(sp), regime), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[agg/comparativo]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
