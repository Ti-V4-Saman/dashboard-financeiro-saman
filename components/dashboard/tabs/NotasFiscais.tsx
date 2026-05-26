'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import { ChevronUp, ChevronDown, Search } from 'lucide-react'
import type { Filters } from '@/lib/types'
import { fR } from '@/lib/utils'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

// ── Tipos (espelham /api/notas-fiscais) ───────────────────────────────────────

interface NotaRow {
  id: string
  kind: 'emitida' | 'cancelada' | 'falha' | 'recebido_sem_nf' | 'a_receber'
  numero: number | null
  lancamento: string
  cliente: string
  valor: number
  data_emissao: string | null
  data_referencia: string | null
  status_raw: string
  tempo_emissao_dias: number | null
}

interface Summary {
  emitidas:           { qtd: number; valor: number }
  recebidos_sem_nf:   { qtd: number; valor: number }   // baixado + conciliado, sem NF
  a_receber:          { qtd: number; valor: number }   // venc no período em aberto/atrasado/parcial (sem obrigação de NF)
  cobertura_pct:      number
  vendas_unicas:      number                            // = vendas recebidas+conciliadas no período
  canceladas_falha:   { qtd: number; canceladas: number; falhas: number; valor: number }
  tempo_medio_dias:   number | null
}

interface NFResponse {
  rows: NotaRow[]
  summary: Summary
}

