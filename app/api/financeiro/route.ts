import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { getUserAccess } from '@/lib/access'
import type { Lancamento } from '@/lib/types'
import type { Screen } from '@/lib/screens'

export const dynamic = 'force-dynamic'

const pool = getPool()

const TRANSFER_ORIGENS = new Set(['TRANSFERENCIA', 'SALDO_CONTA_BANCARIA'])

// Telas que consomem este endpoint (via DashboardLayout.filteredData ou widgets).
// Liberar se o usuário tiver QUALQUER uma — bloqueia só quem nunca veria
// dados financeiros (ex.: permissões só de metas/notas_fiscais/qualidade).
const SCREENS_QUE_USAM: Screen[] = [
  'visao_geral',
  'dre',
  'centros_custo',
  'comparativo',
  'lancamentos',
]

/**
 * GET /api/financeiro?de=YYYY-MM-DD&ate=YYYY-MM-DD&regime=competencia|caixa
 *
 * REGIME = caixa
 *   Fonte primária: ca.baixas (cada baixa vira UMA linha) — captura corretamente:
 *     - pagamentos parciais em datas distintas
 *     - decomposição bruto / taxa / desconto / juros / multa
 *   Complementado por linhas "em aberto" (status IN Aberto/Atrasado/Parcial,
 *   valor_aberto > 0) vindas direto de contas_receber/pagar com data_vencimento.
 *
 * REGIME = competencia
 *   Fonte: ca.contas_receber + ca.contas_pagar (UNION) com data =
 *   COALESCE(data_competencia, data_vencimento). Status válidos: NOT IN
 *   ('Cancelado', 'Renegociado') — inclui Aberto/Atrasado/Parcial além de Quitado.
 *
 * Em ambos os regimes, o JOIN traz nome de categoria, CC, fornecedor e conta.
 * Origem TRANSFERENCIA / SALDO_CONTA_BANCARIA é marcada com isTransfer=true e
 * pode ser filtrada no frontend.
 */
