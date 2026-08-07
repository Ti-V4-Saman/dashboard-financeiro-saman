import { NextResponse } from 'next/server'

import { getUserAccess } from '@/lib/access'
import { fetchLancamentos, fetchContas } from '@/lib/financeiro-query'
import { aggFacets } from '@/lib/aggregations/facets'

import type { Screen } from '@/lib/screens'

export const dynamic = 'force-dynamic'

/**
 * Telas que compartilham a FilterBar. Ter QUALQUER uma dá acesso às facetas.
 *
 * É de propósito que isto NÃO seja `requireScreen('visao_geral')`: a FilterBar
 * é um só componente no topo do dashboard, e quem tem apenas `lancamentos`
 * precisa dos mesmos selects. Trocar por uma tela única quebraria o filtro de
 * quem não tem justamente aquela. Espelha `SCREENS_QUE_USAM` de /api/financeiro.
 */
const COUPLED: Screen[] = ['visao_geral', 'dre', 'centros_custo', 'comparativo', 'lancamentos']

/**
 * GET /api/agg/facets?de&ate&regime
 *
 * As listas de opções dos selects da FilterBar, para o browser não precisar
 * baixar milhares de lançamentos só para montar quatro dropdowns.
 *
 * NÃO recebe os 5 filtros: as facetas derivam do período SEM eles, como a
 * FilterBar sempre fez. Escolher uma categoria não pode fazer as outras sumirem
 * da lista.
 *
 * NÃO devolve lançamento nenhum — só strings distintas e uma contagem.
 *
 * FOLHA: nenhuma faceta vem de `fornecedor` ou `desc`, então a permissão não
 * muda nada aqui. Passa o valor real mesmo assim, pelo mesmo motivo das outras
 * rotas: `true` fixo vira a exceção que alguém copia para onde importa.
 */
export async function GET(request: Request) {
  try {
    const acc = await getUserAccess()
    if (!acc.isAdmin && !acc.telasPermitidas.some(s => COUPLED.includes(s))) {
      return NextResponse.json(
        { error: 'Sem permissão para acessar dados financeiros.' },
        { status: 403 },
      )
    }

    const sp = new URL(request.url).searchParams
    const de     = sp.get('de')     || null
    const ate    = sp.get('ate')    || null
    const regime = sp.get('regime') || 'competencia'

    const podeVerFolhaDetalhada = acc.isAdmin || acc.verFolhaDetalhe === true

    const todos  = await fetchLancamentos({ de, ate, regime, podeVerFolhaDetalhada })
    const contas = await fetchContas()

    return NextResponse.json(aggFacets(todos, contas), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[agg/facets]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
