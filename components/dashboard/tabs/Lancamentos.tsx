'use client'

import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { ChevronUp, ChevronDown, Search } from 'lucide-react'
import type { Lancamento, Filters } from '@/lib/types'
import { isAggClientEnabled } from '@/lib/feature-aggregation'
import { aggFetcher, buildAggQuery, isForbidden } from '@/lib/agg-client'
import {
  aggLancamentos, PAGE_SIZE_PADRAO,
  type LancamentosAgg, type SortKey, type SortDir,
} from '@/lib/aggregations/lancamentos'
import { EMPTY_FILTROS } from '@/lib/financeiro-filtros'
import { fR } from '@/lib/utils'

/**
 * 'YYYY-MM-DD' → 'DD/MM/YYYY'. Recorte de string, sem Date: a agregação
 * devolve a data já normalizada e converter aqui reintroduziria o off-by-one
 * de fuso que o backend evita mandando TO_CHAR.
 */
function fDtYmd(d: string | null): string {
  if (!d || d.length < 10) return '—'
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
}
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'

interface Props {
  data: Lancamento[]
  /** Necessário só no caminho agregado, para montar a query. */
  filters?: Filters
}

const PAGE_SIZE = PAGE_SIZE_PADRAO

const VAZIO: LancamentosAgg = {
  rows: [], page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1,
  totais: { rec: 0, desp: 0, resultado: 0 }, contas: [],
}

