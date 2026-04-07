import { NextResponse } from 'next/server'
import { parseCSV } from '@/lib/parser'

const SHEETS_URL = process.env.SHEETS_URL!

// force-dynamic: o parser sempre roda fresh — o cache fica apenas no fetch() do CSV abaixo
// (s-maxage no JSON parseado causava o Vercel servir resultado da lógica antiga após deploy)
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Apenas o CSV bruto do Google Sheets é cacheado (5 min) — não o JSON parseado
    const res = await fetch(SHEETS_URL, { next: { revalidate: 300 } })
    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch spreadsheet' },
        { status: 502 }
      )
    }
    const text = await res.text()
    const rows = parseCSV(text)
    return NextResponse.json(rows, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('API /financeiro error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
