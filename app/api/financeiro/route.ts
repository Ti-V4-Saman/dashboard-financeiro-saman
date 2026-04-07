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
    const quitados = rows.filter(r => r.situacao === 'Quitado').length
    const comData  = rows.filter(r => r.data !== null).length
    const apr26    = rows.filter(r => r.data && r.data.getFullYear() === 2026 && r.data.getMonth() === 3).length
    const apr26rec = rows.filter(r => r.data && r.data.getFullYear() === 2026 && r.data.getMonth() === 3 && !r.isTransfer && r.tipo === 'Receita').reduce((s, r) => s + r.valor, 0)
    const apr26desp = rows.filter(r => r.data && r.data.getFullYear() === 2026 && r.data.getMonth() === 3 && !r.isTransfer && r.tipo === 'Despesa').reduce((s, r) => s + r.valor, 0)
    console.log('[fin] ' + JSON.stringify({ total: rows.length, quitados, comData, apr26, apr26rec: apr26rec.toFixed(2), apr26desp: apr26desp.toFixed(2), url: SHEETS_URL?.slice(-15) }))

    return NextResponse.json(rows, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('API /financeiro error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
