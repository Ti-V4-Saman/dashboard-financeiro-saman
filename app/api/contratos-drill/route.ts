/**
 * GET /api/contratos-drill?filtro=vencidos|a-vencer-60d
 *
 * Retorna a lista de contratos ATIVOS que se enquadram no filtro, para
 * exibicao em drawer/sheet de drill-down a partir dos numeros do card
 * "Recorrencia - Contratos" na Visao Geral.
 *
 * Filtros:
 *   - 'vencidos'      : status = 'ATIVO' AND data_fim < CURRENT_DATE
 *   - 'a-vencer-60d'  : status = 'ATIVO'
 *                       AND data_fim BETWEEN CURRENT_DATE AND CURRENT_DATE + 60 days
 *
 * Resposta: { contratos: [{ id, nome }], total: number }
 *   - `nome` vem de ca.pessoas (LEFT JOIN por cliente_id);
 *     fallback "(sem nome)" quando pessoa nao encontrada.
 *
 * Convencoes alinhadas com docs/conta-azul-api-guia.md:
 *   - Granularidade: ca.contratos (1 linha por contrato)
 *   - data_fim conforme termos.data_fim da API v1
 */
import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { requireScreen } from '@/lib/access'

export const dynamic = 'force-dynamic'

const pool = getPool()

type Filtro = 'vencidos' | 'a-vencer-60d'

interface ContratoLista {
  id:   string
  nome: string
}

export async function GET(request: Request) {
  const denied = await requireScreen('visao_geral')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const filtro = searchParams.get('filtro') as Filtro | null

  if (filtro !== 'vencidos' && filtro !== 'a-vencer-60d') {
    return NextResponse.json(
      { error: "Parametro 'filtro' invalido. Use 'vencidos' ou 'a-vencer-60d'." },
      { status: 400 },
    )
  }

  // Where clause por filtro
  const whereByFiltro: Record<Filtro, string> = {
    'vencidos':
      `c.status = 'ATIVO' AND c.data_fim IS NOT NULL AND c.data_fim < CURRENT_DATE`,
    'a-vencer-60d':
      `c.status = 'ATIVO' AND c.data_fim IS NOT NULL
       AND c.data_fim BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days'`,
  }

  // Ordenacao: vencidos -> mais antigos primeiro; a vencer -> mais proximos primeiro
  const orderBy =
    filtro === 'vencidos' ? 'c.data_fim ASC' : 'c.data_fim ASC'

  try {
    const { rows } = await pool.query<{ id: string; nome: string | null }>(`
      SELECT
        c.id,
        COALESCE(NULLIF(TRIM(p.nome), ''), '(sem nome)') AS nome
      FROM ca.contratos c
      LEFT JOIN ca.pessoas p ON p.id = c.cliente_id
      WHERE ${whereByFiltro[filtro]}
      ORDER BY ${orderBy}
    `)

    const contratos: ContratoLista[] = rows.map(r => ({
      id:   r.id,
      nome: r.nome || '(sem nome)',
    }))

    return NextResponse.json(
      { contratos, total: contratos.length },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    )
  } catch (err) {
    console.error('[contratos-drill]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
