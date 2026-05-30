import { NextResponse } from 'next/server'
import { requireScreen } from '@/lib/access'
import { fetchFilteredData } from '@/lib/financeiro-query'
import { parseFiltros } from '@/lib/financeiro-filtros'
import { aggDRE } from '@/lib/aggregations/dre'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const denied = await requireScreen('dre')
  if (denied) return denied
  try {
    const sp = new URL(request.url).searchParams
    const de     = sp.get('de')     || null
    const ate    = sp.get('ate')    || null
    const regime = sp.get('regime') || 'competencia'

    const data = await fetchFilteredData({ de, ate, regime, filtros: parseFiltros(sp) })
    return NextResponse.json(aggDRE(data, regime), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[agg/dre]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
