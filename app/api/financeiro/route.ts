import { NextResponse } from 'next/server'
import { parseCSV } from '@/lib/parser'

const SHEETS_URL = process.env.SHEETS_URL!

export const revalidate = 300 // cache 5 min

export async function GET() {
  try {
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
      headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' },
    })
  } catch (err) {
    console.error('API /financeiro error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
