import { NextResponse } from 'next/server'
import { Pool } from 'pg'
import type { Lancamento } from '@/lib/types'

export const dynamic = 'force-dynamic'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
})

const TRANSFER_CATS = new Set([
  'transferência de entrada',
  'transferência de saída',
  'saldo inicial',
])

export async function GET() {
  try {
    const query = `
      SELECT 
          t.tipo,
          t.descricao as desc,
          COALESCE(p.nome, '') as fornecedor,
          COALESCE(cf.nome, '') as conta,
          COALESCE(t.total, 0) as valor,
          COALESCE(t.valor_pago, t.total, 0) as valordre,
          t.status as situacao,
          t.data_vencimento as data,
          COALESCE(cat.nome, '') as cat1,
          COALESCE(cc.nome, '') as cc1
      FROM (
          SELECT 
              'Receita' as tipo, descricao, total, valor_pago, 
              data_vencimento, status, 
              categoria_id, conta_financeira_id as conta_id, pessoa_id, centro_custo_id
          FROM ca.contas_receber
          
          UNION ALL
          
          SELECT 
              'Despesa' as tipo, descricao, total, valor_pago, 
              data_vencimento, status, 
              categoria_id, conta_financeira_id as conta_id, pessoa_id, centro_custo_id
          FROM ca.contas_pagar
      ) t
      LEFT JOIN ca.categorias cat ON cat.id = t.categoria_id
      LEFT JOIN ca.centros_custo cc ON cc.id = t.centro_custo_id
      LEFT JOIN ca.pessoas p ON p.id = t.pessoa_id
      LEFT JOIN ca.contas_financeiras cf ON cf.id = t.conta_id
    `

    const { rows: lancamentos } = await pool.query(query)
    
    // Buscar todas as contas para o filtro (apenas nomes únicos para evitar erro de key duplicada)
    const { rows: contasRows } = await pool.query("SELECT DISTINCT nome FROM ca.contas_financeiras ORDER BY nome")
    const listaContas = contasRows.map(r => r.nome)

    const result: Lancamento[] = lancamentos.map((row: any) => {
      const catLower = (row.cat1 || '').toLowerCase()
      const isTransferCat = TRANSFER_CATS.has(catLower)
      const isTransfer = isTransferCat
      
      const v = Math.abs(Number(row.valor))
      const vDRE = Math.abs(Number(row.valordre)) || v
      
      const cat1Name = row.cat1 || '(em branco)'
      const cc1Name = row.cc1 || '(em branco)'
      
      let parsedDate: Date | null = null
      if (row.data) {
        parsedDate = new Date(row.data)
      }

      return {
        data: parsedDate,
        desc: row.desc || row.fornecedor,
        fornecedor: row.fornecedor,
        tipo: row.tipo as 'Receita' | 'Despesa',
        origem: '',
        conta: row.conta,
        forma: '',
        valor: v,
        valorDRE: vDRE,
        situacao: row.situacao,
        isTransfer,
        cat1: row.cat1,
        catSup: '',
        catSup1: '',
        cc1: row.cc1,
        categorias: row.cat1 ? [{ nome: cat1Name, valor: v }] : [],
        _ccList: row.cc1 ? [{ nome: cc1Name, valor: v }] : [],
      }
    })

    return NextResponse.json({ lancamentos: result, contas: listaContas }, {
      headers: { 'Cache-Control': 'no-store' },
    })

  } catch (err) {
    console.error('API /financeiro error database:', err)
    return NextResponse.json({ error: 'Internal server error from DB' }, { status: 500 })
  }
}
