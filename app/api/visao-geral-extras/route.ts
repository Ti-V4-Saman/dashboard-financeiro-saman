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

// ── Types ─────────────────────────────────────────────────────────────────────

interface ValorPct { valor: number; pct: number }

interface IndicadoresData {
  receitaLiquida:  number
  mgOperacional:   ValorPct
  mgContribuicao:  ValorPct
  ebitda:          ValorPct
  csp:             ValorPct
  comercial:       ValorPct
  administrativa:  ValorPct
  gerais:          ValorPct
}

interface ContratosData {
  ativos:            number
  receitaRecorrente: number
  ticketMedio:       number
  aVencer30:         number
  vencidosAtivos:    number
  inativos:          number
  semCC:             number
}

interface NotasData {
  emitidas:          number
  lancamentosReceita:number
  coberturaPct:      number
  qtdSemNota:        number
  valorFaturado:     number
  canceladasFalha:   number
  detalheCancel:     string
  pagoSemNotaQtd:    number
  pagoSemNotaValor:  number
}

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

        // Em CAIXA, usa ca.baixas (pagamento efetivo); cnt = DISTINCT lançamento.
        // Em COMPETÊNCIA, usa ca.contas_receber direto com COALESCE(competencia, vencimento).
        const recQ = (caixa: boolean) => caixa ? `
            SELECT COUNT(DISTINCT b.evento_id) AS cnt,
                   COALESCE(SUM(b.valor_bruto), 0) AS total
            FROM ca.baixas b
            JOIN ca.contas_receber cr ON cr.id = b.evento_id
            WHERE b.tipo = 'RECEITA'
              AND cr.status NOT IN ('Cancelado', 'Renegociado')
              AND COALESCE(cr.origem, '') NOT IN ('TRANSFERENCIA', 'SALDO_CONTA_BANCARIA')
              AND b.data_pagamento BETWEEN $1 AND $2
        ` : `
            SELECT COUNT(*) AS cnt,
                   COALESCE(SUM(total), 0) AS total
            FROM ca.contas_receber
            WHERE status NOT IN ('Cancelado', 'Renegociado')
              AND COALESCE(origem, '') NOT IN ('TRANSFERENCIA', 'SALDO_CONTA_BANCARIA')
              AND COALESCE(data_competencia, data_vencimento) BETWEEN $1 AND $2
        `

        const pagQ = (caixa: boolean) => caixa ? `
            SELECT COALESCE(SUM(b.valor_bruto), 0) AS total
            FROM ca.baixas b
            JOIN ca.contas_pagar cp ON cp.id = b.evento_id
            WHERE b.tipo = 'DESPESA'
              AND cp.status NOT IN ('Cancelado', 'Renegociado')
              AND COALESCE(cp.origem, '') NOT IN ('TRANSFERENCIA', 'SALDO_CONTA_BANCARIA')
              AND b.data_pagamento BETWEEN $1 AND $2
        ` : `
            SELECT COALESCE(SUM(total), 0) AS total
            FROM ca.contas_pagar
            WHERE status NOT IN ('Cancelado', 'Renegociado')
              AND COALESCE(origem, '') NOT IN ('TRANSFERENCIA', 'SALDO_CONTA_BANCARIA')
              AND COALESCE(data_competencia, data_vencimento) BETWEEN $1 AND $2
        `

        const isCaixa = regime === 'caixa'
        const [curRec, curDesp, prevRec, prevDesp] = await Promise.all([
          client.query<{ cnt: string; total: string }>(recQ(isCaixa), [de, ate]),
          client.query<{ total: string }>          (pagQ(isCaixa), [de, ate]),
          client.query<{ cnt: string; total: string }>(recQ(isCaixa), [prevDe, prevAte]),
          client.query<{ total: string }>          (pagQ(isCaixa), [prevDe, prevAte]),
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

      // ── 4. Blocos de resumo ───────────────────────────────────────────────
      let blocos: {
        indicadores: IndicadoresData | null
        contratos:   ContratosData   | null
        notas:       NotasData       | null
      } = { indicadores: null, contratos: null, notas: null }

      // 4a. Indicadores (DRE resumida do período)
      if (de && ate) {
        try {
          // CAIXA → fonte = ca.baixas (uma linha por baixa, valor = valor_bruto)
          // COMPETÊNCIA → fonte = ca.contas_receber/pagar com COALESCE(comp, venc)
          const indSql = regime === 'caixa' ? `
            SELECT
              t.tipo,
              COALESCE(cat.nome, '') AS cat_nome,
              COALESCE(SUM(t.valor), 0)::numeric AS valor
            FROM (
              SELECT 'Receita' AS tipo, cr.categoria_id AS categoria_id,
                     b.valor_bruto AS valor, COALESCE(cr.origem, '') AS origem
              FROM ca.baixas b
              JOIN ca.contas_receber cr ON cr.id = b.evento_id
              WHERE b.tipo = 'RECEITA'
                AND cr.status NOT IN ('Cancelado','Renegociado')
                AND b.data_pagamento BETWEEN $1 AND $2
              UNION ALL
              SELECT 'Despesa', cp.categoria_id,
                     b.valor_bruto, COALESCE(cp.origem, '')
              FROM ca.baixas b
              JOIN ca.contas_pagar cp ON cp.id = b.evento_id
              WHERE b.tipo = 'DESPESA'
                AND cp.status NOT IN ('Cancelado','Renegociado')
                AND b.data_pagamento BETWEEN $1 AND $2
            ) t
            LEFT JOIN ca.categorias cat ON cat.id = t.categoria_id
            WHERE t.origem NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
            GROUP BY t.tipo, cat.nome
          ` : `
            SELECT
              t.tipo,
              COALESCE(cat.nome, '') AS cat_nome,
              COALESCE(SUM(t.total), 0)::numeric AS valor
            FROM (
              SELECT 'Receita' AS tipo, categoria_id, total, COALESCE(origem,'') AS origem
              FROM ca.contas_receber
              WHERE status NOT IN ('Cancelado','Renegociado')
                AND COALESCE(data_competencia, data_vencimento) BETWEEN $1 AND $2
              UNION ALL
              SELECT 'Despesa', categoria_id, total, COALESCE(origem,'')
              FROM ca.contas_pagar
              WHERE status NOT IN ('Cancelado','Renegociado')
                AND COALESCE(data_competencia, data_vencimento) BETWEEN $1 AND $2
            ) t
            LEFT JOIN ca.categorias cat ON cat.id = t.categoria_id
            WHERE t.origem NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
            GROUP BY t.tipo, cat.nome
          `
          const indRes = await client.query<{ tipo: string; cat_nome: string; valor: string }>(indSql, [de, ate])

          // numPrefix — extracts leading numeric prefix (e.g. "4.1.01 Foo" → 4.1)
          const numPfx = (s: string): number => {
            const m = s.match(/^(\d+(?:\.\d+)?)/)
            return m ? Number(m[1]) : 999
          }

          const catRows = indRes.rows.map(r => ({
            tipo:     r.tipo,
            cat_nome: r.cat_nome,
            valor:    Number(r.valor),
          }))

          // Signed accumulator mirroring DRE groupSum
          const groupSum = (maxP: number) =>
            catRows.reduce((s, r) => {
              if (numPfx(r.cat_nome) <= maxP)
                return s + (r.tipo === 'Receita' ? r.valor : -r.valor)
              return s
            }, 0)

          // Absolute sum for a category band (Despesa only)
          const despBand = (pfxMin: number, pfxMax: number) =>
            catRows
              .filter(r => r.tipo === 'Despesa' && numPfx(r.cat_nome) >= pfxMin && numPfx(r.cat_nome) < pfxMax)
              .reduce((s, r) => s + r.valor, 0)

          const recLiq      = groupSum(2.99)
          const lubruto     = groupSum(3.99)
          const ebitda      = groupSum(4.99)
          const cspAbs      = despBand(3, 4)
          const comercialAbs= despBand(4.1, 4.2)
          const adminAbs    = despBand(4.2, 4.3)
          const geraisAbs   = despBand(4.3, 4.4)
          const margContrib = lubruto - comercialAbs

          const pct = (v: number) => recLiq > 0 ? Math.round(v / recLiq * 1000) / 10 : 0
          const vp  = (v: number) => ({ valor: Math.round(v * 100) / 100, pct: pct(v) })

          blocos.indicadores = {
            receitaLiquida: Math.round(recLiq * 100) / 100,
            mgOperacional:  vp(lubruto),
            mgContribuicao: vp(margContrib),
            ebitda:         vp(ebitda),
            csp:            vp(cspAbs),
            comercial:      vp(comercialAbs),
            administrativa: vp(adminAbs),
            gerais:         vp(geraisAbs),
          }
        } catch (e) {
          console.error('[blocos/indicadores]', e)
        }
      }

      // 4b. Contratos (fotografia atual — independe do filtro)
      try {
        const ctrRes = await client.query<{
          ativos: string; receita_recorrente: string
          a_vencer_30: string; vencidos_ativos: string
          inativos: string; sem_cc: string
        }>(`
          SELECT
            COUNT(*) FILTER (WHERE status = 'ATIVO')                                                          AS ativos,
            COALESCE(SUM(valor_total) FILTER (WHERE status = 'ATIVO'), 0)                                     AS receita_recorrente,
            COUNT(*) FILTER (WHERE status = 'ATIVO'
              AND data_fim BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days')                        AS a_vencer_30,
            COUNT(*) FILTER (WHERE status = 'ATIVO' AND data_fim < CURRENT_DATE)                              AS vencidos_ativos,
            COUNT(*) FILTER (WHERE status = 'INATIVO')                                                        AS inativos,
            COUNT(*) FILTER (WHERE centro_custo_id IS NULL)                                                   AS sem_cc
          FROM ca.contratos
        `)
        const cr = ctrRes.rows[0]
        const ativos = Number(cr.ativos)
        const recRec = Number(cr.receita_recorrente)
        blocos.contratos = {
          ativos,
          receitaRecorrente: Math.round(recRec * 100) / 100,
          ticketMedio:       ativos > 0 ? Math.round(recRec / ativos * 100) / 100 : 0,
          aVencer30:         Number(cr.a_vencer_30),
          vencidosAtivos:    Number(cr.vencidos_ativos),
          inativos:          Number(cr.inativos),
          semCC:             Number(cr.sem_cc),
        }
      } catch (e) {
        console.error('[blocos/contratos]', e)
      }

      // 4c. Notas Fiscais (respeita período)
      if (de && ate) {
        try {
          // "Lançamentos receita" e "Pago sem nota" — fonte depende do regime
          const lancRecQ = regime === 'caixa' ? `
            SELECT COUNT(DISTINCT b.evento_id) AS total
            FROM ca.baixas b
            JOIN ca.contas_receber cr ON cr.id = b.evento_id
            WHERE b.tipo = 'RECEITA'
              AND cr.status NOT IN ('Cancelado','Renegociado')
              AND COALESCE(cr.origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
              AND b.data_pagamento BETWEEN $1 AND $2
          ` : `
            SELECT COUNT(*) AS total
            FROM ca.contas_receber
            WHERE status NOT IN ('Cancelado','Renegociado')
              AND COALESCE(origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
              AND COALESCE(data_competencia, data_vencimento) BETWEEN $1 AND $2
          `

          // Pago sem nota: sempre conta apenas o que foi efetivamente pago
          // (faz sentido apenas para receitas com pagamento — Quitado / com baixa)
          const semNotaQ = regime === 'caixa' ? `
            SELECT
              COUNT(DISTINCT b.evento_id)            AS qtd,
              COALESCE(SUM(b.valor_bruto), 0)        AS valor
            FROM ca.baixas b
            JOIN ca.contas_receber cr ON cr.id = b.evento_id
            WHERE b.tipo = 'RECEITA'
              AND cr.status NOT IN ('Cancelado','Renegociado')
              AND COALESCE(cr.origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
              AND b.data_pagamento BETWEEN $1 AND $2
              AND NOT EXISTS (
                SELECT 1 FROM ca.notas_fiscais nf
                WHERE nf.venda_id = cr.id_venda AND nf.status = 'EMITIDA'
              )
          ` : `
            SELECT
              COUNT(*)                                              AS qtd,
              COALESCE(SUM(COALESCE(cr.valor_pago, cr.total)), 0)   AS valor
            FROM ca.contas_receber cr
            WHERE cr.status = 'Quitado'
              AND COALESCE(cr.data_competencia, cr.data_vencimento) BETWEEN $1 AND $2
              AND COALESCE(cr.origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
              AND NOT EXISTS (
                SELECT 1 FROM ca.notas_fiscais nf
                WHERE nf.venda_id = cr.id_venda AND nf.status = 'EMITIDA'
              )
          `

          const [nfRes, crRes, semNotaRes] = await Promise.all([
            // Notas emitidas + canceladas no período
            client.query<{ emitidas: string; valor_faturado: string; canceladas_falha: string; detalhe: string }>(`
              SELECT
                COUNT(*) FILTER (WHERE status = 'EMITIDA')                                                    AS emitidas,
                COALESCE(SUM(COALESCE(valor_total, 0)) FILTER (WHERE status = 'EMITIDA'), 0)                  AS valor_faturado,
                COUNT(*) FILTER (WHERE status IN ('CANCELADA','CANCELAMENTO_MANUAL','FALHA'))                  AS canceladas_falha,
                CONCAT_WS(' · ',
                  NULLIF(COUNT(*) FILTER (WHERE status IN ('CANCELADA','CANCELAMENTO_MANUAL'))::text || ' cancel', '0 cancel'),
                  NULLIF(COUNT(*) FILTER (WHERE status = 'FALHA')::text || ' falha', '0 falha')
                )                                                                                              AS detalhe
              FROM ca.notas_fiscais
              WHERE data_emissao BETWEEN $1 AND $2
            `, [de, ate]),

            client.query<{ total: string }>(lancRecQ, [de, ate]),
            client.query<{ qtd: string; valor: string }>(semNotaQ, [de, ate]),
          ])

          const nfRow = nfRes.rows[0]
          const lancRec = Number(crRes.rows[0].total)
          const emitidas = Number(nfRow.emitidas)
          const coberturaPct = lancRec > 0 ? Math.round(emitidas / lancRec * 100) : 100

          blocos.notas = {
            emitidas,
            lancamentosReceita: lancRec,
            coberturaPct,
            qtdSemNota:         lancRec - emitidas > 0 ? lancRec - emitidas : 0,
            valorFaturado:      Math.round(Number(nfRow.valor_faturado) * 100) / 100,
            canceladasFalha:    Number(nfRow.canceladas_falha),
            detalheCancel:      nfRow.detalhe || '',
            pagoSemNotaQtd:     Number(semNotaRes.rows[0].qtd),
            pagoSemNotaValor:   Math.round(Number(semNotaRes.rows[0].valor) * 100) / 100,
          }
        } catch (e) {
          console.error('[blocos/notas]', e)
        }
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
        blocos,
      })
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('[visao-geral-extras]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
