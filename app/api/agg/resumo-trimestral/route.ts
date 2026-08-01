import { NextResponse } from 'next/server'

import { getPool } from '@/lib/db'
import { getUserAccess } from '@/lib/access'
import { fetchLancamentos } from '@/lib/financeiro-query'
import { parseFiltros } from '@/lib/financeiro-filtros'
import { aggResumoTrimestral, prepararDados } from '@/lib/aggregations/resumoTrimestral'

import type { Meta } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/agg/resumo-trimestral
 *   ?de&ate            range M-1..M+2 (o widget calcula)
 *   &mesAnt&mesRef&mesM1&mesM2
 *   &categoria&cc&tipo&situacao&conta   (CSV, os 5 filtros do dash)
 *   &incluirMetas=true|false            INTENÇÃO do client, não autorização
 *
 * ── AUTORIZAÇÃO EM DUAS CAMADAS ────────────────────────────────────────────
 * O resumo financeiro e as metas têm donos diferentes:
 *
 *   resumo  → admin OU 'visao_geral'   (sem isso, 403: nem o resumo sai)
 *   metas   → admin OU 'metas'         (sem isso, o resumo sai SEM metas)
 *
 * A versão anterior deste endpoint (branch feat/fase2-agregacao-server) tinha
 * só `requireScreen('visao_geral')` e depois fazia `SELECT * FROM ca.metas`
 * incondicionalmente — ou seja, quem tivesse Visão Geral recebia metas mesmo
 * sem ter a tela. Essa falha foi eliminada aqui: a consulta a ca.metas só
 * acontece dentro do `if (incluirMetasEfetivo)`.
 *
 * `incluirMetas` do client é INTENÇÃO, nunca permissão:
 *
 *   incluirMetasEfetivo = clienteSolicitou && podeIncluirMetas
 *
 * Forçar ?incluirMetas=true sem ter a tela não muda nada — o servidor
 * recalcula `podeIncluirMetas` do próprio `getUserAccess()`.
 *
 * O regime é SEMPRE competência: este card é uma projeção M-1..M+2 e o
 * seletor de regime do dash não se aplica a ele (mesma regra do widget).
 */
export async function GET(request: Request) {
  try {
    const acc = await getUserAccess()

    // Camada 1 — o resumo financeiro em si.
    const podeVerResumo = acc.isAdmin || acc.telasPermitidas.includes('visao_geral')
    if (!podeVerResumo) {
      return NextResponse.json(
        { error: 'Sem permissão para acessar esta tela.' },
        { status: 403 },
      )
    }

    // Camada 2 — as metas. Calculada no SERVIDOR, a partir das permissões.
    const podeIncluirMetas = acc.isAdmin || acc.telasPermitidas.includes('metas')

    const sp = new URL(request.url).searchParams
    const de     = sp.get('de')  || null
    const ate    = sp.get('ate') || null
    const mesAnt = sp.get('mesAnt') || ''
    const mesRef = sp.get('mesRef') || ''
    const mesM1  = sp.get('mesM1')  || ''
    const mesM2  = sp.get('mesM2')  || ''

    // Intenção do client (default true) × permissão real.
    const clienteSolicitouMetas = sp.get('incluirMetas') !== 'false'
    const incluirMetasEfetivo = clienteSolicitouMetas && podeIncluirMetas

      // Permissão de folha calculada no SERVIDOR, como nas demais rotas.
      // Este endpoint só devolve agregados — nenhum campo de texto por
      // lançamento sai daqui — então mascarar é no-op para o payload. Passa
      // mesmo assim: `true` fixo aqui viraria a exceção que alguém copia para
      // uma rota que devolve detalhe. A permissão real é sempre a resposta certa.
      const podeVerFolhaDetalhada = acc.isAdmin || acc.verFolhaDetalhe === true

    const brutos = await fetchLancamentos({ de, ate, regime: 'competencia', podeVerFolhaDetalhada })
    const data = prepararDados(brutos, parseFiltros(sp))

    // Só consulta ca.metas se a autorização EFETIVA permitir. Sem permissão,
    // `metas` fica null e a agregação devolve meta: null em todas as linhas —
    // nenhum valor de meta chega ao payload, nem zerado.
    let metas: Meta[] | null = null
    if (incluirMetasEfetivo) {
      const { rows } = await getPool().query<Meta>('SELECT * FROM ca.metas')
      metas = rows
    }

    return NextResponse.json(
      aggResumoTrimestral(data, metas, { ant: mesAnt, ref: mesRef, m1: mesM1, m2: mesM2 }),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[agg/resumo-trimestral]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
