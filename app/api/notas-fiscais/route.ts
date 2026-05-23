/**
 * GET /api/notas-fiscais?de=YYYY-MM-DD&ate=YYYY-MM-DD&regime=competencia|caixa
 *
 * Retorna dataset unificado para a aba Notas Fiscais:
 *   • rows: linhas individuais (uma por NF emitida/cancelada/falha OU venda pendente)
 *   • summary: agregados para os 5 KPIs do topo
 *
 * Regras:
 *   - Caixa: vendas únicas com baixa no período (DISTINCT cr.id_venda)
 *   - Competência: vendas únicas com data_competencia no período
 *   - "Pendente" = venda no período sem NF emitida
 *   - "Emitida/Cancelada/Falha" = NFs com data_emissao no período
 */
import { NextResponse } from 'next/server'
import { Pool } from 'pg'

export const dynamic = 'force-dynamic'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

export interface NotaRow {
  id: string                                          // id NF, ou venda_id quando sem NF
  kind: 'emitida' | 'cancelada' | 'falha' | 'paga_sem_nf' | 'a_receber'
  numero: number | null                               // número da NF (null para sem NF)
  lancamento: string                                  // descricao da CR
  cliente: string
  valor: number
  data_emissao: string | null                         // YYYY-MM-DD (null para sem NF)
  data_referencia: string | null                      // data da venda/baixa/competência/vencimento
  status_raw: string                                  // EMITIDA, CANCELADA, CANCELAMENTO_MANUAL, FALHA, PAGA_SEM_NF, A_RECEBER
  tempo_emissao_dias: number | null                   // dias entre data_referencia e data_emissao
}

interface Summary {
  emitidas:           { qtd: number; valor: number }
  pagas_sem_nf:       { qtd: number; valor: number }   // baixa no período sem NF emitida
  a_receber:          { qtd: number; valor: number }   // venc no período, em aberto/atrasado/parcial, sem NF emitida
  cobertura_pct:      number
  vendas_unicas:      number
  canceladas_falha:   { qtd: number; canceladas: number; falhas: number; valor: number }
  tempo_medio_dias:   number | null
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const de     = searchParams.get('de')     || null
    const ate    = searchParams.get('ate')    || null
    const regime = searchParams.get('regime') || 'competencia'

    if (!de || !ate) {
      return NextResponse.json(
        { error: 'Parâmetros de e ate são obrigatórios' },
        { status: 400 },
      )
    }

