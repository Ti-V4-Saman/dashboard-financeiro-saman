import { NextResponse } from 'next/server'
import { Pool } from 'pg'
import type { Lancamento } from '@/lib/types'

export const dynamic = 'force-dynamic'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const TRANSFER_ORIGENS = new Set(['TRANSFERENCIA', 'SALDO_CONTA_BANCARIA'])

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const de     = searchParams.get('de')     || null   // YYYY-MM-DD | null
    const ate    = searchParams.get('ate')    || null   // YYYY-MM-DD | null
    const regime = searchParams.get('regime') || 'competencia'

    // ── Build date filter depending on regime ─────────────────────────────────
    // $1 = de (date or null), $2 = ate (date or null)
    const qParams: (string | null)[] = [de, ate]

    let recedberDateExpr: string
    let pagarDateExpr: string
    let recedberWhere: string
    let pagarWhere: string

    if (regime === 'caixa') {
      recedberDateExpr = 'data_recebimento'
      pagarDateExpr    = 'data_pagamento'
      recedberWhere = `
        status = 'Quitado'
        AND status NOT IN ('Cancelado', 'Renegociado')
        AND ($1::date IS NULL OR data_recebimento >= $1)
        AND ($2::date IS NULL OR data_recebimento <= $2)
      `
      pagarWhere = `
        status = 'Quitado'
        AND status NOT IN ('Cancelado', 'Renegociado')
        AND ($1::date IS NULL OR data_pagamento >= $1)
        AND ($2::date IS NULL OR data_pagamento <= $2)
      `
    } else {
      // competencia: usa COALESCE(data_competencia, data_vencimento)
      recedberDateExpr = 'COALESCE(data_competencia, data_vencimento)'
      pagarDateExpr    = 'COALESCE(data_competencia, data_vencimento)'
      recedberWhere = `
        status NOT IN ('Cancelado', 'Renegociado')
        AND ($1::date IS NULL OR COALESCE(data_competencia, data_vencimento) >= $1)
        AND ($2::date IS NULL OR COALESCE(data_competencia, data_vencimento) <= $2)
      `
      pagarWhere = recedberWhere
    }

    const query = `
      SELECT
          t.tipo,
          t.descricao                   AS desc,
          COALESCE(p.nome,  '')         AS fornecedor,
          COALESCE(cf.nome, '')         AS conta,
          COALESCE(t.total, 0)          AS valor,
          COALESCE(t.valor_pago, t.total, 0) AS valordre,
          t.status                      AS situacao,
          t.data                        AS data,
          COALESCE(t.origem, '')        AS origem,
          COALESCE(cat.nome, '')        AS cat1,
          COALESCE(cc.nome,  '')        AS cc1
      FROM (
          SELECT
              'Receita'               AS tipo,
              descricao,
              total,
              valor_pago,
              ${recedberDateExpr}     AS data,
              status,
              origem,
              categoria_id,
              conta_financeira_id     AS conta_id,
              pessoa_id,
              centro_custo_id
          FROM ca.contas_receber
          WHERE ${recedberWhere}

          UNION ALL

          SELECT
              'Despesa'               AS tipo,
              descricao,
              total,
              valor_pago,
              ${pagarDateExpr}        AS data,
              status,
              origem,
              categoria_id,
              conta_financeira_id     AS conta_id,
              pessoa_id,
              centro_custo_id
          FROM ca.contas_pagar
          WHERE ${pagarWhere}
      ) t
      LEFT JOIN ca.categorias        cat ON cat.id = t.categoria_id
      LEFT JOIN ca.centros_custo     cc  ON cc.id  = t.centro_custo_id
      LEFT JOIN ca.pessoas           p   ON p.id   = t.pessoa_id
      LEFT JOIN ca.contas_financeiras cf ON cf.id  = t.conta_id
    `

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

      const parsedDate: Date | null = row.data ? new Date(row.data) : null

      return {
        data:       parsedDate,
        desc:       row.desc || row.fornecedor,
        fornecedor: row.fornecedor,
        tipo:       row.tipo as 'Receita' | 'Despesa',
        origem:     row.origem || '',
        conta:      row.conta,
        forma:      '',
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
