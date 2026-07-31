import { NextResponse } from 'next/server'

import { getUserAccess } from '@/lib/access'
import { fetchLancamentos } from '@/lib/financeiro-query'
import { parseFiltros, applyFiltros } from '@/lib/financeiro-filtros'
import { aggDetalheDRE, parseLinhaId, LinhaRefInvalida } from '@/lib/aggregations/dre'

export const dynamic = 'force-dynamic'

/**
 * GET /api/agg/dre/detalhe
 *   ?linhaId=__ebitda__ | l1:<rótulo> | l2:<l1>|<l2> | l3:<cat1>
 *   &de&ate&regime&mes
 *   &categoria&cc&tipo&situacao&conta   (CSV, os 5 filtros do dash)
 *
 * AUTORIZAÇÃO: admin OU a tela 'dre', e nada mais. O 403 sai antes de
 * qualquer consulta ao banco.
 *
 * FOLHA: `podeVerFolhaDetalhada` é calculado AQUI, no servidor, a partir de
 * getUserAccess(). Nenhuma flag do cliente influencia — não existe parâmetro
 * para isso, de propósito. A proteção é aplicada antes de serializar, então o
 * payload que sai pela rede já está mascarado; não há campo paralelo com o
 * valor original.
 *
 * LOG: em erro registramos só o linhaId e a mensagem. Contraparte e descrição
 * nunca entram em log.
 */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams
  const linhaId = sp.get('linhaId') || ''

  try {
    const acc = await getUserAccess()
    if (!acc.isAdmin && !acc.telasPermitidas.includes('dre')) {
      return NextResponse.json(
        { error: 'Sem permissão para acessar esta tela.' },
        { status: 403 },
      )
    }

    // Allowlist: qualquer coisa fora dos formatos previstos vira 400.
    let ref
    try {
      ref = parseLinhaId(linhaId)
    } catch (e) {
      if (e instanceof LinhaRefInvalida) {
        return NextResponse.json({ error: 'linhaId inválido' }, { status: 400 })
      }
      throw e
    }

    const de     = sp.get('de')     || null
    const ate    = sp.get('ate')    || null
    const regime = sp.get('regime') || 'competencia'
    const mesRaw = sp.get('mes') || ''
    const mes    = /^\d{4}-\d{2}$/.test(mesRaw) ? mesRaw : undefined
    const titulo = sp.get('titulo') || ''

    // Regra oficial: admin sempre vê; não-admin depende de ver_folha_detalhe.
    const podeVerFolhaDetalhada = acc.isAdmin || acc.verFolhaDetalhe === true

    // Os 5 filtros do dash entram ANTES do matcher, como no caminho legado
    // (lá o componente recebe `data` já filtrado pelo DashboardLayout).
    const cru = await fetchLancamentos({ de, ate, regime })
    const data = applyFiltros(cru, parseFiltros(sp))

    return NextResponse.json(
      aggDetalheDRE(data, regime, ref, mes, titulo, podeVerFolhaDetalhada),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    // Sem contraparte/desc no log.
    console.error('[agg/dre/detalhe] linhaId=%s', linhaId, err instanceof Error ? err.message : 'erro')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
