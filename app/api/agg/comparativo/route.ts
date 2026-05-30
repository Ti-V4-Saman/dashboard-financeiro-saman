import { NextResponse } from 'next/server'
import { requireScreen } from '@/lib/access'
import { fetchFilteredData } from '@/lib/financeiro-query'
import { parseFiltros } from '@/lib/financeiro-filtros'
import { aggComparativo } from '@/lib/aggregations/comparativo'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const denied = await requireScreen('comparativo')
  if (denied) return denied
  try {
    const sp = new URL(request.url).searchParams
    const de     = sp.get('de')     || null
    const ate    = sp.get('ate')    || null
    const regime = sp.get('regime') || 'competencia'

    // data = filteredData (5 filtros); allData = sem os 5 filtros (p/ YoY),
    // mesmo recorte de período/regime — espelha o que o dash passa hoje.
    const [data, allData] = await Promise.all([
      fetchFilteredData({ de, ate, regime, filtros: parseFiltros(sp) }),
      fetchFilteredData({ de, ate, regime }),
    ])
    return NextResponse.json(aggComparativo(data, allData, regime), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[agg/comparativo]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
