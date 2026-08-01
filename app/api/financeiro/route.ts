import { NextResponse } from 'next/server'

import { getUserAccess } from '@/lib/access'
import { fetchLancamentos, fetchContas } from '@/lib/financeiro-query'

import type { Screen } from '@/lib/screens'

export const dynamic = 'force-dynamic'

// Telas que consomem este endpoint (via DashboardLayout.filteredData ou widgets).
// Liberar se o usuário tiver QUALQUER uma — bloqueia só quem nunca veria
// dados financeiros (ex.: permissões só de metas/notas_fiscais/qualidade).
const SCREENS_QUE_USAM: Screen[] = [
  'visao_geral',
  'dre',
  'centros_custo',
  'comparativo',
  'lancamentos',
]

/**
 * GET /api/financeiro?de=YYYY-MM-DD&ate=YYYY-MM-DD&regime=competencia|caixa
 *
 * REGIME = caixa
 *   Fonte primária: ca.baixas (cada baixa vira UMA linha) — captura corretamente:
 *     - pagamentos parciais em datas distintas
 *     - decomposição bruto / taxa / desconto / juros / multa
 *   Complementado por linhas "em aberto" (status IN Aberto/Atrasado/Parcial,
 *   valor_aberto > 0) vindas direto de contas_receber/pagar com data_vencimento.
 *
 * REGIME = competencia
 *   Fonte: ca.contas_receber + ca.contas_pagar (UNION) com data =
 *   COALESCE(data_competencia, data_vencimento). Status válidos: NOT IN
 *   ('Cancelado', 'Renegociado') — inclui Aberto/Atrasado/Parcial além de Quitado.
 *
 * Em ambos os regimes, o JOIN traz nome de categoria, CC, fornecedor e conta.
 * Origem TRANSFERENCIA / SALDO_CONTA_BANCARIA é marcada com isTransfer=true e
 * pode ser filtrada no frontend.
 *
 * ── Nota de refatoração (Fase 2, Bloco B) ──────────────────────────────────
 * O SQL e a normalização saíram daqui para `lib/financeiro-query.ts`, que será
 * compartilhada com os endpoints agregados. O contrato desta rota NÃO mudou:
 * mesmos parâmetros, mesmos campos, mesmos números, mesmos headers.
 *
 * A AUTORIZAÇÃO CONTINUA AQUI, de propósito. `financeiro-query` é uma camada
 * de dados sem noção de permissão — se ela decidisse acesso, seria fácil
 * chamá-la de um lugar novo sem checar nada. O guard fica na porta de entrada.
 * Ele também NÃO depende de AGG_BACKEND: a flag decide quem agrega, nunca
 * quem pode ver.
 *
 * ── Proteção de folha (Fase 2, fechamento do Bloco E) ──────────────────────
 * `SCREENS_QUE_USAM` libera quem tiver QUALQUER uma das cinco telas. Isso está
 * certo para o acesso ao dataset, mas não para o dado nominal: um usuário só
 * com `visao_geral` recebia aqui o nome de cada pessoa da folha e a descrição
 * da remuneração, sem nunca ter tido `ver_folha_detalhe`.
 *
 * A partir daqui, `podeVerFolhaDetalhada` é decidido NESTA rota, a partir do
 * mesmo `getUserAccess()` que já roda para o guard, e desce para
 * `fetchLancamentos`, que mascara antes de serializar. Não existe query param
 * equivalente — de propósito: o cliente não define a própria permissão.
 *
 * O que NÃO muda: guard, status, contrato, filtros, período, regime, contas,
 * cache, ordem, valores, valorDRE e quantidade de lançamentos. Para quem tem a
 * permissão, o payload é byte a byte o mesmo de antes.
 */
export async function GET(request: Request) {
  try {
    // Autorização ANTES de qualquer consulta ao banco.
    const access = await getUserAccess()
    if (!access.isAdmin && !SCREENS_QUE_USAM.some((s) => access.telasPermitidas.includes(s))) {
      return NextResponse.json(
        { error: 'Sem permissão para acessar dados financeiros.' },
        { status: 403 },
      )
    }

    const { searchParams } = new URL(request.url)
    const de     = searchParams.get('de')     || null
    const ate    = searchParams.get('ate')    || null
    const regime = searchParams.get('regime') || 'competencia'

    // Regra oficial: admin sempre vê; não-admin depende de ver_folha_detalhe.
    // Reusa o `access` já carregado acima — nenhuma consulta extra.
    const podeVerFolhaDetalhada = access.isAdmin || access.verFolhaDetalhe === true

    // Sequencial (não Promise.all) para preservar exatamente a ordem de
    // execução da versão anterior. A query de lançamentos não tem ORDER BY;
    // manter o mesmo caminho evita qualquer chance de ordem diferente.
    const lancamentos = await fetchLancamentos({ de, ate, regime, podeVerFolhaDetalhada })
    const listaContas = await fetchContas()

    return NextResponse.json({ lancamentos, contas: listaContas }, {
      headers: { 'Cache-Control': 'no-store' },
    })

  } catch (err) {
    console.error('API /financeiro error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
