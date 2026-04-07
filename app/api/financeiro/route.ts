import { NextResponse } from 'next/server'
import { parseCSV } from '@/lib/parser'

const SHEETS_URL = process.env.SHEETS_URL!

// force-dynamic: o parser sempre roda fresh — o cache fica apenas no fetch() do CSV abaixo
// (s-maxage no JSON parseado causava o Vercel servir resultado da lógica antiga após deploy)
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // cache: 'no-store' garante paridade com local — sem risco de CSV antigo em cache
    const res = await fetch(SHEETS_URL, { cache: 'no-store' })
    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch spreadsheet' },
        { status: 502 }
      )
    }
    const text = await res.text()
    const rows = parseCSV(text)

    // DEBUG TEMPORÁRIO — remove após confirmar paridade
    const quitados   = rows.filter(r => r.situacao === 'Quitado').length
    const comData    = rows.filter(r => r.data !== null).length
    const mar26      = rows.filter(r => {
      if (!r.data) return false
      return r.data.getFullYear() === 2026 && r.data.getMonth() === 2
    }).length
    console.log('[financeiro] debug', {
      url: SHEETS_URL?.slice(-30),
      totalRows: rows.length,
      quitados,
      comData,
      mar26,
      primeiroData: rows[1]?.data?.toISOString(),
      primeiroValorDRE: rows[1]?.valorDRE,
      primeiroSituacao: rows[1]?.situacao,
    })

    return NextResponse.json(rows, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('API /financeiro error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
