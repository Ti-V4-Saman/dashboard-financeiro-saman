import { NextResponse } from 'next/server'
import { requireScreen } from '@/lib/access'
import { getPool } from '@/lib/db'
import { fetchLancamentos } from '@/lib/financeiro-query'
import { parseFiltros } from '@/lib/financeiro-filtros'
import { aggResumoTrimestral } from '@/lib/aggregations/resumoTrimestral'
import type { Meta } from '@/lib/types'

export const dynamic = 'force-dynamic'

const pool = getPool()

export async function GET(request: Request) {
  const denied = await requireScreen('visao_geral')
  if (denied) return denied
  try {
    const sp = new URL(request.url).searchParams
    const de     = sp.get('de')  || null   // rangeDe (1º dia do mês anterior)
    const ate    = sp.get('ate') || null   // rangeAte (último dia de M+2)
    const mesAnt = sp.get('mesAnt') || ''
    const mesRef = sp.get('mesRef') || ''
    const mesM1  = sp.get('mesM1')  || ''
    const mesM2  = sp.get('mesM2')  || ''

    // Sempre competência (projeção). Aplica os 5 filtros + regras de ouro.
    const raw = await fetchLancamentos({ de, ate, regime: 'competencia', filtros: parseFiltros(sp) })
    const data = raw.filter(
      r => !r.isTransfer && r.situacao !== 'Cancelado' && r.situacao !== 'Renegociado',
    )

    const { rows: metas } = await pool.query<Meta>('SELECT * FROM ca.metas')

    return NextResponse.json(
      aggResumoTrimestral(data, metas, { mesAnt, mesRef, mesM1, mesM2 }),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[agg/resumo-trimestral]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
