import { NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

export async function GET() {
  try {
    const client = await pool.connect()
    try {
      // ── Card A: Última Sincronização ──────────────────────────────────────────
      const syncRes = await client.query<{ ultimo_sync: Date | null }>(`
        SELECT MAX(synced_at) AS ultimo_sync FROM ca.baixas
      `)

      // ── Card B: Baixas com Valor ──────────────────────────────────────────────
      const baixasValorRes = await client.query<{ total: string; com_valor: string }>(`
        SELECT
          COUNT(*)                                  AS total,
          COUNT(*) FILTER (WHERE valor > 0)         AS com_valor
        FROM ca.baixas
      `)

      // ── Card C: Composição Íntegra ────────────────────────────────────────────
      const composicaoRes = await client.query<{ divergentes: string }>(`
        SELECT COUNT(*) AS divergentes
        FROM ca.baixas
        WHERE valor_bruto > 0
          AND ROUND( (valor_bruto - desconto - taxa + juros + multa) - valor , 2) <> 0
      `)

      // ── Card D: Recebimentos com Data ─────────────────────────────────────────
      const recDataRes = await client.query<{ quitados: string; com_data: string }>(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'Quitado')                                  AS quitados,
          COUNT(*) FILTER (WHERE status = 'Quitado' AND data_recebimento IS NOT NULL)  AS com_data
        FROM ca.contas_receber
      `)

      // ── Card E: Pagamentos com Data ───────────────────────────────────────────
      const pagDataRes = await client.query<{ quitados: string; com_data: string }>(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'Quitado')                               AS quitados,
          COUNT(*) FILTER (WHERE status = 'Quitado' AND data_pagamento IS NOT NULL) AS com_data
        FROM ca.contas_pagar
      `)

      // ── Card F: Vínculo Venda ─────────────────────────────────────────────────
      const vinculoRes = await client.query<{ orfas: string }>(`
        SELECT COUNT(*) AS orfas
        FROM ca.contas_receber
        WHERE descricao ~ 'Venda [0-9]' AND id_venda IS NULL
      `)

      // ── Card G: Classificação Contábil (global, não filtrado) ─────────────────
      const classifRes = await client.query<{ sem_categoria: string; sem_cc: string }>(`
        SELECT
          (SELECT COUNT(*) FROM ca.contas_receber WHERE categoria_id IS NULL)
          + (SELECT COUNT(*) FROM ca.contas_pagar WHERE categoria_id IS NULL)  AS sem_categoria,
          (SELECT COUNT(*) FROM ca.contas_receber WHERE centro_custo_id IS NULL)
          + (SELECT COUNT(*) FROM ca.contas_pagar WHERE centro_custo_id IS NULL) AS sem_cc
      `)

      // ── Atrasados Globais (não filtrado por período) ──────────────────────────
      const atrasadosRecRes = await client.query<{ count: string; total: string }>(`
        SELECT COUNT(*) AS count, COALESCE(SUM(valor_liquido), 0) AS total
        FROM ca.contas_receber
        WHERE status = 'Atrasado'
      `)
      const atrasadosPagRes = await client.query<{ count: string; total: string }>(`
        SELECT COUNT(*) AS count, COALESCE(SUM(valor_liquido), 0) AS total
        FROM ca.contas_pagar
        WHERE status = 'Atrasado'
      `)

      // ── Monitor de Conciliação ─────────────────────────────────────────────────
      // Apenas contas com requer_conciliacao = true e ativo = true
      let conciliacaoRows: object[] = []
      try {
        const conciliacaoRes = await client.query(`
          SELECT
            cf.nome,
            cf.saldo_atual,
            cf.data_ultima_conciliacao,
            (CURRENT_DATE - cf.data_ultima_conciliacao)          AS dias_sem_conciliar,
            COUNT(b.id) FILTER (WHERE b.id_reconciliacao IS NULL) AS itens_nao_conciliados,
            COUNT(b.id)                                           AS total_itens
          FROM ca.contas_financeiras cf
          LEFT JOIN ca.baixas b ON b.conta_financeira_id = cf.id
          WHERE cf.ativo = true
            AND cf.requer_conciliacao = true
          GROUP BY cf.nome, cf.saldo_atual, cf.data_ultima_conciliacao
          ORDER BY dias_sem_conciliar DESC NULLS FIRST
        `)
        conciliacaoRows = conciliacaoRes.rows
      } catch {
        // Coluna pode não existir ainda — trata graciosamente
        conciliacaoRows = []
      }

      // ── Montar resposta ───────────────────────────────────────────────────────

      const b = baixasValorRes.rows[0]
      const baixasTotal   = parseInt(b.total)   || 0
      const baixasComValor = parseInt(b.com_valor) || 0

      const rd = recDataRes.rows[0]
      const recQuitados  = parseInt(rd.quitados)  || 0
      const recComData   = parseInt(rd.com_data)  || 0

      const pd = pagDataRes.rows[0]
      const pagQuitados  = parseInt(pd.quitados)  || 0
      const pagComData   = parseInt(pd.com_data)  || 0

      const semCat = parseInt(classifRes.rows[0].sem_categoria) || 0
      const semCC  = parseInt(classifRes.rows[0].sem_cc)        || 0

      const atRec  = atrasadosRecRes.rows[0]
      const atPag  = atrasadosPagRes.rows[0]

      return NextResponse.json({
        // Cards de integridade ETL
        integridade: {
          // A — Última sincronização
          ultimo_sync: syncRes.rows[0]?.ultimo_sync ?? null,

          // B — Baixas com valor
          baixas_total:     baixasTotal,
          baixas_com_valor: baixasComValor,
          baixas_pct_valor: baixasTotal > 0 ? baixasComValor / baixasTotal : null,

          // C — Composição íntegra
          composicao_divergentes: parseInt(composicaoRes.rows[0]?.divergentes) || 0,

          // D — Recebimentos com data
          rec_quitados: recQuitados,
          rec_com_data: recComData,
          rec_pct_data: recQuitados > 0 ? recComData / recQuitados : null,

          // E — Pagamentos com data
          pag_quitados: pagQuitados,
          pag_com_data: pagComData,
          pag_pct_data: pagQuitados > 0 ? pagComData / pagQuitados : null,

          // F — Vínculo venda
          orfas: parseInt(vinculoRes.rows[0]?.orfas) || 0,

          // G — Classificação contábil (GLOBAL)
          sem_categoria: semCat,
          sem_cc:        semCC,
        },

        // Atrasados globais (não filtrado por período)
        atrasados_global: {
          receber_count: parseInt(atRec.count)  || 0,
          receber_total: parseFloat(atRec.total) || 0,
          pagar_count:   parseInt(atPag.count)   || 0,
          pagar_total:   parseFloat(atPag.total)  || 0,
        },

        // Monitor de conciliação
        conciliacao: conciliacaoRows,
      })
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('Qualidade API error:', err)
    return NextResponse.json({ error: 'Failed to fetch qualidade data' }, { status: 500 })
  }
}
