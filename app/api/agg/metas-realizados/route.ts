import { NextResponse } from 'next/server'
import { requireScreen } from '@/lib/access'
import { fetchFilteredData } from '@/lib/financeiro-query'
import { aggMetasRealizados } from '@/lib/aggregations/metasRealizados'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const denied = await requireScreen('metas')
  if (denied) return denied
  try {
    const sp = new URL(request.url).searchParams
    const de     = sp.get('de')     || null
    const ate    = sp.get('ate')    || null
    const regime = sp.get('regime') || 'competencia'

    // Realizado usa o array do período SEM os 5 filtros (espelha allData do dash).
    const data = await fetchFilteredData({ de, ate, regime })
    return NextResponse.json(
      aggMetasRealizados(data, regime, de ?? '', ate ?? ''),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[agg/metas-realizados]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