interface Props {
  filters: Filters
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

type FilterKey = 'todas' | 'emitida' | 'recebido_sem_nf' | 'a_receber' | 'cancelada_falha'

function KpiCard({
  label,
  value,
  sub,
  color,
  active,
  onClick,
}: {
  label: string
  value: string
  sub?: string
  color?: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-lg p-4 relative overflow-hidden transition-all"
      style={{
        background: 'var(--surface)',
        border: active ? '1.5px solid var(--brand)' : '1px solid var(--line)',
        boxShadow: active ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
        cursor: onClick ? 'pointer' : 'default',
        width: '100%',
      }}
    >
      <div className="text-[10px] font-semibold tracking-wider uppercase mb-1.5" style={{ color: 'var(--ink3)' }}>
        {label}
      </div>
      <div className="text-[20px] font-bold leading-none tracking-tight" style={{ color: color || 'var(--ink)' }}>
        {value}
      </div>
      {sub && (
        <div className="mt-1 text-[10px]" style={{ color: 'var(--ink3)' }}>
          {sub}
        </div>
      )}
    </button>
  )
}

// ── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ kind }: { kind: NotaRow['kind'] }) {
  const cfg: Record<NotaRow['kind'], { label: string; bg: string; fg: string }> = {
    emitida:         { label: 'Emitida',           bg: 'var(--green-l)', fg: 'var(--green)' },
    recebido_sem_nf: { label: 'Recebido sem NF',   bg: 'var(--red-l)',   fg: 'var(--red)' },
    a_receber:       { label: 'A receber',         bg: 'var(--surf3)',   fg: 'var(--ink2)' },
    cancelada:       { label: 'Cancelada',         bg: 'var(--red-l)',   fg: 'var(--red)' },
    falha:           { label: 'Falha',             bg: 'var(--red-l)',   fg: 'var(--red)' },
  }
  const c = cfg[kind]
  return (
    <span style={{
      background: c.bg, color: c.fg,
      padding: '2px 9px', borderRadius: 4,
      fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
    }}>{c.label}</span>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────

const PAGE_SIZE = 50

type SortKey = 'data' | 'valor' | 'tempo'
type SortDir = 'asc' | 'desc'

export function NotasFiscais({ filters }: Props) {
  const [data, setData] = useState<NFResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // UI state
  const [filterKey, setFilterKey] = useState<FilterKey>('todas')
  const [search, setSearch]       = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortKey, setSortKey]     = useState<SortKey>('data')
  const [sortDir, setSortDir]     = useState<SortDir>('desc')
  const [page, setPage]           = useState(1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce de busca
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

  // Reset page quando filtro muda
  useEffect(() => { setPage(1) }, [filterKey])

  // Fetch
  useEffect(() => {
    const de  = filters.dateFrom
    const ate = filters.dateTo
    if (!de || !ate) {
      setData(null); setLoading(false); return
    }
    const params = new URLSearchParams({ de, ate, regime: filters.regime }).toString()
    setLoading(true); setError(null)
    fetch(`/api/notas-fiscais?${params}`)
      .then(r => r.json())
      .then((d: NFResponse | { error: string }) => {
        if ('error' in d) { setError(d.error); setData(null) }
        else              { setData(d) }
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [filters.dateFrom, filters.dateTo, filters.regime])

  // ── Filtrar/ordenar rows ────────────────────────────────────────────────
  const rowsFiltradas = useMemo(() => {
    const rows = data?.rows ?? []
    let arr = rows
    if (filterKey === 'emitida')              arr = arr.filter(r => r.kind === 'emitida')
    else if (filterKey === 'recebido_sem_nf') arr = arr.filter(r => r.kind === 'recebido_sem_nf')
    else if (filterKey === 'a_receber')       arr = arr.filter(r => r.kind === 'a_receber')
    else if (filterKey === 'cancelada_falha')
                                          arr = arr.filter(r => r.kind === 'cancelada' || r.kind === 'falha')
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      arr = arr.filter(r =>
        r.lancamento.toLowerCase().includes(q) ||
        r.cliente.toLowerCase().includes(q) ||
        String(r.numero ?? '').includes(q),
      )
    }
    return arr
  }, [data, filterKey, debouncedSearch])

  const rowsOrdenadas = useMemo(() => {
    const arr = [...rowsFiltradas]
    arr.sort((a, b) => {
      let av: number, bv: number
      if (sortKey === 'valor') { av = a.valor; bv = b.valor }
      else if (sortKey === 'tempo') {
        av = a.tempo_emissao_dias ?? -1
        bv = b.tempo_emissao_dias ?? -1
      } else {
        av = a.data_emissao ? new Date(a.data_emissao).getTime() : (a.data_referencia ? new Date(a.data_referencia).getTime() : 0)
        bv = b.data_emissao ? new Date(b.data_emissao).getTime() : (b.data_referencia ? new Date(b.data_referencia).getTime() : 0)
      }
      return sortDir === 'asc' ? av - bv : bv - av
    })
    return arr
  }, [rowsFiltradas, sortKey, sortDir])

  // Paginação
  const totalPages = Math.max(1, Math.ceil(rowsOrdenadas.length / PAGE_SIZE))
  const pageRows = rowsOrdenadas.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('desc') }
  }

  const s = data?.summary

  return (
    <div className="space-y-4">
      {/* ── 6 KPIs clicáveis ────────────────────────────────────────────── */}
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
        <KpiCard
          label="Emitidas"
          value={s ? s.emitidas.qtd.toLocaleString('pt-BR') : '—'}
          sub={s ? fR(s.emitidas.valor) : undefined}
          color="var(--green)"
          active={filterKey === 'emitida'}
          onClick={() => setFilterKey(filterKey === 'emitida' ? 'todas' : 'emitida')}
        />
        <KpiCard
          label="Recebidos sem NF"
          value={s ? s.recebidos_sem_nf.qtd.toLocaleString('pt-BR') : '—'}
          sub={s ? fR(s.recebidos_sem_nf.valor) : undefined}
          color={(s?.recebidos_sem_nf.qtd ?? 0) > 0 ? 'var(--red)' : 'var(--green)'}
          active={filterKey === 'recebido_sem_nf'}
          onClick={() => setFilterKey(filterKey === 'recebido_sem_nf' ? 'todas' : 'recebido_sem_nf')}
        />
        <KpiCard
          label="A receber no período"
          value={s ? s.a_receber.qtd.toLocaleString('pt-BR') : '—'}
          sub={s ? fR(s.a_receber.valor) : 'sem obrigação de NF ainda'}
          color="var(--ink2)"
          active={filterKey === 'a_receber'}
          onClick={() => setFilterKey(filterKey === 'a_receber' ? 'todas' : 'a_receber')}
        />
        <KpiCard
          label="Cobertura"
          value={s ? `${s.cobertura_pct}%` : '—'}
          sub={s ? `${s.vendas_unicas} venda(s) no período` : undefined}
          color={(s?.cobertura_pct ?? 100) >= 90 ? 'var(--green)' : (s?.cobertura_pct ?? 0) >= 70 ? 'var(--amber)' : 'var(--red)'}
          active={filterKey === 'todas'}
          onClick={() => setFilterKey('todas')}
        />
        <KpiCard
          label="Canceladas / Falha"
          value={s ? s.canceladas_falha.qtd.toLocaleString('pt-BR') : '—'}
          sub={s
            ? [s.canceladas_falha.canceladas ? `${s.canceladas_falha.canceladas} cancel` : null,
               s.canceladas_falha.falhas     ? `${s.canceladas_falha.falhas} falha`     : null]
              .filter(Boolean).join(' · ') || '—'
            : undefined}
          color={(s?.canceladas_falha.qtd ?? 0) > 0 ? 'var(--red)' : 'var(--ink)'}
          active={filterKey === 'cancelada_falha'}
          onClick={() => setFilterKey(filterKey === 'cancelada_falha' ? 'todas' : 'cancelada_falha')}
        />
        <KpiCard
          label="Tempo médio emissão"
          value={s?.tempo_medio_dias != null ? `${s.tempo_medio_dias} d` : '—'}
          sub="venda → emissão"
          color={s?.tempo_medio_dias != null && s.tempo_medio_dias <= 3 ? 'var(--green)' : s?.tempo_medio_dias != null && s.tempo_medio_dias <= 7 ? 'var(--amber)' : 'var(--red)'}
        />
      </div>

      {/* ── Barra de busca ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="relative flex-1" style={{ maxWidth: 360 }}>
              <Search style={{ position: 'absolute', left: 10, top: 9, width: 14, height: 14, color: 'var(--ink3)' }} />
              <Input
                placeholder="Buscar por número, lançamento ou cliente"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ paddingLeft: 30, fontSize: 12, height: 32 }}
              />
            </div>
            <span className="text-[11px]" style={{ color: 'var(--ink3)' }}>
              {loading ? 'carregando…' : `${rowsOrdenadas.length} registro(s)`}
              {filterKey !== 'todas' && (
                <button
                  onClick={() => setFilterKey('todas')}
                  className="ml-3 text-[10px]"
                  style={{ color: 'var(--brand)', textDecoration: 'underline' }}
                >
                  limpar filtro
                </button>
              )}
            </span>
          </div>
        </CardHeader>

        <CardContent>
          {error && (
            <p className="text-[11px]" style={{ color: 'var(--red)' }}>Erro: {error}</p>
          )}
          {!error && (
            <div style={{ overflowX: 'auto' }}>
              <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)' }}>
                    <Th>Nº NF</Th>
                    <Th>Lançamento</Th>
                    <Th>Cliente</Th>
                    <Th onClick={() => handleSort('valor')} sortIndicator={sortKey === 'valor' ? sortDir : null} align="right">
                      Valor
                    </Th>
                    <Th onClick={() => handleSort('data')} sortIndicator={sortKey === 'data' ? sortDir : null}>
                      Data emissão
                    </Th>
                    <Th onClick={() => handleSort('tempo')} sortIndicator={sortKey === 'tempo' ? sortDir : null} align="right">
                      Tempo
                    </Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={7} className="py-6 text-center" style={{ color: 'var(--ink3)' }}>Carregando…</td></tr>
                  )}
                  {!loading && pageRows.length === 0 && (
                    <tr><td colSpan={7} className="py-6 text-center" style={{ color: 'var(--ink3)' }}>Sem registros</td></tr>
                  )}
                  {!loading && pageRows.map(r => (
                    <tr key={`${r.kind}::${r.id}`} style={{ borderBottom: '0.5px solid var(--line)' }}>
                      <Td>{r.numero ?? '—'}</Td>
                      <Td title={r.lancamento} style={{ maxWidth: 280, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.lancamento}
                      </Td>
                      <Td title={r.cliente} style={{ maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.cliente || '—'}
                      </Td>
                      <Td align="right">{fR(r.valor)}</Td>
                      <Td>{r.data_emissao ? formatDate(r.data_emissao) : '—'}</Td>
                      <Td align="right">{r.tempo_emissao_dias != null ? `${r.tempo_emissao_dias} d` : '—'}</Td>
                      <Td><StatusBadge kind={r.kind} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginação */}
          {!loading && rowsOrdenadas.length > PAGE_SIZE && (
            <div className="flex items-center justify-between mt-3 text-[11px]" style={{ color: 'var(--ink3)' }}>
              <span>Página {page} de {totalPages}</span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                  className="px-2 py-1 rounded"
                  style={{ border: '1px solid var(--line)', opacity: page <= 1 ? 0.4 : 1, cursor: page <= 1 ? 'default' : 'pointer' }}
                >Anterior</button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="px-2 py-1 rounded"
                  style={{ border: '1px solid var(--line)', opacity: page >= totalPages ? 0.4 : 1, cursor: page >= totalPages ? 'default' : 'pointer' }}
                >Próxima</button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Helpers de tabela ────────────────────────────────────────────────────────

function Th({
  children,
  onClick,
  sortIndicator,
  align = 'left',
}: {
  children: React.ReactNode
  onClick?: () => void
  sortIndicator?: 'asc' | 'desc' | null
  align?: 'left' | 'right'
}) {
  return (
    <th
      onClick={onClick}
      style={{
        padding: '8px 10px',
        textAlign: align,
        fontWeight: 600,
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: 'var(--ink3)',
        cursor: onClick ? 'pointer' : 'default',
        whiteSpace: 'nowrap',
      }}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortIndicator === 'asc'  && <ChevronUp   className="w-3 h-3" />}
        {sortIndicator === 'desc' && <ChevronDown className="w-3 h-3" />}
      </span>
    </th>
  )
}

function Td({
  children,
  align = 'left',
  style,
  title,
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
  style?: React.CSSProperties
  title?: string
}) {
  return (
    <td
      title={title}
      style={{
        padding: '8px 10px',
        textAlign: align,
        color: 'var(--ink)',
        ...style,
      }}
    >
      {children}
    </td>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const day   = String(d.getUTCDate()).padStart(2, '0')
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const year  = d.getUTCFullYear()
  return `${day}/${month}/${year}`
}
