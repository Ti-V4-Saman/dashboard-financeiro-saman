'use client'

import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { ChevronUp, ChevronDown, Search } from 'lucide-react'
import type { Lancamento } from '@/lib/types'
import { fR, fDt } from '@/lib/utils'
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
}

type SortKey = 'data' | 'valor'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 50

export function Lancamentos({ data }: Props) {
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

  const op = useMemo(() => data.filter(r => !r.isTransfer), [data])

  const contas = useMemo(() => {
    const set = new Set<string>()
    for (const r of op) {
      if (r.conta && r.conta !== '(em branco)') set.add(r.conta)
    }
    return Array.from(set).sort()
  }, [op])

  const filtered = useMemo(() => {
    let rows = op
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      rows = rows.filter(
        r =>
          r.desc.toLowerCase().includes(q) ||
          r.fornecedor.toLowerCase().includes(q) ||
          r.cat1.toLowerCase().includes(q) ||
          r.conta.toLowerCase().includes(q) ||
          r.cc1.toLowerCase().includes(q)
      )
    }
    if (conta) rows = rows.filter(r => r.conta === conta)
    return rows
  }, [op, debouncedSearch, conta])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortKey === 'data') {
        const ta = a.data?.getTime() || 0
        const tb = b.data?.getTime() || 0
        return sortDir === 'desc' ? tb - ta : ta - tb
      } else {
        return sortDir === 'desc' ? b.valor - a.valor : a.valor - b.valor
      }
    })
  }, [filtered, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const recTotal = filtered.filter(r => r.tipo === 'Receita').reduce((s, r) => s + r.valor, 0)
  const despTotal = filtered.filter(r => r.tipo === 'Despesa').reduce((s, r) => s + r.valor, 0)
  const resultado = recTotal - despTotal

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
          <span className="text-[13px] font-bold" style={{ color: 'var(--blue)' }}>{filtered.length.toLocaleString('pt-BR')}</span>
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
                    <td className="py-2 pl-3 text-[11px] whitespace-nowrap" style={{ color: 'var(--ink3)' }}>{fDt(r.data)}</td>
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
                            background: r.situacao.toLowerCase().includes('atraso')
                              ? 'var(--red-l)'
                              : r.situacao.toLowerCase().includes('baixad') || r.situacao.toLowerCase().includes('pago')
                              ? 'var(--green-l)'
                              : 'var(--surf3)',
                            color: r.situacao.toLowerCase().includes('atraso')
                              ? 'var(--red)'
                              : r.situacao.toLowerCase().includes('baixad') || r.situacao.toLowerCase().includes('pago')
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
                {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} de {sorted.length.toLocaleString('pt-BR')}
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
