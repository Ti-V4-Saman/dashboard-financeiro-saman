import { NextResponse } from 'next/server'

import { getUserAccess } from '@/lib/access'
import { fetchLancamentos } from '@/lib/financeiro-query'
import { aggMetasRealizados, type ChaveMeta } from '@/lib/aggregations/metasRealizados'

export const dynamic = 'force-dynamic'

/** Teto de metas por requisição. Nada real chega perto. */
const MAX_CHAVES = 2000

/**
 * POST /api/agg/metas-realizados
 *   body: { de, ate, regime, chaves: ChaveMeta[] }
 *
 * Devolve o REALIZADO com que a tela de Metas cruza as metas cadastradas:
 * um valor por meta, o faturamento do período e o realizado por categoria.
 *
 * AUTORIZAÇÃO: exclusivamente admin OU a tela 'metas'. É a mesma separação
 * estabelecida no Bloco C: acesso ao resumo financeiro e acesso às metas são
 * permissões distintas. Aqui a tela É de metas, então o guard é `metas` — e
 * nenhuma outra tela abre esta porta.
 *
 * NÃO DEVOLVE META NENHUMA. Metas vivem em `ca.metas`, com tela e permissão
 * próprias, e são buscadas por /api/metas. Este endpoint só responde "quanto
 * foi realizado" para as chaves que o cliente já tem em mãos — se ele não pode
 * ver metas, ele não tem chave nenhuma para mandar, e o guard já barrou antes.
 *
 * POST e não GET porque a lista de chaves pode passar de mil itens e não cabe
 * confortavelmente numa query string. Não há efeito colateral: é uma leitura.
 *
 * FOLHA: a agregação não toca `fornecedor` nem `desc` — só valor, tipo, mês,
 * categoria e centro de custo. A permissão é passada mesmo assim, pelo mesmo
 * motivo das outras rotas.
 */
export async function POST(request: Request) {
  try {
    const acc = await getUserAccess()
    if (!acc.isAdmin && !acc.telasPermitidas.includes('metas')) {
      return NextResponse.json(
        { error: 'Sem permissão para acessar esta tela.' },
        { status: 403 },
      )
    }

    let body: { de?: string; ate?: string; regime?: string; chaves?: ChaveMeta[] }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
    }

    const chaves = Array.isArray(body.chaves) ? body.chaves : []
    if (chaves.length > MAX_CHAVES) {
      return NextResponse.json({ error: 'chaves demais' }, { status: 400 })
    }
    // Formato do mês validado: é a chave do índice, não pode ser lixo.
    if (chaves.some(c => typeof c?.mes_referencia !== 'string' || !/^\d{4}-\d{2}$/.test(c.mes_referencia))) {
      return NextResponse.json({ error: 'mes_referencia inválido' }, { status: 400 })
    }

    const de     = body.de  || null
    const ate    = body.ate || null
    const regime = body.regime === 'caixa' ? 'caixa' : 'competencia'

    const podeVerFolhaDetalhada = acc.isAdmin || acc.verFolhaDetalhe === true

    const todos = await fetchLancamentos({ de, ate, regime, podeVerFolhaDetalhada })

    return NextResponse.json(
      aggMetasRealizados(todos, chaves, regime, { de: de ?? '', ate: ate ?? '' }),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[agg/metas-realizados]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
