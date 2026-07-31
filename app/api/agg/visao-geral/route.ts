import { NextResponse } from 'next/server'

import { getUserAccess } from '@/lib/access'
import { fetchLancamentos } from '@/lib/financeiro-query'
import { parseFiltros } from '@/lib/financeiro-filtros'
import { aggVisaoGeral } from '@/lib/aggregations/visaoGeral'

export const dynamic = 'force-dynamic'

/**
 * GET /api/agg/visao-geral
 *   ?de&ate&regime
 *   &categoria&cc&tipo&situacao&conta   (CSV, os 5 filtros do dash)
 *   &hoje=YYYY-MM-DD                    dia de referência do KPI Atrasados
 *
 * AUTORIZAÇÃO: exclusivamente admin OU a tela 'visao_geral'. Ter dre,
 * centros_custo, comparativo, lancamentos ou metas NÃO dá acesso — este
 * endpoint devolve a composição da Visão Geral, não o dataset compartilhado.
 * O 403 sai ANTES de qualquer consulta ao banco.
 *
 * NÃO devolve o array bruto de lançamentos: só os KPIs, a série diária e os
 * dois rankings — o suficiente para renderizar a tela.
 *
 * `hoje` vem do cliente porque o navegador roda em GMT-3 e o servidor em UTC;
 * às 22h BRT os dois discordariam sobre o dia corrente e o KPI de Atrasados
 * divergiria entre os caminhos da flag. Não é dado sensível nem concede
 * acesso: no limite o usuário muda o próprio corte de "atrasado". Sem o
 * parâmetro, cai na data do servidor.
 *
 * EXTRAS: `/api/visao-geral-extras` NÃO foi incorporado aqui — segue como
 * chamada própria nos dois caminhos da flag. Ver justificativa no relatório
 * do Bloco D (aquela rota hoje não tem guard, e embuti-la aqui criaria
 * divergência de proteção entre os dois caminhos).
 */
export async function GET(request: Request) {
  try {
    const acc = await getUserAccess()
    if (!acc.isAdmin && !acc.telasPermitidas.includes('visao_geral')) {
      return NextResponse.json(
        { error: 'Sem permissão para acessar esta tela.' },
        { status: 403 },
      )
    }

    const sp = new URL(request.url).searchParams
    const de     = sp.get('de')     || null
    const ate    = sp.get('ate')    || null
    const regime = sp.get('regime') || 'competencia'

    const hojeParam = sp.get('hoje') || ''
    const hoje = /^\d{4}-\d{2}-\d{2}$/.test(hojeParam)
      ? hojeParam
      : new Date().toISOString().slice(0, 10)

    const cru = await fetchLancamentos({ de, ate, regime })

    return NextResponse.json(
      aggVisaoGeral(cru, parseFiltros(sp), regime, hoje, { de: de ?? '', ate: ate ?? '' }),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[agg/visao-geral]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
