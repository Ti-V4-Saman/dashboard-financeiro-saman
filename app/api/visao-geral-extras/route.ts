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
import { getPool } from '@/lib/db'

export const dynamic = 'force-dynamic'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContratosData {
  ativos:            number
  receitaRecorrente: number
  ticketMedio:       number
  aVencer60:         number
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

const pool = getPool()

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
      // Fórmula híbrida (auditoria em docs/auditoria-saldos-bancarios.md):
      //   - CARTAO_CREDITO:    -Σ(parcelas vencidas em aberto)
      //   - MEIOS_RECEBIMENTO: Σbaixas (RECEITA−DESPESA) + transf_in − transf_out
      //   - demais tipos:      cf.saldo_atual (ETL persiste valor do CA, confiável p/ CC/Caixinha)
      // O /v1/conta-financeira/{id}/saldo-atual da CA devolve saldo bruto não-conciliado
      // para tipos passagem (MR) e dívida histórica para cartão; aplicar a fórmula aqui
      // alinha o número com a tela do CA.
      const contasRes = await client.query<{
        id: string; nome: string; tipo: string; banco: string | null
        saldo: string; saldo_etl: string
        data_ultima_conciliacao: string | null
        synced_at: string | null
      }>(`
        WITH parcelas_vencidas_cartao AS (
          SELECT pp.conta_financeira_id, SUM(cp.valor_aberto) AS valor_vencido
          FROM ca.parcelas_pagar pp
          JOIN ca.contas_pagar cp ON cp.id = pp.conta_pagar_id
          WHERE pp.data_vencimento < CURRENT_DATE
            AND cp.valor_aberto > 0
            AND cp.status NOT IN ('Cancelado', 'Renegociado')
          GROUP BY pp.conta_financeira_id
        ),
        movimentos_baixas AS (
          -- Issue #33: ignorar baixas cuja parcela ainda esta ATRASADO/Atrasado.
          -- Esse estado indica que a baixa foi registrada (com data_pagamento) mas
          -- nao foi efetivamente quitada -- tipicamente reversao/estorno que a API
          -- nao propagou para todos os campos. Ex.: Mktlab Boleto tinha 2 baixas
          -- (R$ 6.118,81) nesse estado, fazendo o saldo divergir da tela do CA.
          SELECT b.conta_financeira_id,
            SUM(CASE WHEN b.tipo = 'RECEITA' THEN b.valor ELSE 0 END) -
            SUM(CASE WHEN b.tipo = 'DESPESA' THEN b.valor ELSE 0 END) AS movimento
          FROM ca.baixas b
          LEFT JOIN ca.parcelas_receber pr ON pr.id = b.evento_id AND b.tipo = 'RECEITA'
          LEFT JOIN ca.parcelas_pagar   pp ON pp.id = b.evento_id AND b.tipo = 'DESPESA'
          WHERE b.conta_financeira_id IS NOT NULL
            AND UPPER(COALESCE(pr.status, pp.status, '')) <> 'ATRASADO'
          GROUP BY b.conta_financeira_id
        ),
        transf_in AS (
          SELECT conta_destino_id AS conta_id, SUM(valor) AS valor_in
          FROM ca.transferencias WHERE conta_destino_id IS NOT NULL
          GROUP BY conta_destino_id
        ),
        transf_out AS (
          SELECT conta_origem_id AS conta_id, SUM(valor) AS valor_out
          FROM ca.transferencias WHERE conta_origem_id IS NOT NULL
          GROUP BY conta_origem_id
        )
        SELECT
          cf.id, cf.nome, cf.tipo, cf.banco,
          cf.saldo_atual AS saldo_etl,
          cf.data_ultima_conciliacao,
          cf.synced_at,
          CASE
            WHEN cf.tipo = 'CARTAO_CREDITO' THEN
              -- Issue #34: parcelas vencidas em aberto que ja foram pagas
              -- via transferencia agrupada (fatura) nao sao zeradas individualmente
              -- pela API CA. Descontamos transferencias recebidas para evitar dupla
              -- contagem; se transf_in cobriu toda a divida vencida, saldo = 0.
              -GREATEST(0, COALESCE(pvc.valor_vencido, 0) - COALESCE(ti.valor_in, 0))
            WHEN cf.tipo = 'MEIOS_RECEBIMENTO' THEN
              COALESCE(mb.movimento, 0)
              + COALESCE(ti.valor_in, 0)
              - COALESCE(t_o.valor_out, 0)
            ELSE COALESCE(cf.saldo_atual, 0)
          END AS saldo
        FROM ca.contas_financeiras cf
        LEFT JOIN parcelas_vencidas_cartao pvc ON pvc.conta_financeira_id = cf.id
        LEFT JOIN movimentos_baixas        mb  ON mb.conta_financeira_id  = cf.id
        LEFT JOIN transf_in                ti  ON ti.conta_id             = cf.id
        LEFT JOIN transf_out               t_o ON t_o.conta_id            = cf.id
        WHERE cf.ativo = true
        ORDER BY saldo DESC NULLS LAST, cf.nome
      `)

      // Projeção 30 dias (a_receber/a_pagar) foi movida para o widget Ponto de
      // Equilíbrio, que mostra o mês corrente + 2 futuros em vez de janela
      // rolante. Endpoint dedicado: /api/ponto-equilibrio.

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
      // Bloco "Indicadores" (DRE resumida) foi removido — substituido pelo
      // widget ResumoTrimestralWidget (calculado client-side a partir do
      // array de lancamentos ja em memoria, sem RPC dedicada).
      let blocos: {
        contratos: ContratosData | null
        notas:     NotasData     | null
      } = { contratos: null, notas: null }

      // 4b. Contratos (fotografia atual — independe do filtro)
      try {
        const ctrRes = await client.query<{
          ativos: string; receita_recorrente: string
          a_vencer_60: string; vencidos_ativos: string
          inativos: string; sem_cc: string
        }>(`
          SELECT
            COUNT(*) FILTER (WHERE status = 'ATIVO')                                                          AS ativos,
            COALESCE(SUM(valor_total) FILTER (WHERE status = 'ATIVO'), 0)                                     AS receita_recorrente,
            -- A vencer em 60 dias — alinhado com critério "próximos do término" do Conta Azul
            COUNT(*) FILTER (WHERE status = 'ATIVO'
              AND data_fim BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days')                        AS a_vencer_60,
            COUNT(*) FILTER (WHERE status = 'ATIVO' AND data_fim < CURRENT_DATE)                              AS vencidos_ativos,
            COUNT(*) FILTER (WHERE status = 'INATIVO')                                                        AS inativos,
            -- Sem CC só faz sentido para ATIVOS (inativos já não vão movimentar)
            COUNT(*) FILTER (WHERE status = 'ATIVO' AND centro_custo_id IS NULL)                              AS sem_cc
          FROM ca.contratos
        `)
        const cr = ctrRes.rows[0]
        const ativos = Number(cr.ativos)
        const recRec = Number(cr.receita_recorrente)
        blocos.contratos = {
          ativos,
          receitaRecorrente: Math.round(recRec * 100) / 100,
          ticketMedio:       ativos > 0 ? Math.round(recRec / ativos * 100) / 100 : 0,
          aVencer60:         Number(cr.a_vencer_60),
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
          // Cobertura de NF = vendas únicas com NF emitida / total de vendas únicas
          // Conta apenas CRs/baixas COM id_venda (lançamentos manuais sem venda
          // — Liquidação Cartão, PIX avulso etc — nunca geram NF e não devem
          // entrar no denominador).
          const vendasUnicasQ = regime === 'caixa' ? `
            SELECT COUNT(DISTINCT cr.id_venda) AS total
            FROM ca.baixas b
            JOIN ca.contas_receber cr ON cr.id = b.evento_id
            WHERE b.tipo = 'RECEITA'
              AND cr.id_venda IS NOT NULL
              AND cr.status NOT IN ('Cancelado','Renegociado')
              AND COALESCE(cr.origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
              AND b.data_pagamento BETWEEN $1 AND $2
          ` : `
            SELECT COUNT(DISTINCT id_venda) AS total
            FROM ca.contas_receber
            WHERE id_venda IS NOT NULL
              AND status NOT IN ('Cancelado','Renegociado')
              AND COALESCE(origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
              AND COALESCE(data_competencia, data_vencimento) BETWEEN $1 AND $2
          `

          // Pago sem nota: vendas únicas (DISTINCT id_venda) com baixa no período
          // mas sem NF emitida. Valor = soma das baixas/quitações no período.
          const semNotaQ = regime === 'caixa' ? `
            SELECT
              COUNT(DISTINCT cr.id_venda)                AS qtd,
              COALESCE(SUM(b.valor_bruto), 0)            AS valor
            FROM ca.baixas b
            JOIN ca.contas_receber cr ON cr.id = b.evento_id
            WHERE b.tipo = 'RECEITA'
              AND cr.id_venda IS NOT NULL
              AND cr.status NOT IN ('Cancelado','Renegociado')
              AND COALESCE(cr.origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
              AND b.data_pagamento BETWEEN $1 AND $2
              AND NOT EXISTS (
                SELECT 1 FROM ca.notas_fiscais nf
                WHERE nf.venda_id = cr.id_venda AND nf.status = 'EMITIDA'
              )
          ` : `
            SELECT
              COUNT(DISTINCT cr.id_venda)                          AS qtd,
              COALESCE(SUM(COALESCE(cr.valor_pago, cr.total)), 0)  AS valor
            FROM ca.contas_receber cr
            WHERE cr.status = 'Quitado'
              AND cr.id_venda IS NOT NULL
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

            client.query<{ total: string }>(vendasUnicasQ, [de, ate]),
            client.query<{ qtd: string; valor: string }>(semNotaQ, [de, ate]),
          ])

          const nfRow = nfRes.rows[0]
          const vendasUnicas = Number(crRes.rows[0].total)
          const emitidas = Number(nfRow.emitidas)
          // Cobertura = NFs emitidas / vendas únicas no período. Cap em 100% caso
          // existam NFs emitidas referenciando vendas fora do período (raro).
          const coberturaPct = vendasUnicas > 0
            ? Math.min(100, Math.round(emitidas / vendasUnicas * 100))
            : 100

          blocos.notas = {
            emitidas,
            lancamentosReceita: vendasUnicas,
            coberturaPct,
            qtdSemNota:         vendasUnicas - emitidas > 0 ? vendasUnicas - emitidas : 0,
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
      const agora = Date.now()
      const contas = contasRes.rows.map(r => {
        const syncedAt = r.synced_at ?? null
        const horasDesdeSync = syncedAt
          ? Math.max(0, Math.round((agora - new Date(syncedAt).getTime()) / 3_600_000))
          : null
        return {
          id:   r.id,
          nome: r.nome,
          tipo: traduzirTipo(r.tipo),
          banco: r.banco ?? null,
          saldo: Number(r.saldo) || 0,
          saldoEtl: Number(r.saldo_etl) || 0,
          dataUltimaConciliacao: r.data_ultima_conciliacao ?? null,
          syncedAt,
          horasDesdeSync,
        }
      })

      return NextResponse.json({
        saldos: {
          contas,
          consolidado: contas.reduce((s, c) => s + c.saldo, 0),
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
