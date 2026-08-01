import { NextResponse } from 'next/server'

import { getUserAccess } from '@/lib/access'
import { fetchLancamentos } from '@/lib/financeiro-query'
import { parseFiltros, applyFiltros } from '@/lib/financeiro-filtros'
import { aggResumoDRE } from '@/lib/aggregations/dre'

export const dynamic = 'force-dynamic'

/**
 * GET /api/agg/dre
 *   ?de&ate&regime
 *   &categoria&cc&tipo&situacao&conta   (CSV, os 5 filtros do dash)
 *
 * Resumo da DRE: hierarquia com valores por mês e acumulado, as oito séries de
 * subtotal, os KPIs executivos e os KPIs inferiores.
 *
 * AUTORIZAÇÃO: admin OU a tela 'dre'. O 403 sai antes de qualquer consulta.
 *
 * FOLHA: o resumo é agregado — nenhum campo de texto por lançamento sai daqui,
 * então mascarar não muda um único número. `podeVerFolhaDetalhada` é passado
 * mesmo assim, com o valor real vindo de `getUserAccess()`. Fixar `true`
 * porque "aqui não vaza" cria a exceção que alguém copia para uma rota que
 * devolve detalhe; a permissão verdadeira é sempre a resposta certa. O detalhe
 * por lançamento tem endpoint próprio, /api/agg/dre/detalhe, que é onde a
 * permissão de fato muda o payload.
 *
 * NÃO devolve o array de lançamentos. Quem tem só a tela `dre` recebe daqui o
 * suficiente para renderizar a DRE inteira e nada além disso.
 *
 * ESTADO DE UI FICA NO CLIENTE: expandir e recolher L1/L2 não passa por aqui.
 * O payload traz valor para todo nó da árvore, então abrir um grupo não refaz
 * requisição.
 */
export async function GET(request: Request) {
  try {
    const acc = await getUserAccess()
    if (!acc.isAdmin && !acc.telasPermitidas.includes('dre')) {
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

    const cru = await fetchLancamentos({ de, ate, regime, podeVerFolhaDetalhada })
    const data = applyFiltros(cru, parseFiltros(sp))

    return NextResponse.json(aggResumoDRE(data, regime), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[agg/dre]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
