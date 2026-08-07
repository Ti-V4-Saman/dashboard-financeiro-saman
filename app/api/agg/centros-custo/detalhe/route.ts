import { NextResponse } from 'next/server'

import { getUserAccess } from '@/lib/access'
import { fetchLancamentos } from '@/lib/financeiro-query'
import { parseFiltros } from '@/lib/financeiro-filtros'
import { aggDetalheCC } from '@/lib/aggregations/centrosCusto'

export const dynamic = 'force-dynamic'

/** Limite de tamanho do nome de centro de custo aceito. `ca.centros_custo.nome`
 *  é texto livre, mas nada real chega perto disso — serve para recusar entrada
 *  absurda antes de qualquer trabalho. */
const MAX_CC = 200

/**
 * GET /api/agg/centros-custo/detalhe
 *   ?cc=<nome do centro>         obrigatório
 *   &tipo=Receita|Despesa        opcional — recorte ao clicar numa barra
 *   &de&ate&regime
 *   &categoria&cc?&tipo?&situacao&conta   (CSV, os 5 filtros do dash)
 *
 * AUTORIZAÇÃO: a MESMA do resumo — admin OU a tela 'centros_custo', 403 antes
 * de qualquer consulta. Um endpoint de detalhe com guard mais frouxo que o do
 * resumo seria a porta dos fundos da tela.
 *
 * FOLHA: `podeVerFolhaDetalhada` é calculado AQUI, no servidor, a partir de
 * getUserAccess(). Nenhuma flag do cliente influencia — não existe parâmetro
 * para isso, de propósito. A permissão desce para `fetchLancamentos`, que já
 * devolve a folha mascarada, e `aggDetalheCC` aplica a mesma proteção sobre o
 * resultado. As duas camadas são idempotentes e nenhuma depende da outra.
 *
 * O NOME DO CENTRO NÃO ENTRA EM SQL. A consulta é a de `fetchLancamentos`,
 * parametrizada só por datas; `cc` é usado em comparação de igualdade dentro do
 * JS. Aqui validamos só o formato: vazio, longo demais ou o sentinela
 * `(em branco)` viram 400. Nome válido mas inexistente no período devolve lista
 * vazia — e não 404 — porque o caminho legado faz exatamente isso quando o
 * usuário troca o filtro com o modal aberto.
 *
 * PARÂMETRO REPETIDO: `cc` aparece duas vezes na query — uma como filtro do
 * dash (CSV, lido por parseFiltros) e outra como o centro selecionado. Para não
 * depender de ordem, o centro viaja em `ccSel`.
 */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams
  const ccSel = (sp.get('ccSel') || '').trim()

  try {
    const acc = await getUserAccess()
    if (!acc.isAdmin && !acc.telasPermitidas.includes('centros_custo')) {
      return NextResponse.json(
        { error: 'Sem permissão para acessar esta tela.' },
        { status: 403 },
      )
    }

    if (!ccSel || ccSel.length > MAX_CC || ccSel === '(em branco)') {
      return NextResponse.json({ error: 'ccSel inválido' }, { status: 400 })
    }

    const tipoRaw = sp.get('tipoSel')
    if (tipoRaw && tipoRaw !== 'Receita' && tipoRaw !== 'Despesa') {
      return NextResponse.json({ error: 'tipoSel inválido' }, { status: 400 })
    }
    const tipo = (tipoRaw as 'Receita' | 'Despesa' | null) ?? null

    const de     = sp.get('de')     || null
    const ate    = sp.get('ate')    || null
    const regime = sp.get('regime') || 'competencia'

    const podeVerFolhaDetalhada = acc.isAdmin || acc.verFolhaDetalhe === true

    const cru = await fetchLancamentos({ de, ate, regime, podeVerFolhaDetalhada })

    return NextResponse.json(
      aggDetalheCC(cru, parseFiltros(sp), regime, ccSel, tipo, podeVerFolhaDetalhada),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    // Sem contraparte/desc no log.
    console.error('[agg/centros-custo/detalhe] cc len=%d', ccSel.length, err instanceof Error ? err.message : 'erro')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