export function Lancamentos({ data, filters }: Props) {
  const aggOn = isAggClientEnabled()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [conta, setConta] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('data')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 220)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [conta])

  const filtros = useMemo(() => ({
    categoria: filters?.categoria ?? [],
    cc:        filters?.cc ?? [],
    tipo:      filters?.tipo ?? '',
    situacao:  filters?.situacao ?? [],
    conta:     filters?.conta ?? [],
  }), [filters?.categoria, filters?.cc, filters?.tipo, filters?.situacao, filters?.conta])

  const params = useMemo(() => ({
    q: debouncedSearch, contaSel: conta,
    sort: sortKey, dir: sortDir, page, pageSize: PAGE_SIZE,
  }), [debouncedSearch, conta, sortKey, sortDir, page])

  // ── Os dois caminhos chamam a MESMA função ───────────────────────────────
  // Com a flag ON o servidor devolve UMA PÁGINA; com OFF a mesma função fatia
  // o array da prop. Busca, ordenação e paginação têm uma implementação só.
  const url = useMemo(() => {
    if (!aggOn || !filters) return null
    const extra: Record<string, string> = {
      sort: params.sort, dir: params.dir,
      page: String(params.page), pageSize: String(params.pageSize),
    }
    if (params.q) extra.q = params.q
    if (params.contaSel) extra.contaSel = params.contaSel
    return `/api/agg/lancamentos?${buildAggQuery(filters, extra)}`
  }, [aggOn, filters, params])

  const { data: aggResp, error: erroAgg } =
    useSWR<LancamentosAgg>(url, aggFetcher, { keepPreviousData: true })

  // No caminho legado `data` já vem filtrado pelo DashboardLayout, então os 5
  // filtros aqui são no-op (idempotentes) — passar EMPTY_FILTROS produziria o
  // mesmo resultado, mas passar os reais mantém as duas chamadas simétricas.
  const local = useMemo(
    () => (aggOn ? null : aggLancamentos(data, filters ? filtros : EMPTY_FILTROS, params)),
    [aggOn, data, filters, filtros, params],
  )

  const agg: LancamentosAgg = aggOn ? (aggResp ?? VAZIO) : local!

  const contas    = agg.contas
  const pageRows  = agg.rows
  const totalPages = agg.totalPages
  const totalLinhas = agg.total
  const recTotal   = agg.totais.rec
  const despTotal  = agg.totais.desp
  const resultado  = agg.totais.resultado

  // A página pode ter sido reduzida pelo servidor (ex.: filtro encolheu o
  // conjunto). Segue a fonte da verdade para o controle não ficar mentindo.
  useEffect(() => {
    if (agg.page !== page) setPage(agg.page)
  }, [agg.page, page])

  const toggleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))
      } else {
        setSortKey(key)
        setSortDir('desc')
      }
      setPage(1)
    },
    [sortKey]
  )

  // Erro do caminho agregado. Só existe com a flag ON; cair no VAZIO mostraria
  // "Nenhum lançamento encontrado" como se o filtro não tivesse resultado.
  if (aggOn && erroAgg) {
    if (isForbidden(erroAgg)) {
      return (
        <div className="text-[12px]" style={{ color: 'var(--ink3)', padding: '32px 0', textAlign: 'center' }}>
          Você não tem permissão para visualizar os Lançamentos.
        </div>
      )
    }
    return (
      <div className="text-[12px]" style={{ color: 'var(--red)' }}>
        Erro ao carregar Lançamentos: {String(erroAgg)}
      </div>
    )
  }

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ChevronDown className="h-3 w-3 opacity-30" />
    return sortDir === 'desc' ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div
        className="rounded-lg px-4 py-3 flex flex-wrap gap-4 items-center"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
      >
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider mr-2" style={{ color: 'var(--ink3)' }}>Receitas</span>
          <span className="text-[13px] font-bold" style={{ color: 'var(--green)' }}>{fR(recTotal)}</span>
        </div>
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider mr-2" style={{ color: 'var(--ink3)' }}>Despesas</span>
          <span className="text-[13px] font-bold" style={{ color: 'var(--red)' }}>{fR(despTotal)}</span>
        </div>
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider mr-2" style={{ color: 'var(--ink3)' }}>Resultado</span>
          <span className="text-[13px] font-bold" style={{ color: resultado >= 0 ? 'var(--green)' : 'var(--red)' }}>{fR(resultado)}</span>
        </div>
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider mr-2" style={{ color: 'var(--ink3)' }}>Qtd</span>
          <span className="text-[13px] font-bold" style={{ color: 'var(--blue)' }}>{totalLinhas.toLocaleString('pt-BR')}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative w-56">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3" style={{ color: 'var(--ink3)' }} />
          <Input
            placeholder="Buscar..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-6"
          />
        </div>
        <Select value={conta || '__all__'} onValueChange={v => setConta(v === '__all__' ? '' : v)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Conta financeira" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas as contas</SelectItem>
            {contas.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="sticky top-0" style={{ background: 'var(--surf2)', zIndex: 10 }}>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th
                    className="py-2 pl-3 text-left text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none"
                    style={{ color: 'var(--ink3)', whiteSpace: 'nowrap' }}
                    onClick={() => toggleSort('data')}
                  >
                    <span className="flex items-center gap-1">Data <SortIcon k="data" /></span>
                  </th>
                  <th className="py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)', minWidth: 180 }}>Descrição</th>
                  <th className="py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)', minWidth: 140 }}>Fornecedor</th>
                  <th className="py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Tipo</th>
                  <th className="py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)', minWidth: 100 }}>Conta</th>
                  <th className="py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)', minWidth: 90 }}>Forma</th>
                  <th
                    className="py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none"
                    style={{ color: 'var(--ink3)', whiteSpace: 'nowrap' }}
                    onClick={() => toggleSort('valor')}
                  >
                    <span className="flex items-center justify-end gap-1">Valor <SortIcon k="valor" /></span>
                  </th>
                  <th className="py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)', minWidth: 100 }}>Situação</th>
                  <th className="py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)', minWidth: 140 }}>Categoria</th>
                  <th className="py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)', minWidth: 100 }}>CC</th>
                  <th className="py-2 pr-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Origem</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={i} className="hover:bg-[var(--surf2)] transition-colors" style={{ borderBottom: '1px solid var(--line)' }}>
                    <td className="py-2 pl-3 text-[11px] whitespace-nowrap" style={{ color: 'var(--ink3)' }}>{fDtYmd(r.data)}</td>
                    <td className="py-2 text-[11px]" style={{ color: 'var(--ink2)', maxWidth: 200 }}>
                      <span className="block truncate" title={r.desc}>{r.desc}</span>
                    </td>
                    <td className="py-2 text-[11px]" style={{ color: 'var(--ink3)', maxWidth: 150 }}>
                      <span className="block truncate" title={r.fornecedor}>{r.fornecedor || '—'}</span>
                    </td>
                    <td className="py-2 text-[11px]">
                      <span
                        className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold whitespace-nowrap"
                        style={{
                          background: r.tipo === 'Receita' ? 'var(--green-l)' : 'var(--red-l)',
                          color: r.tipo === 'Receita' ? 'var(--green)' : 'var(--red)',
                        }}
                      >
                        {r.tipo}
                      </span>
                    </td>
                    <td className="py-2 text-[11px]" style={{ color: 'var(--ink3)' }}>{r.conta || '—'}</td>
                    <td className="py-2 text-[11px]" style={{ color: 'var(--ink3)' }}>{r.forma || '—'}</td>
                    <td className="py-2 pr-3 text-right text-[11px] font-semibold whitespace-nowrap" style={{ color: r.tipo === 'Receita' ? 'var(--green)' : 'var(--red)' }}>
                      {fR(r.valor)}
                    </td>
                    <td className="py-2 text-[11px]">
                      {r.situacao ? (
                        <span
                          className="px-1.5 py-0.5 rounded text-[9px] font-semibold"
                          style={{
                            background: r.situacao === 'Atrasado'
                              ? 'var(--red-l)'
                              : (r.situacao === 'Quitado' || r.situacao === 'Parcial')
                              ? 'var(--green-l)'
                              : 'var(--surf3)',
                            color: r.situacao === 'Atrasado'
                              ? 'var(--red)'
                              : (r.situacao === 'Quitado' || r.situacao === 'Parcial')
                              ? 'var(--green)'
                              : 'var(--ink3)',
                          }}
                        >
                          {r.situacao}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2 text-[11px]" style={{ maxWidth: 150 }}>
                      {r.catSup && r.catSup !== '(em branco)' && (
                        <div className="text-[9px] mb-0.5 truncate" style={{ color: 'var(--ink4)' }} title={r.catSup}>{r.catSup}</div>
                      )}
                      <span className="truncate block" style={{ color: 'var(--ink2)' }} title={r.cat1}>{r.cat1 || '—'}</span>
                    </td>
                    <td className="py-2 text-[11px]" style={{ color: 'var(--ink3)' }}>{r.cc1 || '—'}</td>
                    <td className="py-2 pr-3 text-[11px]" style={{ color: 'var(--ink3)' }}>{r.origem || '—'}</td>
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-[12px]" style={{ color: 'var(--ink3)' }}>
                      Nenhum lançamento encontrado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--line)' }}>
              <span className="text-[11px]" style={{ color: 'var(--ink3)' }}>
                {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, totalLinhas)} de {totalLinhas.toLocaleString('pt-BR')}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  ‹ Anterior
                </Button>
                <span className="px-2 text-[11px]" style={{ color: 'var(--ink3)' }}>
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                >
                  Próxima ›
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
