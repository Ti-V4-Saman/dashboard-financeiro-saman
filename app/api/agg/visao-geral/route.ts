import { NextResponse } from 'next/server'
import { requireScreen } from '@/lib/access'
import { fetchFilteredData } from '@/lib/financeiro-query'
import { parseFiltros } from '@/lib/financeiro-filtros'
import { aggVisaoGeral } from '@/lib/aggregations/visaoGeral'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const denied = await requireScreen('visao_geral')
  if (denied) return denied
  try {
    const sp = new URL(request.url).searchParams
    const de     = sp.get('de')     || null
    const ate    = sp.get('ate')    || null
    const regime = sp.get('regime') || 'competencia'

    const data = await fetchFilteredData({ de, ate, regime, filtros: parseFiltros(sp) })
    return NextResponse.json(aggVisaoGeral(data, regime, de ?? '', ate ?? ''), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[agg/visao-geral]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
