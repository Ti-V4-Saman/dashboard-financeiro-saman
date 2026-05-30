import { NextResponse } from 'next/server'
import { fetchLancamentos, fetchContas } from '@/lib/financeiro-query'

export const dynamic = 'force-dynamic'

/**
 * GET /api/financeiro?de=YYYY-MM-DD&ate=YYYY-MM-DD&regime=competencia|caixa
 *
 * Endpoint CRU (array linha-a-linha). A lógica de query/normalização vive em
 * lib/financeiro-query.ts (reusada pelos endpoints agregados /api/agg/*).
 *
 * ⚠️ Fase 2: quando a flag de agregação server-side está ON, as telas deixam
 * de consumir este endpoint cru — ele passa a ser restringido (ver passo de
 * fechamento). Até lá, comportamento idêntico ao histórico.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const de     = searchParams.get('de')     || null
    const ate    = searchParams.get('ate')    || null
    const regime = searchParams.get('regime') || 'competencia'

    const [lancamentos, contas] = await Promise.all([
      fetchLancamentos({ de, ate, regime }),
      fetchContas(),
    ])

    return NextResponse.json({ lancamentos, contas }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('API /financeiro error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
