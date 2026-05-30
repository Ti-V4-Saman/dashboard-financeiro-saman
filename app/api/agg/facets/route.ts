import { NextResponse } from 'next/server'
import { getUserAccess } from '@/lib/access'
import { fetchLancamentos, fetchContas } from '@/lib/financeiro-query'
import { aggFacets } from '@/lib/aggregations/facets'
import type { Screen } from '@/lib/screens'

export const dynamic = 'force-dynamic'

// Facetas alimentam a FilterBar — liberadas a quem tem ao menos uma tela que
// usa o dataset financeiro (ou admin).
const COUPLED: Screen[] = ['visao_geral', 'dre', 'centros_custo', 'comparativo', 'lancamentos']

export async function GET(request: Request) {
  const acc = await getUserAccess()
  if (!acc.isAdmin && !acc.telasPermitidas.some(s => COUPLED.includes(s))) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }
  try {
    const sp = new URL(request.url).searchParams
    const de     = sp.get('de')     || null
    const ate    = sp.get('ate')    || null
    const regime = sp.get('regime') || 'competencia'

    const [allData, contas] = await Promise.all([
      fetchLancamentos({ de, ate, regime }),
      fetchContas(),
    ])
    return NextResponse.json(aggFacets(allData, contas), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[agg/facets]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
