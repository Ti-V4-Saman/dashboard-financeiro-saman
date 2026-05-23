/**
 * GET /api/ponto-equilibrio
 *
 * Retorna projeção de fluxo dos próximos 3 meses (mês corrente + 2 futuros)
 * para o widget Ponto de Equilíbrio na Visão Geral.
 *
 * REGRAS DE NEGÓCIO (críticas):
 *   • Regime sempre CAIXA — ignora seletor de regime do dashboard.
 *   • Timezone forçado America/Sao_Paulo no cálculo de "hoje" e meses.
 *   • Antecipações tratadas para não dupla-contagem:
 *      - "Já entrou" = baixas no período (qualquer data_vencimento)
 *      - "A entrar"  = CR com vencimento no mês E sem baixa antes do mês
 *   • Sem parâmetros de query (mês é calculado dinamicamente).
 *
 * Notas de implementação:
 *   • Para excluir transferências usamos `cr.origem NOT IN (...)` em vez
 *     do LEFT JOIN com ca.transferencias — baixas.evento_id aponta para
 *     parcelas, não para transferências.
 *   • Saldo usa coluna `saldo_atual` (não `saldo`) e filtra `ativo=true`.
 */
import { NextResponse } from 'next/server'
import { Pool } from 'pg'
import { getHojeBR, getMesRange, toYMD, type MesRange } from '@/lib/timezone-br'
import { diasUteis } from '@/lib/dias-uteis'

export const dynamic = 'force-dynamic'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

// ── Types da resposta ────────────────────────────────────────────────────────

interface ReceitaAtual {
  ja_entrou_total:         number
  ja_entrou_no_vencimento: number
  ja_entrou_antecipacao:   number
  ja_entrou_recuperacao:   number
  a_entrar:                number
  qtd_a_entrar:            number
  em_atraso:               number
  qtd_em_atraso:           number
  total_potencial:         number
}

interface DespesaAtual {
  ja_saiu:             number
  a_pagar:             number
  qtd_a_pagar:         number
  em_atraso:           number
  total_comprometido:  number
}

interface ReceitaFutura {
  a_entrar:        number
  qtd_a_entrar:    number
  total_potencial: number
}

interface DespesaFutura {
  a_pagar:            number
  qtd_a_pagar:        number
  total_comprometido: number
}

interface MesAtualPayload {
  mes_ref:              string
  mes_label:            string
  is_atual:             true
  dias_uteis_restantes: number
  receita:              ReceitaAtual
  despesa:              DespesaAtual
  gap:                  number
  saldo_projetado:      number
}

interface MesFuturoPayload {
  mes_ref:           string
  mes_label:         string
  is_atual:          false
  dias_uteis_total:  number
  receita:           ReceitaFutura
  despesa:           DespesaFutura
  gap:               number
}

type MesPayload = MesAtualPayload | MesFuturoPayload

