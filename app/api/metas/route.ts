import { NextResponse } from 'next/server'
import type { Meta } from '@/lib/types'

const METAS_URL = process.env.METAS_URL!

export const dynamic = 'force-dynamic'

function parseMetas(text: string): Meta[] {
  const lines = text.split('\n').filter(l => l.trim().length > 0)
  if (lines.length < 2) return []

  // Detect separator
  const sep = lines[0].includes(';') ? ';' : ','

  function splitLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === sep && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  }

  const headers = splitLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim().toUpperCase())

  const get = (cols: string[], key: string) => {
    const idx = headers.indexOf(key)
    return idx >= 0 ? (cols[idx] || '').replace(/^"|"$/g, '').trim() : ''
  }

  const result: Meta[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]).map(c => c.replace(/^"|"$/g, '').trim())
    if (cols.every(c => c === '')) continue

    try {
      const id = get(cols, 'ID')
      const tipo = get(cols, 'TIPO') as Meta['tipo']
      const mes = get(cols, 'MES_REFERENCIA')
      const vpRaw = get(cols, 'VALOR_PLANEJADO').replace(',', '.')
      const vp = parseFloat(vpRaw)

      if (!id || !tipo || !mes || isNaN(vp)) continue

      const cat = get(cols, 'CATEGORIA')
      const n1  = get(cols, 'CATEGORIA_NIVEL_1')
      const n2  = get(cols, 'CATEGORIA_NIVEL_2')
      const n3  = get(cols, 'CATEGORIA_NIVEL_3')

      result.push({
        id,
        tipo,
        categoria: cat,
        // If sheet has new hierarchy cols use them; fall back to old CATEGORIA
        categoria_nivel_1: n1 || cat,
        categoria_nivel_2: n2 || cat,
        categoria_nivel_3: n3 || cat,
        // sheet has typo "CENTO_DE_CUSTO"
        centro_de_custo: get(cols, 'CENTRO_DE_CUSTO') || get(cols, 'CENTO_DE_CUSTO'),
        mes_referencia: mes,
        valor_planejado: vp,
        tipo_lancamento: (get(cols, 'TIPO_LANCAMENTO') || 'Despesa') as Meta['tipo_lancamento'],
        observacao: get(cols, 'OBSERVACAO'),
        criado_em: get(cols, 'CRIADO_EM') || new Date().toISOString(),
      })
    } catch {
      // skip malformed row
    }
  }

  return result
}

export async function GET() {
  try {
    const res = await fetch(METAS_URL, { cache: 'no-store' })
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch metas' }, { status: 502 })
    }
    const text = await res.text()
    const metas = parseMetas(text)

    // DEBUG TEMPORÁRIO — remove após confirmar paridade
    console.log('[metas] debug', {
      url: METAS_URL?.slice(-30),
      totalMetas: metas.length,
    })

    return NextResponse.json(metas, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('API /metas error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
