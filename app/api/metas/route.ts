import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { requireAdmin } from '@/lib/auth-guard'

const pool = getPool()

// GET: Listar todas as metas
export async function GET() {
  try {
    const { rows } = await pool.query('SELECT * FROM ca.metas ORDER BY mes_referencia DESC, categoria ASC')
    return NextResponse.json(rows)
  } catch (err) {
    console.error('Error fetching metas:', err)
    return NextResponse.json({ error: 'Failed to fetch metas' }, { status: 500 })
  }
}

// POST: Criar ou atualizar uma meta (Upsert)
export async function POST(req: Request) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const body = await req.json()
    const { 
      id, tipo, categoria, categoria_nivel_1, categoria_nivel_2, 
      categoria_nivel_3, centro_de_custo, mes_referencia, 
      valor_planejado, tipo_lancamento, observacao 
    } = body

    const query = `
      INSERT INTO ca.metas (
        id, tipo, categoria, categoria_nivel_1, categoria_nivel_2, 
        categoria_nivel_3, centro_de_custo, mes_referencia, 
        valor_planejado, tipo_lancamento, observacao
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        tipo = EXCLUDED.tipo,
        categoria = EXCLUDED.categoria,
        categoria_nivel_1 = EXCLUDED.categoria_nivel_1,
        categoria_nivel_2 = EXCLUDED.categoria_nivel_2,
        categoria_nivel_3 = EXCLUDED.categoria_nivel_3,
        centro_de_custo = EXCLUDED.centro_de_custo,
        mes_referencia = EXCLUDED.mes_referencia,
        valor_planejado = EXCLUDED.valor_planejado,
        tipo_lancamento = EXCLUDED.tipo_lancamento,
        observacao = EXCLUDED.observacao
      RETURNING *
    `
    const values = [
      id, tipo, categoria, categoria_nivel_1, categoria_nivel_2, 
      categoria_nivel_3, centro_de_custo, mes_referencia, 
      valor_planejado, tipo_lancamento, observacao
    ]

    const { rows } = await pool.query(query, values)
    return NextResponse.json(rows[0])
  } catch (err) {
    console.error('Error saving meta:', err)
    return NextResponse.json({ error: 'Failed to save meta' }, { status: 500 })
  }
}

// DELETE: Excluir uma meta
export async function DELETE(req: Request) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    
    if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

    await pool.query('DELETE FROM ca.metas WHERE id = $1', [id])
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error deleting meta:', err)
    return NextResponse.json({ error: 'Failed to delete meta' }, { status: 500 })
  }
}