interface ResponsePayload {
  saldo_atual:    number
  calculado_em:   string
  meses:          MesPayload[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function r2(v: number): number {
  return Math.round(v * 100) / 100
}

/** Adiciona/subtrai dias de uma data YMD e devolve YMD. */
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return toYMD(dt)
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const hoje      = getHojeBR()
    const hojeYMD   = toYMD(hoje)
    const ontemYMD  = addDays(hojeYMD, -1)
    const amanhaYMD = addDays(hojeYMD,  1)

    const mesAtual:   MesRange = getMesRange(0)
    const mesProximo: MesRange = getMesRange(1)
    const mesSubProx: MesRange = getMesRange(2)

    const client = await pool.connect()
    try {
      // ── 1. Saldo atual consolidado ─────────────────────────────────────────
      const saldoRes = await client.query<{ saldo: string }>(
        `SELECT COALESCE(SUM(saldo_atual), 0)::numeric AS saldo
         FROM ca.contas_financeiras
         WHERE ativo = true`,
      )
      const saldoAtual = Number(saldoRes.rows[0].saldo) || 0

      // ── 2. Mês corrente — "Já entrou" decomposto ───────────────────────────
      const jaEntrouRes = await client.query<{ categoria: string; valor: string }>(
        `
        WITH baixas_mes AS (
          SELECT
            b.valor,
            CASE
              WHEN cr.data_vencimento > $2::date THEN 'antecipacao'
              WHEN cr.data_vencimento >= $1::date THEN 'no_vencimento'
              ELSE 'recuperacao_atraso'
            END AS categoria
          FROM ca.baixas b
          INNER JOIN ca.contas_receber cr ON cr.id = b.evento_id
          WHERE b.tipo = 'RECEITA'
            AND b.data_pagamento BETWEEN $1::date AND $3::date
            AND COALESCE(cr.origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
        )
        SELECT categoria, SUM(valor)::numeric(15,2) AS valor
        FROM baixas_mes
        GROUP BY categoria
        `,
        [mesAtual.inicio, mesAtual.fim, hojeYMD],
      )
      let jaEntrouNoVenc = 0, jaEntrouAnt = 0, jaEntrouRec = 0
      for (const row of jaEntrouRes.rows) {
        const v = Number(row.valor) || 0
        if (row.categoria === 'antecipacao')        jaEntrouAnt = v
        else if (row.categoria === 'no_vencimento') jaEntrouNoVenc = v
        else                                         jaEntrouRec = v
      }

      // ── 3. Mês corrente — "Já saiu" ────────────────────────────────────────
      const jaSaiuRes = await client.query<{ valor: string }>(
        `
        SELECT COALESCE(SUM(b.valor), 0)::numeric AS valor
        FROM ca.baixas b
        LEFT JOIN ca.contas_pagar cp ON cp.id = b.evento_id
        WHERE b.tipo = 'DESPESA'
          AND b.data_pagamento BETWEEN $1::date AND $2::date
          AND COALESCE(cp.origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
        `,
        [mesAtual.inicio, hojeYMD],
      )
      const jaSaiu = Number(jaSaiuRes.rows[0].valor) || 0

      // ── 4 & 5. "A entrar" e "A pagar" para os 3 meses ──────────────────────
      // Mês atual: range = amanhã até fim do mês
      // Meses futuros: range = mês inteiro
      // $1 = início do range / $2 = fim do range / $3 = primeiro dia do mês
      //                                              (cutoff de antecipação)
      type AbertoRow = { valor: string; qtd: string }

      const queryAReceber = (start: string, end: string, mesIni: string) =>
        client.query<AbertoRow>(
          `
          SELECT COALESCE(SUM(cr.total), 0)::numeric AS valor, COUNT(*)::text AS qtd
          FROM ca.contas_receber cr
          WHERE cr.data_vencimento BETWEEN $1::date AND $2::date
            AND cr.status NOT IN ('Cancelado','Renegociado')
            AND COALESCE(cr.origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
            AND NOT EXISTS (
              SELECT 1 FROM ca.baixas b
              WHERE b.evento_id = cr.id
                AND b.data_pagamento < $3::date
            )
          `,
          [start, end, mesIni],
        )

      const queryAPagar = (start: string, end: string, mesIni: string) =>
        client.query<AbertoRow>(
          `
          SELECT COALESCE(SUM(cp.total), 0)::numeric AS valor, COUNT(*)::text AS qtd
          FROM ca.contas_pagar cp
          WHERE cp.data_vencimento BETWEEN $1::date AND $2::date
            AND cp.status NOT IN ('Cancelado','Renegociado')
            AND COALESCE(cp.origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
            AND NOT EXISTS (
              SELECT 1 FROM ca.baixas b
              WHERE b.evento_id = cp.id
                AND b.data_pagamento < $3::date
            )
          `,
          [start, end, mesIni],
        )

      // Range "a receber/pagar" do mês corrente: amanhã → fim do mês
      const startAtualRange =
        amanhaYMD > mesAtual.fim ? mesAtual.fim : amanhaYMD

      const [
        aReceberAtualRes, aReceberProxRes, aReceberSubRes,
        aPagarAtualRes,   aPagarProxRes,   aPagarSubRes,
      ] = await Promise.all([
        queryAReceber(startAtualRange, mesAtual.fim,   mesAtual.inicio),
        queryAReceber(mesProximo.inicio, mesProximo.fim, mesProximo.inicio),
        queryAReceber(mesSubProx.inicio, mesSubProx.fim, mesSubProx.inicio),
        queryAPagar  (startAtualRange, mesAtual.fim,   mesAtual.inicio),
        queryAPagar  (mesProximo.inicio, mesProximo.fim, mesProximo.inicio),
        queryAPagar  (mesSubProx.inicio, mesSubProx.fim, mesSubProx.inicio),
      ])

      // ── 6. Receita em atraso (mês corrente) ────────────────────────────────
      const emAtrasoRecRes = await client.query<AbertoRow>(
        `
        SELECT COALESCE(SUM(cr.total), 0)::numeric AS valor, COUNT(*)::text AS qtd
        FROM ca.contas_receber cr
        WHERE cr.data_vencimento BETWEEN $1::date AND $2::date
          AND cr.status IN ('Atrasado','Aberto')
          AND COALESCE(cr.origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
          AND NOT EXISTS (SELECT 1 FROM ca.baixas b WHERE b.evento_id = cr.id)
        `,
        [mesAtual.inicio, ontemYMD],
      )

      // ── 7. Despesa em atraso (mês corrente) ────────────────────────────────
      const emAtrasoDespRes = await client.query<{ valor: string }>(
        `
        SELECT COALESCE(SUM(cp.total), 0)::numeric AS valor
        FROM ca.contas_pagar cp
        WHERE cp.data_vencimento BETWEEN $1::date AND $2::date
          AND cp.status IN ('Atrasado','Aberto')
          AND COALESCE(cp.origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
          AND NOT EXISTS (SELECT 1 FROM ca.baixas b WHERE b.evento_id = cp.id)
        `,
        [mesAtual.inicio, ontemYMD],
      )

      // ── 8. Montar payload ──────────────────────────────────────────────────
      const jaEntrouTotal  = r2(jaEntrouNoVenc + jaEntrouAnt + jaEntrouRec)
      const aEntrarAtual   = Number(aReceberAtualRes.rows[0].valor) || 0
      const emAtrasoRec    = Number(emAtrasoRecRes.rows[0].valor)   || 0
      const qtdEmAtrasoRec = Number(emAtrasoRecRes.rows[0].qtd)     || 0
      const aPagarAtual    = Number(aPagarAtualRes.rows[0].valor)   || 0
      const emAtrasoDesp   = Number(emAtrasoDespRes.rows[0].valor)  || 0

      const totalPotAtual    = r2(jaEntrouTotal + aEntrarAtual + emAtrasoRec)
      const totalCompAtual   = r2(jaSaiu + aPagarAtual + emAtrasoDesp)
      const gapAtual         = r2(totalPotAtual - totalCompAtual)
      const saldoProjetado   = r2(saldoAtual + gapAtual)

      // Dias úteis restantes do mês atual: de amanhã até fim do mês
      const [yMA, mMA, dMA] = mesAtual.fim.split('-').map(Number)
      const fimMesDate = new Date(yMA, mMA - 1, dMA)
      const amanhaDate = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1)
      const diasUteisRest = diasUteis(amanhaDate, fimMesDate)

      const cardAtual: MesAtualPayload = {
        mes_ref:              mesAtual.mes_ref,
        mes_label:            mesAtual.label,
        is_atual:             true,
        dias_uteis_restantes: diasUteisRest,
        receita: {
          ja_entrou_total:         jaEntrouTotal,
          ja_entrou_no_vencimento: r2(jaEntrouNoVenc),
          ja_entrou_antecipacao:   r2(jaEntrouAnt),
          ja_entrou_recuperacao:   r2(jaEntrouRec),
          a_entrar:                r2(aEntrarAtual),
          qtd_a_entrar:            Number(aReceberAtualRes.rows[0].qtd) || 0,
          em_atraso:               r2(emAtrasoRec),
          qtd_em_atraso:           qtdEmAtrasoRec,
          total_potencial:         totalPotAtual,
        },
        despesa: {
          ja_saiu:            r2(jaSaiu),
          a_pagar:            r2(aPagarAtual),
          qtd_a_pagar:        Number(aPagarAtualRes.rows[0].qtd) || 0,
          em_atraso:          r2(emAtrasoDesp),
          total_comprometido: totalCompAtual,
        },
        gap:             gapAtual,
        saldo_projetado: saldoProjetado,
      }

      const buildFuturo = (
        rng: MesRange,
        aRec: { rows: AbertoRow[] },
        aPag: { rows: AbertoRow[] },
      ): MesFuturoPayload => {
        const vRec = Number(aRec.rows[0].valor) || 0
        const vPag = Number(aPag.rows[0].valor) || 0
        const [y, m, d] = rng.fim.split('-').map(Number)
        const [yi, mi, di] = rng.inicio.split('-').map(Number)
        const diasUteisTot = diasUteis(new Date(yi, mi - 1, di), new Date(y, m - 1, d))
        return {
          mes_ref:    rng.mes_ref,
          mes_label:  rng.label,
          is_atual:   false,
          dias_uteis_total: diasUteisTot,
          receita: {
            a_entrar:        r2(vRec),
            qtd_a_entrar:    Number(aRec.rows[0].qtd) || 0,
            total_potencial: r2(vRec),
          },
          despesa: {
            a_pagar:            r2(vPag),
            qtd_a_pagar:        Number(aPag.rows[0].qtd) || 0,
            total_comprometido: r2(vPag),
          },
          gap: r2(vRec - vPag),
        }
      }

      const cardProx = buildFuturo(mesProximo, aReceberProxRes, aPagarProxRes)
      const cardSub  = buildFuturo(mesSubProx, aReceberSubRes,  aPagarSubRes)

      const payload: ResponsePayload = {
        saldo_atual:  r2(saldoAtual),
        calculado_em: new Date().toISOString(),
        meses:        [cardAtual, cardProx, cardSub],
      }

      return NextResponse.json(payload, {
        headers: { 'Cache-Control': 'no-store' },
      })
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('[ponto-equilibrio]', err)
    return NextResponse.json(
      { error: 'Failed to fetch ponto equilibrio' },
      { status: 500 },
    )
  }
}
