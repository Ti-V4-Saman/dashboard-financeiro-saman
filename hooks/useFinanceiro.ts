'use client'
import useSWR from 'swr'
import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import type { Lancamento, Filters, Regime, TipoPeriodo, Atalho } from '@/lib/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then(r => r.json())

function toYMD(d: Date): string {
  const y  = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dy = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${dy}`
}

function thisMonthRange(): { dateFrom: string; dateTo: string } {
  const now     = new Date()
  const y       = now.getFullYear()
  const m       = now.getMonth()
  const lastDay = new Date(y, m + 1, 0).getDate()
  return {
    dateFrom: `${y}-${String(m + 1).padStart(2, '0')}-01`,
    dateTo:   `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  }
}

function buildApiUrl(dateFrom: string, dateTo: string, regime: Regime): string {
  const p = new URLSearchParams()
  if (dateFrom) p.set('de', dateFrom)
  if (dateTo)   p.set('ate', dateTo)
  if (regime !== 'competencia') p.set('regime', regime)
  const qs = p.toString()
  return `/api/financeiro${qs ? '?' + qs : ''}`
}

function buildUrlParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.regime      !== 'competencia')  p.set('regime',      f.regime)
  if (f.tipoPeriodo !== 'mes')          p.set('tipo_periodo', f.tipoPeriodo)
  if (f.atalho      !== 'este-mes')     p.set('atalho',       f.atalho)
  // Only write explicit dates for "personalizado"; for presets the atalho is enough
  if (f.atalho === 'personalizado' || f.atalho === 'todo-periodo') {
    if (f.dateFrom) p.set('de',  f.dateFrom)
    if (f.dateTo)   p.set('ate', f.dateTo)
  }
  if (f.categoria.length) p.set('categoria', f.categoria.join(','))
  if (f.cc.length)        p.set('cc',        f.cc.join(','))
  if (f.tipo)             p.set('tipo',      f.tipo)
  if (f.situacao.length)  p.set('situacao',  f.situacao.join(','))
  if (f.conta.length)     p.set('conta',     f.conta.join(','))
  return p
}

function readFiltersFromUrl(sp: URLSearchParams): Filters {
  const regime      = (sp.get('regime')      as Regime)      || 'competencia'
  const tipoPeriodo = (sp.get('tipo_periodo') as TipoPeriodo) || 'mes'
  const atalho      = (sp.get('atalho')      as Atalho)      || 'este-mes'

  const categoria = sp.get('categoria') ? sp.get('categoria')!.split(',') : []
  const cc        = sp.get('cc')        ? sp.get('cc')!.split(',')        : []
  const tipo      = sp.get('tipo')      || ''
  const situacao  = sp.get('situacao')  ? sp.get('situacao')!.split(',')  : []
  const conta     = sp.get('conta')     ? sp.get('conta')!.split(',')     : []

  // Resolve dateFrom/dateTo from atalho (or explicit params for personalizado)
  let dateFrom = ''
  let dateTo   = ''

  if (atalho === 'personalizado' || atalho === 'todo-periodo') {
    dateFrom = sp.get('de')  || ''
    dateTo   = sp.get('ate') || ''
  } else {
    const dates = resolveAtalho(atalho)
    dateFrom    = dates.dateFrom
    dateTo      = dates.dateTo
  }

  return { regime, tipoPeriodo, atalho, dateFrom, dateTo, categoria, cc, tipo, situacao, conta }
}

export function resolveAtalho(atalho: Atalho): { dateFrom: string; dateTo: string } {
  const now = new Date()
  const y   = now.getFullYear()
  const m   = now.getMonth()

  switch (atalho) {
    case 'este-mes': {
      return thisMonthRange()
    }
    case 'mes-anterior': {
      const lm  = m === 0 ? 11 : m - 1
      const ly  = m === 0 ? y - 1 : y
      const ld  = new Date(ly, lm + 1, 0).getDate()
      return {
        dateFrom: `${ly}-${String(lm + 1).padStart(2, '0')}-01`,
        dateTo:   `${ly}-${String(lm + 1).padStart(2, '0')}-${String(ld).padStart(2, '0')}`,
      }
    }
    case 'este-trimestre': {
      const q  = Math.floor(m / 3)
      const qs = q * 3
      const qe = qs + 2
      const ld = new Date(y, qe + 1, 0).getDate()
      return {
        dateFrom: `${y}-${String(qs + 1).padStart(2, '0')}-01`,
        dateTo:   `${y}-${String(qe + 1).padStart(2, '0')}-${String(ld).padStart(2, '0')}`,
      }
    }
    case 'este-ano':
      return { dateFrom: `${y}-01-01`, dateTo: `${y}-12-31` }
    case 'ultimos-30': {
      const from = new Date(now); from.setDate(from.getDate() - 29)
      return { dateFrom: toYMD(from), dateTo: toYMD(now) }
    }
    case 'ultimos-12-meses': {
      const from = new Date(now)
      from.setFullYear(from.getFullYear() - 1)
      from.setDate(from.getDate() + 1)
      return { dateFrom: toYMD(from), dateTo: toYMD(now) }
    }
    case 'todo-periodo':
      return { dateFrom: '', dateTo: '' }
    case 'personalizado':
      return { dateFrom: '', dateTo: '' }
  }
}