export async function GET(request: Request) {
  try {
    const access = await getUserAccess()
    if (!access.isAdmin && !SCREENS_QUE_USAM.some((s) => access.telasPermitidas.includes(s))) {
      return NextResponse.json(
        { error: 'Sem permissão para acessar dados financeiros.' },
        { status: 403 },
      )
    }

    const { searchParams } = new URL(request.url)
    const de     = searchParams.get('de')     || null
    const ate    = searchParams.get('ate')    || null
    const regime = searchParams.get('regime') || 'competencia'

    const qParams: (string | null)[] = [de, ate]

    let query: string

    if (regime === 'caixa') {
      // ── CAIXA: baixas (realizadas) + em-aberto via vencimento ───────────────
      query = `
        WITH realizadas AS (
          SELECT
            CASE b.tipo WHEN 'RECEITA' THEN 'Receita' ELSE 'Despesa' END AS tipo,
            COALESCE(cr.descricao, cp.descricao, '')                AS descricao,
            b.data_pagamento                                         AS data,
            b.valor_bruto                                            AS valor,
            b.valor                                                  AS valor_dre,
            'Quitado'                                                AS status,
            COALESCE(cr.origem, cp.origem, '')                       AS origem,
            COALESCE(cr.categoria_id, cp.categoria_id)               AS categoria_id,
            COALESCE(cr.centro_custo_id, cp.centro_custo_id)         AS centro_custo_id,
            COALESCE(cr.pessoa_id, cp.pessoa_id)                     AS pessoa_id,
            b.conta_financeira_id                                    AS conta_id,
            b.forma_pagamento                                        AS forma
          FROM ca.baixas b
          LEFT JOIN ca.contas_receber cr ON cr.id = b.evento_id AND b.tipo = 'RECEITA'
          LEFT JOIN ca.contas_pagar   cp ON cp.id = b.evento_id AND b.tipo = 'DESPESA'
          WHERE COALESCE(cr.status, cp.status) NOT IN ('Cancelado', 'Renegociado')
            AND ($1::date IS NULL OR b.data_pagamento >= $1)
            AND ($2::date IS NULL OR b.data_pagamento <= $2)
        ),
        em_aberto AS (
          SELECT
            'Receita'              AS tipo,
            cr.descricao           AS descricao,
            cr.data_vencimento     AS data,
            cr.valor_aberto        AS valor,
            cr.valor_aberto        AS valor_dre,
            cr.status              AS status,
            COALESCE(cr.origem,'') AS origem,
            cr.categoria_id,
            cr.centro_custo_id,
            cr.pessoa_id,
            cr.conta_financeira_id AS conta_id,
            ''                     AS forma
          FROM ca.contas_receber cr
          WHERE cr.status IN ('Aberto', 'Atrasado', 'Parcial')
            AND cr.valor_aberto > 0
            AND ($1::date IS NULL OR cr.data_vencimento >= $1)
            AND ($2::date IS NULL OR cr.data_vencimento <= $2)

          UNION ALL

          SELECT
            'Despesa', cp.descricao, cp.data_vencimento,
            cp.valor_aberto, cp.valor_aberto, cp.status,
            COALESCE(cp.origem,''), cp.categoria_id, cp.centro_custo_id,
            cp.pessoa_id, cp.conta_financeira_id, ''
          FROM ca.contas_pagar cp
          WHERE cp.status IN ('Aberto', 'Atrasado', 'Parcial')
            AND cp.valor_aberto > 0
            AND ($1::date IS NULL OR cp.data_vencimento >= $1)
            AND ($2::date IS NULL OR cp.data_vencimento <= $2)
        ),
        unioned AS (
          SELECT * FROM realizadas
          UNION ALL
          SELECT * FROM em_aberto
        )
        SELECT
          t.tipo,
          t.descricao                AS desc,
          COALESCE(p.nome,  '')      AS fornecedor,
          COALESCE(cf.nome, '')      AS conta,
          COALESCE(t.valor, 0)       AS valor,
          COALESCE(t.valor_dre, t.valor, 0) AS valordre,
          t.status                   AS situacao,
          -- DATE forçada como string YYYY-MM-DD (sem timezone) para evitar
          -- shift em servidores não-BR. O frontend parseia com componentes
          -- locais. Ver fix do bug em fix/dre-timezone-bug.
          TO_CHAR(t.data, 'YYYY-MM-DD') AS data,
          TO_CHAR(t.data, 'YYYY-MM')    AS data_ym,
          COALESCE(t.origem, '')     AS origem,
          COALESCE(t.forma, '')      AS forma,
          COALESCE(cat.nome, '')     AS cat1,
          COALESCE(cc.nome,  '')     AS cc1
        FROM unioned t
        LEFT JOIN ca.categorias        cat ON cat.id = t.categoria_id
        LEFT JOIN ca.centros_custo     cc  ON cc.id  = t.centro_custo_id
        LEFT JOIN ca.pessoas           p   ON p.id   = t.pessoa_id
        LEFT JOIN ca.contas_financeiras cf ON cf.id  = t.conta_id
      `
    } else {
      // ── COMPETÊNCIA: contas_receber + contas_pagar com data_competencia ─────
      // status NOT IN (Cancelado, Renegociado) — inclui Aberto/Atrasado/Parcial.
      // O frontend trata "realizada vs prevista" pela coluna situacao.
      query = `
        WITH unioned AS (
          SELECT
            'Receita' AS tipo,
            descricao,
            COALESCE(data_competencia, data_vencimento) AS data,
            total          AS valor,
            COALESCE(valor_pago, total, 0) AS valor_dre,
            status,
            COALESCE(origem, '') AS origem,
            categoria_id,
            centro_custo_id,
            pessoa_id,
            conta_financeira_id AS conta_id,
            '' AS forma
          FROM ca.contas_receber
          WHERE status NOT IN ('Cancelado', 'Renegociado')
            AND ($1::date IS NULL OR COALESCE(data_competencia, data_vencimento) >= $1)
            AND ($2::date IS NULL OR COALESCE(data_competencia, data_vencimento) <= $2)

          UNION ALL

          SELECT
            'Despesa', descricao,
            COALESCE(data_competencia, data_vencimento),
            total, COALESCE(valor_pago, total, 0), status,
            COALESCE(origem, ''), categoria_id, centro_custo_id, pessoa_id,
            conta_financeira_id, ''
          FROM ca.contas_pagar
          WHERE status NOT IN ('Cancelado', 'Renegociado')
            AND ($1::date IS NULL OR COALESCE(data_competencia, data_vencimento) >= $1)
            AND ($2::date IS NULL OR COALESCE(data_competencia, data_vencimento) <= $2)
        )
        SELECT
          t.tipo,
          t.descricao                AS desc,
          COALESCE(p.nome,  '')      AS fornecedor,
          COALESCE(cf.nome, '')      AS conta,
          COALESCE(t.valor, 0)       AS valor,
          COALESCE(t.valor_dre, t.valor, 0) AS valordre,
          t.status                   AS situacao,
          -- DATE forçada como string YYYY-MM-DD (sem timezone) para evitar
          -- shift em servidores não-BR. O frontend parseia com componentes
          -- locais. Ver fix do bug em fix/dre-timezone-bug.
          TO_CHAR(t.data, 'YYYY-MM-DD') AS data,
          TO_CHAR(t.data, 'YYYY-MM')    AS data_ym,
          COALESCE(t.origem, '')     AS origem,
          COALESCE(t.forma, '')      AS forma,
          COALESCE(cat.nome, '')     AS cat1,
          COALESCE(cc.nome,  '')     AS cc1
        FROM unioned t
        LEFT JOIN ca.categorias        cat ON cat.id = t.categoria_id
        LEFT JOIN ca.centros_custo     cc  ON cc.id  = t.centro_custo_id
        LEFT JOIN ca.pessoas           p   ON p.id   = t.pessoa_id
        LEFT JOIN ca.contas_financeiras cf ON cf.id  = t.conta_id
      `
    }

    const { rows: lancamentos } = await pool.query(query, qParams)

    const { rows: contasRows } = await pool.query(
      'SELECT DISTINCT nome FROM ca.contas_financeiras ORDER BY nome'
    )
    const listaContas = contasRows.map((r: { nome: string }) => r.nome)

    const result: Lancamento[] = lancamentos.map((row: any) => {
      const isTransfer = TRANSFER_ORIGENS.has(row.origem || '')

      const v    = Math.abs(Number(row.valor))
      const vDRE = Math.abs(Number(row.valordre)) || v

      const cat1Name = row.cat1 || '(em branco)'
      const cc1Name  = row.cc1  || '(em branco)'

      // data já vem como string 'YYYY-MM-DD' do SQL (TO_CHAR). NÃO converter
      // para Date aqui — JSON serializaria como ISO-Z e em browser com fuso
      // negativo (BR) cria off-by-one day. Quem precisar de Date parseia
      // com componentes locais no client (via parseLocalYMD em lib/utils).
      const dataStr: string | null = row.data || null
      const dataYm:  string | null = row.data_ym || (dataStr ? dataStr.slice(0,7) : null)

      return {
        data:       dataStr as unknown as Date | null,   // tipo Lancamento.data ainda é Date — frontend converte
        data_ym:    dataYm ?? undefined,
        desc:       row.desc || row.fornecedor,
        fornecedor: row.fornecedor,
        tipo:       row.tipo as 'Receita' | 'Despesa',
        origem:     row.origem || '',
        conta:      row.conta,
        forma:      row.forma || '',
        valor:      v,
        valorDRE:   vDRE,
        situacao:   row.situacao,
        isTransfer,
        cat1:       row.cat1,
        catSup:     '',
        catSup1:    '',
        cc1:        row.cc1,
        categorias: row.cat1 ? [{ nome: cat1Name, valor: v }] : [],
        _ccList:    row.cc1  ? [{ nome: cc1Name,  valor: v }] : [],
      }
    })

    return NextResponse.json({ lancamentos: result, contas: listaContas }, {
      headers: { 'Cache-Control': 'no-store' },
    })

  } catch (err) {
    console.error('API /financeiro error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