    const client = await pool.connect()
    try {
      // ── 1. Vendas únicas no período (com dados básicos) ─────────────────────
      // Em caixa: vendas com baixa no período. Em competência: vendas cuja CR
      // tem data_competencia no período. Pegamos a CR "principal" (menor data)
      // para descricao, cliente e total.
      // GROUP BY apenas id_venda — UMA linha por venda única, mesmo que ela
      // tenha múltiplas parcelas (CRs) com descricoes diferentes (ex: "1/12",
      // "2/12"...). Usamos MIN/MAX para escolher representantes determinísticos.
      const vendasSql = regime === 'caixa' ? `
        WITH base AS (
          SELECT
            cr.id_venda,
            MIN(cr.descricao)                            AS descricao_ref,
            MIN(cr.pessoa_id::text)                      AS pessoa_id_txt,
            MIN(b.data_pagamento)                        AS data_ref,
            SUM(b.valor_bruto)                           AS valor
          FROM ca.baixas b
          JOIN ca.contas_receber cr ON cr.id = b.evento_id
          WHERE b.tipo = 'RECEITA'
            AND cr.id_venda IS NOT NULL
            AND cr.status NOT IN ('Cancelado','Renegociado')
            AND COALESCE(cr.origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
            AND b.data_pagamento BETWEEN $1 AND $2
          GROUP BY cr.id_venda
        )
        SELECT
          base.id_venda::text                       AS id_venda,
          base.descricao_ref                        AS descricao,
          COALESCE(p.nome, '')                      AS cliente,
          base.data_ref::text                       AS data_ref,
          base.valor::float                         AS valor
        FROM base
        LEFT JOIN ca.pessoas p ON p.id::text = base.pessoa_id_txt
      ` : `
        WITH base AS (
          SELECT
            cr.id_venda,
            MIN(cr.descricao)                                       AS descricao_ref,
            MIN(cr.pessoa_id::text)                                 AS pessoa_id_txt,
            MIN(COALESCE(cr.data_competencia, cr.data_vencimento))  AS data_ref,
            SUM(cr.total)                                           AS valor
          FROM ca.contas_receber cr
          WHERE cr.id_venda IS NOT NULL
            AND cr.status NOT IN ('Cancelado','Renegociado')
            AND COALESCE(cr.origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
            AND COALESCE(cr.data_competencia, cr.data_vencimento) BETWEEN $1 AND $2
          GROUP BY cr.id_venda
        )
        SELECT
          base.id_venda::text                AS id_venda,
          base.descricao_ref                 AS descricao,
          COALESCE(p.nome, '')               AS cliente,
          base.data_ref::text                AS data_ref,
          base.valor::float                  AS valor
        FROM base
        LEFT JOIN ca.pessoas p ON p.id::text = base.pessoa_id_txt
      `

      // ── 2. NFs do período (qualquer status) ────────────────────────────────
      const nfsSql = `
        SELECT
          nf.id::text                       AS id,
          nf.numero,
          nf.status                         AS status,
          nf.venda_id::text                 AS venda_id,
          nf.data_emissao::text             AS data_emissao,
          COALESCE(nf.valor_total, 0)::float AS valor,
          COALESCE(NULLIF(nf.nome_cliente, ''), p.nome, '') AS cliente
        FROM ca.notas_fiscais nf
        LEFT JOIN ca.pessoas p ON p.id = nf.cliente_id
        WHERE nf.data_emissao BETWEEN $1 AND $2
      `

      // ── 2b. A RECEBER no período (vendas em aberto/atrasado/parcial) ───────
      // Critério: id_venda IS NOT NULL (são vendas reais, podem gerar NF) +
      // data_vencimento no período + status pendente.
      // Vai gerar UMA linha por venda única.
      const aReceberSql = `
        WITH base AS (
          SELECT
            cr.id_venda,
            MIN(cr.descricao)                AS descricao_ref,
            MIN(cr.pessoa_id::text)          AS pessoa_id_txt,
            MIN(cr.data_vencimento)          AS data_ref,
            SUM(cr.valor_aberto)             AS valor
          FROM ca.contas_receber cr
          WHERE cr.id_venda IS NOT NULL
            AND cr.status IN ('Aberto', 'Atrasado', 'Parcial')
            AND COALESCE(cr.origem, '') NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')
            AND cr.data_vencimento BETWEEN $1 AND $2
          GROUP BY cr.id_venda
        )
        SELECT
          base.id_venda::text                AS id_venda,
          base.descricao_ref                 AS descricao,
          COALESCE(p.nome, '')               AS cliente,
          base.data_ref::text                AS data_ref,
          base.valor::float                  AS valor
        FROM base
        LEFT JOIN ca.pessoas p ON p.id::text = base.pessoa_id_txt
      `

      const [vendasRes, nfsRes, aReceberRes] = await Promise.all([
        client.query<{
          id_venda: string; descricao: string; cliente: string;
          data_ref: string; valor: number
        }>(vendasSql, [de, ate]),
        client.query<{
          id: string; numero: number | null; status: string;
          venda_id: string | null; data_emissao: string;
          valor: number; cliente: string
        }>(nfsSql, [de, ate]),
        client.query<{
          id_venda: string; descricao: string; cliente: string;
          data_ref: string; valor: number
        }>(aReceberSql, [de, ate]),
      ])

      // ── 2c. NFs emitidas vinculadas a qualquer venda do período ───────────
      // (vendas pagas + a receber). Cobertura considera ambos os conjuntos.
      const idsPagas    = vendasRes.rows.map(v => v.id_venda)
      const idsAReceber = aReceberRes.rows.map(v => v.id_venda)
      const todosIds    = Array.from(new Set([...idsPagas, ...idsAReceber]))

      const nfsVinculadasEmitidas = new Set<string>()  // id_venda
      if (todosIds.length > 0) {
        const allNfsRes = await client.query<{ venda_id: string }>(`
          SELECT DISTINCT venda_id::text AS venda_id
          FROM ca.notas_fiscais
          WHERE status = 'EMITIDA' AND venda_id = ANY($1::uuid[])
        `, [todosIds])
        for (const row of allNfsRes.rows) nfsVinculadasEmitidas.add(row.venda_id)
      }

      // ── 4. Montar rows ─────────────────────────────────────────────────────
      const rows: NotaRow[] = []

      // 4a. NFs do período (emitidas, canceladas, falhas)
      for (const nf of nfsRes.rows) {
        const venda = nf.venda_id
          ? (vendasRes.rows.find(v => v.id_venda === nf.venda_id)
             ?? aReceberRes.rows.find(v => v.id_venda === nf.venda_id))
          : null

        let kind: NotaRow['kind']
        if (nf.status === 'EMITIDA')                                 kind = 'emitida'
        else if (nf.status === 'CANCELADA' || nf.status === 'CANCELAMENTO_MANUAL') kind = 'cancelada'
        else                                                          kind = 'falha'

        let tempo: number | null = null
        if (venda?.data_ref && nf.data_emissao && kind === 'emitida') {
          const ref = new Date(venda.data_ref).getTime()
          const em  = new Date(nf.data_emissao).getTime()
          tempo = Math.max(0, Math.round((em - ref) / 86_400_000))
        }

        rows.push({
          id:                  nf.id,
          kind,
          numero:              nf.numero,
          lancamento:          venda?.descricao ?? '(NF sem venda vinculada no período)',
          cliente:             nf.cliente || venda?.cliente || '',
          valor:               nf.valor,
          data_emissao:        nf.data_emissao,
          data_referencia:     venda?.data_ref ?? null,
          status_raw:          nf.status,
          tempo_emissao_dias:  tempo,
        })
      }

      // 4b. Vendas PAGAS no período sem NF emitida (URGENTE)
      for (const venda of vendasRes.rows) {
        if (nfsVinculadasEmitidas.has(venda.id_venda)) continue
        rows.push({
          id:                  venda.id_venda,
          kind:                'paga_sem_nf',
          numero:              null,
          lancamento:          venda.descricao,
          cliente:             venda.cliente,
          valor:               venda.valor,
          data_emissao:        null,
          data_referencia:     venda.data_ref,
          status_raw:          'PAGA_SEM_NF',
          tempo_emissao_dias:  null,
        })
      }

      // 4c. Vendas A RECEBER no período (vencimento no mês) sem NF emitida
      // Filtra para não duplicar — não inclui vendas que já estão em vendasRes
      // (essas já foram tratadas em 4b como pagas)
      const idsPagasSet = new Set(idsPagas)
      for (const venda of aReceberRes.rows) {
        if (idsPagasSet.has(venda.id_venda))           continue  // já é "paga sem NF" ou tem NF
        if (nfsVinculadasEmitidas.has(venda.id_venda)) continue  // já tem NF — sai do "sem NF"
        rows.push({
          id:                  venda.id_venda,
          kind:                'a_receber',
          numero:              null,
          lancamento:          venda.descricao,
          cliente:             venda.cliente,
          valor:               venda.valor,
          data_emissao:        null,
          data_referencia:     venda.data_ref,
          status_raw:          'A_RECEBER',
          tempo_emissao_dias:  null,
        })
      }

      // ── 5. Agregar summary ─────────────────────────────────────────────────
      const emitidas    = rows.filter(r => r.kind === 'emitida')
      const pagasSemNf  = rows.filter(r => r.kind === 'paga_sem_nf')
      const aReceber    = rows.filter(r => r.kind === 'a_receber')
      const canc        = rows.filter(r => r.kind === 'cancelada')
      const falhas      = rows.filter(r => r.kind === 'falha')

      // cobertura = vendas únicas (pagas + a receber, sem duplicar) com NF
      // emitida / total. Inclui ambos os conjuntos pois ambos deveriam ter NF.
      const vendasUnicas = todosIds.length
      const vendasComNFEmitida = todosIds.filter(id =>
        nfsVinculadasEmitidas.has(id),
      ).length
      const coberturaPct = vendasUnicas > 0
        ? Math.min(100, Math.round(vendasComNFEmitida / vendasUnicas * 100))
        : 100

      const tempos = emitidas
        .map(r => r.tempo_emissao_dias)
        .filter((d): d is number => d !== null)
      const tempoMedio = tempos.length > 0
        ? Math.round(tempos.reduce((s, d) => s + d, 0) / tempos.length)
        : null

      const summary: Summary = {
        emitidas: {
          qtd:   emitidas.length,
          valor: round2(emitidas.reduce((s, r) => s + r.valor, 0)),
        },
        pagas_sem_nf: {
          qtd:   pagasSemNf.length,
          valor: round2(pagasSemNf.reduce((s, r) => s + r.valor, 0)),
        },
        a_receber: {
          qtd:   aReceber.length,
          valor: round2(aReceber.reduce((s, r) => s + r.valor, 0)),
        },
        cobertura_pct: coberturaPct,
        vendas_unicas: vendasUnicas,
        canceladas_falha: {
          qtd:         canc.length + falhas.length,
          canceladas:  canc.length,
          falhas:      falhas.length,
          valor:       round2(canc.reduce((s, r) => s + r.valor, 0) + falhas.reduce((s, r) => s + r.valor, 0)),
        },
        tempo_medio_dias: tempoMedio,
      }

      return NextResponse.json({ rows, summary }, {
        headers: { 'Cache-Control': 'no-store' },
      })
    } finally {
      client.release()
    }
  } catch (err) {
    console.error('API /notas-fiscais error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
