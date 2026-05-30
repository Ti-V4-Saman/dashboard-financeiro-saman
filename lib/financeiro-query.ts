import { getPool } from '@/lib/db'
import type { Lancamento } from '@/lib/types'
import { applyFiltros, EMPTY_FILTROS, type FinanceiroFiltros } from '@/lib/financeiro-filtros'
import { parseDataLocal } from '@/lib/utils'

/**
 * Query-builder + normalização do dataset financeiro cru.
 *
 * Extraído de app/api/financeiro/route.ts SEM mudança de comportamento. É a
 * fonte ÚNICA de lançamentos para o endpoint cru (/api/financeiro) e para todos
 * os endpoints agregados (/api/agg/*). Os agregados rodam fetchLancamentos e
 * passam o resultado para as funções puras de lib/aggregations/* — o array cru
 * nunca desce ao browser.
 */

const pool = getPool()

const TRANSFER_ORIGENS = new Set(['TRANSFERENCIA', 'SALDO_CONTA_BANCARIA'])

export interface FetchLancamentosArgs {
  de: string | null
  ate: string | null
  regime: string
  /** Filtros não-temporais (cat/cc/tipo/situacao/conta). Default: nenhum. */
  filtros?: FinanceiroFiltros
}

function buildQuery(regime: string): string {
  if (regime === 'caixa') {
    return `
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
  // competência
  return `
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

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeRow(row: any): Lancamento {
  const isTransfer = TRANSFER_ORIGENS.has(row.origem || '')

  const v    = Math.abs(Number(row.valor))
  const vDRE = Math.abs(Number(row.valordre)) || v

  const cat1Name = row.cat1 || '(em branco)'
  const cc1Name  = row.cc1  || '(em branco)'

  const dataStr: string | null = row.data || null
  const dataYm:  string | null = row.data_ym || (dataStr ? dataStr.slice(0, 7) : null)

  return {
    data:       dataStr as unknown as Date | null,
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
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Busca lançamentos normalizados (SQL por regime + normalização + filtros). */
export async function fetchLancamentos({ de, ate, regime, filtros }: FetchLancamentosArgs): Promise<Lancamento[]> {
  const { rows } = await pool.query(buildQuery(regime), [de, ate])
  const normalized = rows.map(normalizeRow)
  return applyFiltros(normalized, filtros ?? EMPTY_FILTROS)
}

/**
 * Equivale ao `filteredData` do dash: fetchLancamentos + descarte de linhas sem
 * data + conversão de `data` (string YYYY-MM-DD) para Date com componentes
 * LOCAIS — exatamente o que useFinanceiro faz em allData (parseDataLocal) e
 * depois filteredData (drop de linhas sem data). Assim as funções de agregação
 * recebem `r.data` como Date nos DOIS caminhos (client OFF e server ON).
 */
export async function fetchFilteredData(args: FetchLancamentosArgs): Promise<Lancamento[]> {
  const rows = await fetchLancamentos(args)
  return rows
    .filter(r => r.data)
    .map(r => ({ ...r, data: parseDataLocal(r.data as unknown as string) }))
}

/** Nomes distintos de contas financeiras (para o multiselect de conta). */
export async function fetchContas(): Promise<string[]> {
  const { rows } = await pool.query('SELECT DISTINCT nome FROM ca.contas_financeiras ORDER BY nome')
  return rows.map((r: { nome: string }) => r.nome)
}
