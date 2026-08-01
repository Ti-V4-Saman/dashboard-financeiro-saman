import { getPool } from '@/lib/db'
import { parseDataLocal } from '@/lib/utils'
import { applyFiltros, EMPTY_FILTROS, type FinanceiroFiltros } from '@/lib/financeiro-filtros'
import { protegerLancamentos } from '@/lib/folha'
import type { Lancamento } from '@/lib/types'

/**
 * Camada de consulta dos lançamentos financeiros.
 *
 * O QUE ISTO É
 * A MESMA query que `app/api/financeiro/route.ts` executa hoje, extraída para
 * poder ser reusada pelos endpoints agregados da Fase 2. O SQL abaixo foi
 * copiado verbatim da rota atual de `dev` — conferi token a token que o texto
 * SQL é idêntico, justamente para que ligar a agregação não mude um centavo.
 *
 * O QUE ISTO NÃO É
 *   • Não DECIDE autorização. O guard continua na rota (`SCREENS_QUE_USAM` em
 *     /api/financeiro; `requireScreen` nos /api/agg/*). Uma camada de query
 *     que decidisse permissão seria fácil de chamar sem querer sem checar.
 *     Mas APLICA a proteção de folha: `podeVerFolhaDetalhada` é decidido na
 *     rota, a partir de `getUserAccess()`, e o efeito acontece aqui — no único
 *     ponto por onde todo lançamento passa antes de virar JSON.
 *   • Não conhece a flag AGG_BACKEND. Os dois caminhos leem os MESMOS dados
 *     daqui; a flag só decide quem agrega, não o que é lido.
 *   • Não duplica regra de regime. Exclusão de transferência, de
 *     Cancelado/Renegociado e de Parcial em caixa continua em
 *     `lib/financeiro/regime.ts` (`filtraOperacional`), aplicada por quem
 *     consome. Aqui só entram os filtros do usuário, via applyFiltros.
 *   • Não importa nada de React.
 *
 * EFEITOS COLATERAIS NA IMPORTAÇÃO: nenhum. `getPool()` é chamado dentro das
 * funções, e ele mesmo só instancia o Pool (lazy, singleton em globalThis) —
 * importar este módulo não abre conexão nem dispara query.
 *
 * ERROS: nada é engolido. Falha de banco propaga para o chamador decidir o
 * status HTTP, como a rota já faz hoje.
 */

const TRANSFER_ORIGENS = new Set(['TRANSFERENCIA', 'SALDO_CONTA_BANCARIA'])

export interface FetchLancamentosArgs {
  de: string | null
  ate: string | null
  regime: string
  /** Os 5 filtros do usuário. Omitido = sem filtro. */
  filtros?: FinanceiroFiltros
  /**
   * Pode ver contraparte e descrição dos lançamentos de folha?
   *
   * OBRIGATÓRIO e sem default, de propósito. Um default permissivo faria
   * qualquer chamada nova vazar por esquecimento; um default restritivo
   * esconderia dado de quem tem direito, silenciosamente. Sendo obrigatório, o
   * compilador recusa a chamada e quem escreve precisa decidir na hora — o
   * fail-closed acontece antes de rodar, não em produção.
   *
   * O valor tem que vir de `getUserAccess()` no servidor. Nunca de query
   * param, header, cookie ou body: o cliente não define a própria permissão.
   */
  podeVerFolhaDetalhada: boolean
}

/** Linha crua devolvida pelo SQL, antes da normalização. */
interface RawRow {
  tipo: string
  desc: string | null
  fornecedor: string
  conta: string
  valor: string | number
  valordre: string | number
  situacao: string
  data: string | null
  data_ym: string | null
  origem: string
  forma: string
  cat1: string
  cc1: string
}

/**
 * SQL por regime. Idêntico ao de app/api/financeiro/route.ts.
 *
 * CAIXA        → ca.baixas (realizadas) + em-aberto por vencimento.
 * COMPETÊNCIA  → contas_receber + contas_pagar por COALESCE(competência, vencimento).
 *
 * Em ambos, `data` sai como string 'YYYY-MM-DD' via TO_CHAR: converter para
 * Date no servidor faria o JSON virar ISO-Z e produzir off-by-one em browser
 * com fuso negativo. Ver o fix em fix/dre-timezone-bug.
 */
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

/**
 * Converte a linha crua no `Lancamento` que o front consome. Cópia fiel do
 * `.map()` da rota atual, incluindo o `Math.abs` e o fallback de valorDRE.
 *
 * `data` permanece string 'YYYY-MM-DD' aqui, com o mesmo cast que a rota usa.
 * Quem precisar de `Date` chama `fetchLancamentosComData`.
 */
function normalizeRow(row: RawRow): Lancamento {
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

/**
 * Lançamentos do período, já com os 5 filtros do usuário aplicados e já com a
 * folha protegida quando for o caso. `data` vem como string 'YYYY-MM-DD'.
 *
 * A proteção acontece AQUI, logo depois de normalizar e antes de qualquer
 * serialização — é o ponto por onde todo lançamento passa. Protegesse-se na
 * rota, cada rota nova precisaria lembrar; protegesse-se no componente, o dado
 * já teria chegado ao navegador.
 *
 * A ordem em relação a `applyFiltros` é indiferente para o resultado: os 5
 * filtros olham categoria, CC, tipo, situação e conta, nunca `desc` ou
 * `fornecedor`. Mascarar antes é a escolha defensiva — a partir daí não existe
 * mais o valor original em memória para vazar por engano.
 */
export async function fetchLancamentos(
  { de, ate, regime, filtros, podeVerFolhaDetalhada }: FetchLancamentosArgs,
): Promise<Lancamento[]> {
  const { rows } = await getPool().query<RawRow>(buildQuery(regime), [de, ate])
  const normalized = rows.map(normalizeRow)
  const { rows: protegidos } = protegerLancamentos(normalized, podeVerFolhaDetalhada)
  return applyFiltros(protegidos, filtros ?? EMPTY_FILTROS)
}

/**
 * Igual a `fetchLancamentos`, mas com `data` convertida para `Date` por
 * componentes locais — o mesmo tratamento que `hooks/useFinanceiro.ts` faz no
 * client. Descarta linhas sem data, como o hook também faz.
 *
 * Use quando a agregação depender de operações de Date; para agrupar por
 * `data_ym` a string basta e sai mais barato.
 */
export async function fetchLancamentosComData(
  args: FetchLancamentosArgs,
): Promise<Lancamento[]> {
  const rows = await fetchLancamentos(args)
  return rows
    .filter(r => r.data)
    .map(r => ({ ...r, data: parseDataLocal(r.data as unknown as string) }))
}

/** Nomes distintos das contas financeiras, para a FilterBar. */
export async function fetchContas(): Promise<string[]> {
  const { rows } = await getPool().query<{ nome: string }>(
    'SELECT DISTINCT nome FROM ca.contas_financeiras ORDER BY nome',
  )
  return rows.map(r => r.nome)
}
