import { NextResponse } from 'next/server'

import { getUserAccess } from '@/lib/access'
import { fetchLancamentos } from '@/lib/financeiro-query'
import { parseFiltros } from '@/lib/financeiro-filtros'
import { aggCentrosCusto } from '@/lib/aggregations/centrosCusto'

export const dynamic = 'force-dynamic'

/**
 * GET /api/agg/centros-custo
 *   ?de&ate&regime
 *   &categoria&cc&tipo&situacao&conta   (CSV, os 5 filtros do dash)
 *
 * Resumo da tela de Centros de Custo: os centros com receita, despesa e
 * resultado; os 5 grupos de KPI; e os três recortes de gráfico.
 *
 * AUTORIZAÇÃO: exclusivamente admin OU a tela 'centros_custo'. Ter visao_geral,
 * dre, comparativo, lancamentos, metas ou bus NÃO dá acesso — este endpoint
 * devolve a composição desta tela, não o dataset compartilhado. O 403 sai ANTES
 * de qualquer consulta ao banco.
 *
 * NÃO devolve o array bruto: só os agregados por centro. Nenhum `fornecedor`,
 * `desc` ou linha individual atravessa daqui. O detalhe tem endpoint próprio,
 * sob demanda, em /api/agg/centros-custo/detalhe.
 *
 * FOLHA: o resumo é agregado — nenhum campo de texto por lançamento sai daqui,
 * então mascarar não muda um número. `podeVerFolhaDetalhada` é passado mesmo
 * assim, com o valor real vindo de `getUserAccess()`: fixar `true` porque "aqui
 * não vaza" cria a exceção que alguém copia para uma rota que devolve detalhe.
 *
 * BUSCA DA TABELA: fica no cliente. O payload traz todos os centros, então
 * digitar no campo de busca não refaz requisição.
 */
export async function GET(request: Request) {
  try {
    const acc = await getUserAccess()
    if (!acc.isAdmin && !acc.telasPermitidas.includes('centros_custo')) {
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

    return NextResponse.json(aggCentrosCusto(cru, parseFiltros(sp), regime), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[agg/centros-custo]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