function buildDefaultFilters(): Filters {
  const { dateFrom, dateTo } = thisMonthRange()
  return {
    regime: 'competencia',
    tipoPeriodo: 'mes',
    atalho: 'este-mes',
    dateFrom, dateTo,
    categoria: [], cc: [], tipo: '', situacao: [], conta: [],
  }
}

// Inline debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])   // eslint-disable-line react-hooks/exhaustive-deps
  return debounced
}

// ── Main hook ──────────────────────────────────────────────────────────────────

export function useFinanceiro() {
  const searchParams = useSearchParams()
  const router       = useRouter()

  // ── State — initialized once from URL ──────────────────────────────────────
  const [filters, setFiltersState] = useState<Filters>(() => {
    const fromUrl = readFiltersFromUrl(searchParams)
    // If URL had no params, use defaults (current month)
    const hasUrlParams =
      searchParams.has('regime') || searchParams.has('tipo_periodo') ||
      searchParams.has('atalho') || searchParams.has('de') || searchParams.has('ate') ||
      searchParams.has('categoria') || searchParams.has('cc') || searchParams.has('tipo') ||
      searchParams.has('situacao') || searchParams.has('conta')
    return hasUrlParams ? fromUrl : buildDefaultFilters()
  })

  // ── Debounced API key (period + regime changes) ────────────────────────────
  const rawApiKey    = buildApiUrl(filters.dateFrom, filters.dateTo, filters.regime)
  const debouncedKey = useDebounce(rawApiKey, 300)

  const { data: raw, isLoading, isValidating, mutate } = useSWR<{
    lancamentos: Lancamento[]
    contas: string[]
  }>(debouncedKey, fetcher, {
    refreshInterval: 15 * 60 * 1000,
    keepPreviousData: true,   // show old data while fetching new — enables subtle loading
  })

  // ── Public filter setter — updates state + URL ─────────────────────────────
  const setFilters = useCallback((f: Filters) => {
    setFiltersState(f)
    const params = buildUrlParams(f)
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false })
  }, [router])

  // ── Clear all — resets to defaults + clears URL ────────────────────────────
  const clearAll = useCallback(() => {
    const defaults = buildDefaultFilters()
    setFiltersState(defaults)
    router.replace(
      typeof window !== 'undefined' ? window.location.pathname : '/',
      { scroll: false }
    )
  }, [router])

  // ── Derived data ───────────────────────────────────────────────────────────
  const allData = useMemo(() => {
    if (!raw?.lancamentos || !Array.isArray(raw.lancamentos)) return []
    return raw.lancamentos.map(r => ({
      ...r,
      data: r.data ? new Date(r.data) : null,
    }))
  }, [raw])

  const listaContas = useMemo(() => raw?.contas || [], [raw])

  // Client-side filtering (cat, cc, tipo, situacao, conta — NOT date/regime, handled server-side)
  const filteredData = useMemo(() => {
    return allData.filter(r => {
      if (!r.data) return false
      if (filters.categoria.length > 0) {
        const allCats = r.categorias.map(c => c.nome)
        if (!filters.categoria.some(cat => allCats.includes(cat))) return false
      }
      if (filters.cc.length > 0) {
        const allCCs = r._ccList.map(c => c.nome)
        if (!filters.cc.some(cc => allCCs.includes(cc))) return false
      }
      if (filters.tipo     && r.tipo     !== filters.tipo)     return false
      if (filters.situacao.length > 0 && !filters.situacao.includes(r.situacao)) return false
      if (filters.conta.length    > 0 && !filters.conta.includes(r.conta))       return false
      return true
    })
  }, [allData, filters.categoria, filters.cc, filters.tipo, filters.situacao, filters.conta])

  // isRefetching = revalidating with existing data (for subtle loading overlay)
  const isRefetching = isValidating && !!raw

  return {
    allData,
    filteredData,
    filters,
    setFilters,
    clearAll,
    isLoading,
    isRefetching,
    refresh: mutate,
    listaContas,
  }
}
