/**
 * GET /api/visao-geral-extras?de=YYYY-MM-DD&ate=YYYY-MM-DD&regime=competencia|caixa
 *
 * Retorna em uma única chamada:
 *   - saldos: contas ativas + consolidado + projeção 30 dias
 *   - insights: variação de ticket médio e burn vs período anterior
 *
 * Cacheado 60s pelo Next.js (revalidate).
 */
import { NextResponse } from 'next/server'
import { Pool } from 'pg'

export const dynamic = 'force-dynamic'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function traduzirTipo(tipo: string): string {
  const map: Record<string, string> = {
    CONTA_CORRENTE:     'Conta corrente',
    CONTA_POUPANCA:     'Conta poupança',
    CARTAO_CREDITO:     'Cartão de crédito',
    MEIOS_RECEBIMENTO:  'Meio de recebimento',
    CAIXINHA:           'Caixinha',
    INVESTIMENTO:       'Investimento',
  }
  return map[tipo] ?? tipo
}

/** Calcula o período anterior com a mesma duração em dias. */
function prevPeriod(de: string, ate: string): { prevDe: string; prevAte: string } {
  const d0 = new Date(de + 'T00:00:00')
  const d1 = new Date(ate + 'T00:00:00')
  // duração em ms (inclusive)
  const durMs = d1.getTime() - d0.getTime() + 86_400_000
  const prevAteTs = d0.getTime() - 86_400_000       // dia antes do início atual
  const prevDeTs  = prevAteTs - durMs + 86_400_000  // mesmo número de dias
  const fmt = (ts: number) => new Date(ts).toISOString().slice(0, 10)
  return { prevDe: fmt(prevDeTs), prevAte: fmt(prevAteTs) }
}

/** Percentual e direção de variação. Null se não há base de comparação. */
function variacao(
  atual: number,
  anterior: number,
): { percentual: number; direcao: 'up' | 'down' | 'stable' } | null {
  if (anterior === 0) return null
  const pct = ((atual - anterior) / anterior) * 100
  const direcao = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'stable'
  return { percentual: Math.round(Math.abs(pct)), direcao }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const de     = searchParams.get('de')     || null
    const ate    = searchParams.get('ate')    || null
    const regime = searchParams.get('regime') || 'competencia'

    const client = await pool.connect()
    try {
      // ── 1. Saldos das contas ativas ───────────────────────────────────────
      const contasRes = await client.query<{
        id: string; nome: string; tipo: string; banco: string | null
        saldo_atual: string; data_ultima_conciliacao: string | null
      }>(`
        SELECT id, nome, tipo, banco, saldo_atual, data_ultima_conciliacao
        FROM ca.contas_financeiras
        WHERE ativo = true
        ORDER BY saldo_atual DESC NULLS LAST, nome
      `)

      // ── 2. Projeção 30 dias ───────────────────────────────────────────────
      const [aReceberRes, aPagarRes] = await Promise.all([
        client.query<{ total: string }>(`
          SELECT COALESCE(SUM(valor_aberto), 0) AS total
          FROM ca.contas_receber
          WHERE data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
            AND status IN ('Aberto', 'Atrasado')
        `),
        client.query<{ total: string }>(`
          SELECT COALESCE(SUM(valor_aberto), 0) AS total
          FROM ca.contas_pagar
          WHERE data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
            AND status IN ('Aberto', 'Atrasado', 'Parcial')
        `),
      ])

      // ── 3. Variação vs período anterior (só se período foi fornecido) ─────
      let ticketVariacao: ReturnType<typeof variacao> = null
      let burnVariacao:   ReturnType<typeof variacao> = null

      if (de && ate) {
        const { prevDe, prevAte } = prevPeriod(de, ate)

        // Expressões de data por regime
        const recExpr  = regime === 'caixa' ? 'data_recebimento'                : 'COALESCE(data_competencia, data_vencimento)'
        const pagExpr  = regime === 'caixa' ? 'data_pagamento'
                        : 'COALESCE(data_competencia, data_vencimento)'
        const recWhere = regime === 'caixa' ? "status = 'Quitado'"
                        : "status NOT IN ('Cancelado', 'Renegociado')"
        const pagWhere = recWhere

        const [curRec, curDesp, prevRec, prevDesp] = await Promise.all([
          // Receitas atuais
          client.query<{ cnt: string; total: string }>(`
            SELECT COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS total
            FROM ca.contas_receber
            WHERE ${recWhere}
              AND ${recExpr} BETWEEN $1 AND $2
          `, [de, ate]),
          // Despesas atuais
          client.query<{ total: string }>(`
            SELECT COALESCE(SUM(total), 0) AS total
            FROM ca.contas_pagar
            WHERE ${pagWhere}
              AND ${pagExpr} BETWEEN $1 AND $2
          `, [de, ate]),
          // Receitas período anterior
          client.query<{ cnt: string; total: string }>(`
            SELECT COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS total
            FROM ca.contas_receber
            WHERE ${recWhere}
              AND ${recExpr} BETWEEN $1 AND $2
          `, [prevDe, prevAte]),
          // Despesas período anterior
          client.query<{ total: string }>(`
            SELECT COALESCE(SUM(total), 0) AS total
            FROM ca.contas_pagar
            WHERE ${pagWhere}
              AND ${pagExpr} BETWEEN $1 AND $2
          `, [prevDe, prevAte]),
        ])

        // Ticket médio
        const curCnt    = Number(curRec.rows[0].cnt)
        const curRecTot = Number(curRec.rows[0].total)
        const prevCnt   = Number(prevRec.rows[0].cnt)
        const prevRecTot= Number(prevRec.rows[0].total)
        const curTicket  = curCnt  > 0 ? curRecTot  / curCnt  : 0
        const prevTicket = prevCnt > 0 ? prevRecTot / prevCnt : 0
        ticketVariacao = variacao(curTicket, prevTicket)

        // Burn diário
        const dias0 = new Date(de + 'T00:00:00')
        const dias1 = new Date(ate + 'T00:00:00')
        const nDias = Math.max(1, Math.round((dias1.getTime() - dias0.getTime()) / 86_400_000) + 1)
        const pDias0 = new Date(prevDe + 'T00:00:00')
        const pDias1 = new Date(prevAte + 'T00:00:00')
        const pNDias = Math.max(1, Math.round((pDias1.getTime() - pDias0.getTime()) / 86_400_000) + 1)
        const curBurn  = Number(curDesp.rows[0].total)  / nDias
        const prevBurn = Number(prevDesp.rows[0].total) / pNDias
        burnVariacao = variacao(curBurn, prevBurn)
      }

      // ── Resposta ──────────────────────────────────────────────────────────
      const contas = contasRes.rows.map(r => ({
        id:   r.id,
        nome: r.nome,
        tipo: traduzirTipo(r.tipo),
        banco: r.banco ?? null,
        saldo: Number(r.saldo_atual) || 0,
        dataUltimaConciliacao: r.data_ultima_conciliacao ?? null,
      }))

      return NextResponse.json({
        saldos: {
          contas,
          consolidado:              contas.reduce((s, c) => s + c.saldo, 0),
          aReceberProximos30Dias:   Number(aReceberRes.rows[0].total) || 0,
          aPagarProximos30Dias:     Number(aPagarRes.rows[0].total)   || 0,
        },
        insights: {
          ticketVariacao,
          burnVariacao,
        },
      })
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('[visao-geral-extras]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
