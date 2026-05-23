/**
 * POST /api/metas/bulk
 * Upsert em massa de metas. Recebe { metas: Meta[] } e devolve { inserted, updated, errors }.
 *
 * Usado por:
 *   • Importação XLSX (uma única chamada com N metas)
 *   • Replicar para outros meses (cria 1 meta por mês selecionado)
 *   • Edição em massa (atualiza N metas pelo id)
 *
 * Cada item da lista DEVE ter `id` (UUID gerado pelo cliente quando novo).
 * Operação é tudo-ou-nada por linha — falhas individuais voltam em `errors`.
 */
import { NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

interface MetaInput {
  id?: string
  tipo?: string
  categoria?: string
  categoria_nivel_1?: string
  categoria_nivel_2?: string
  categoria_nivel_3?: string
  centro_de_custo?: string
  mes_referencia?: string
  valor_planejado?: number
  tipo_lancamento?: string
  observacao?: string
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const metas: MetaInput[] = Array.isArray(body?.metas) ? body.metas : []

    if (metas.length === 0) {
      return NextResponse.json({ error: 'metas array vazio' }, { status: 400 })
    }
    if (metas.length > 5000) {
      return NextResponse.json({ error: 'máximo 5000 metas por chamada' }, { status: 400 })
    }

    const client = await pool.connect()
    let inserted = 0
    let updated = 0
    const errors: { index: number; message: string }[] = []

    try {
      await client.query('BEGIN')
      for (let i = 0; i < metas.length; i++) {
        const m = metas[i]
        try {
          const id = m.id || crypto.randomUUID()
          const res = await client.query<{ existed: boolean }>(
            `
            WITH ins AS (
              INSERT INTO ca.metas (
                id, tipo, categoria, categoria_nivel_1, categoria_nivel_2,
                categoria_nivel_3, centro_de_custo, mes_referencia,
                valor_planejado, tipo_lancamento, observacao
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              ON CONFLICT (id) DO UPDATE SET
                tipo              = EXCLUDED.tipo,
                categoria         = EXCLUDED.categoria,
                categoria_nivel_1 = EXCLUDED.categoria_nivel_1,
                categoria_nivel_2 = EXCLUDED.categoria_nivel_2,
                categoria_nivel_3 = EXCLUDED.categoria_nivel_3,
                centro_de_custo   = EXCLUDED.centro_de_custo,
                mes_referencia    = EXCLUDED.mes_referencia,
                valor_planejado   = EXCLUDED.valor_planejado,
                tipo_lancamento   = EXCLUDED.tipo_lancamento,
                observacao        = EXCLUDED.observacao
              RETURNING (xmax <> 0) AS existed
            )
            SELECT existed FROM ins
            `,
            [
              id,
              m.tipo || 'categoria',
              m.categoria || '',
              m.categoria_nivel_1 || '',
              m.categoria_nivel_2 || '',
              m.categoria_nivel_3 || '',
              m.centro_de_custo || '',
              m.mes_referencia || '',
              Number(m.valor_planejado || 0),
              m.tipo_lancamento || 'Despesa',
              m.observacao || '',
            ],
          )
          if (res.rows[0]?.existed) updated++
          else                       inserted++
        } catch (e) {
          errors.push({ index: i, message: e instanceof Error ? e.message : String(e) })
        }
      }
      await client.query('COMMIT')

      return NextResponse.json({
        inserted,
        updated,
        errors,
        total: metas.length,
      })
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('Error in /api/metas/bulk:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    )
  }
}

/**
 * DELETE /api/metas/bulk?ids=uuid1,uuid2,...
 * Exclusão em massa.
 */
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const idsParam = searchParams.get('ids') || ''
    const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean)

    if (ids.length === 0) {
      return NextResponse.json({ error: 'ids vazio' }, { status: 400 })
    }
    if (ids.length > 5000) {
      return NextResponse.json({ error: 'máximo 5000 IDs por chamada' }, { status: 400 })
    }

    const { rowCount } = await pool.query(
      'DELETE FROM ca.metas WHERE id = ANY($1::text[])',
      [ids],
    )
    return NextResponse.json({ deleted: rowCount ?? 0 })
  } catch (err) {
    console.error('Error in /api/metas/bulk DELETE:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    )
  }
}
