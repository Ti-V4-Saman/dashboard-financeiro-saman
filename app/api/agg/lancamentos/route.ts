import { NextResponse } from 'next/server'
import { requireScreen, canSeeFolhaDetalhe } from '@/lib/access'
import { fetchFilteredData } from '@/lib/financeiro-query'
import { parseFiltros } from '@/lib/financeiro-filtros'
import { aggLancamentos, type SortKey, type SortDir } from '@/lib/aggregations/lancamentos'
import { maskFolhaRow } from '@/lib/folha'

export const dynamic = 'force-dynamic'

function ymdLocal(d: Date | null): string | null {
  if (!d) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function GET(request: Request) {
  const denied = await requireScreen('lancamentos')
  if (denied) return denied
  try {
    const sp = new URL(request.url).searchParams
    const de     = sp.get('de')     || null
    const ate    = sp.get('ate')    || null
    const regime = sp.get('regime') || 'competencia'

    const q        = sp.get('q') || ''
    const contaTab = sp.get('conta_tab') || ''
    const sortKey  = (sp.get('sort') === 'valor' ? 'valor' : 'data') as SortKey
    const sortDir  = (sp.get('dir') === 'asc' ? 'asc' : 'desc') as SortDir
    const page     = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
    const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('pageSize') || '50', 10) || 50))

    const data = await fetchFilteredData({ de, ate, regime, filtros: parseFiltros(sp) })
    const agg = aggLancamentos(data, { q, conta: contaTab, sortKey, sortDir, page, pageSize })

    // Mascaramento de folha APÓS os totais (que usam valores reais). Só o detalhe
    // (fornecedor/desc) das linhas de folha é mascarado; valor permanece.
    const verFolha = await canSeeFolhaDetalhe()
    const rows = agg.pageRows.map(r => {
      const m = verFolha ? r : maskFolhaRow(r)
      return { ...m, data: ymdLocal(m.data) }
    })

    return NextResponse.json(
      {
        rows,
        total: agg.total,
        totalPages: agg.totalPages,
        page: agg.page,
        pageSize: agg.pageSize,
        totais: agg.totais,
        contas: agg.contas,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[agg/lancamentos]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
