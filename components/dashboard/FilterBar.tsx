'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import { X, ChevronDown, Check, Search } from 'lucide-react'
import type { Filters, Lancamento } from '@/lib/types'

interface FilterBarProps {
  filters: Filters
  setFilters: (f: Filters) => void
  allData: Lancamento[]
}

// ─── Period Picker ─────────────────────────────────────────────────────────────

type PeriodId =
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQuarter'
  | 'thisYear'
  | 'last30'
  | 'last12'
  | 'all'
  | 'custom'

interface PeriodOption {
  id: PeriodId
  label: string
}

const PERIODS: PeriodOption[] = [
  { id: 'thisMonth',   label: 'Este mês' },
  { id: 'lastMonth',   label: 'Mês anterior' },
  { id: 'thisQuarter', label: 'Este trimestre' },
  { id: 'thisYear',    label: 'Este ano' },
  { id: 'last30',      label: 'Últimos 30 dias' },
  { id: 'last12',      label: 'Últimos 12 meses' },
  { id: 'all',         label: 'Todo o período' },
  { id: 'custom',      label: 'Período personalizado' },
]

function toYMD(d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}

function getPeriodDates(id: PeriodId): { dateFrom: string; dateTo: string } | null {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()

  switch (id) {
    case 'thisMonth': {
      const lastDay = new Date(y, m + 1, 0).getDate()
      return {
        dateFrom: `${y}-${String(m + 1).padStart(2, '0')}-01`,
        dateTo:   `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      }
    }
    case 'lastMonth': {
      const lm = m === 0 ? 11 : m - 1
      const ly = m === 0 ? y - 1 : y
      const lastDay = new Date(ly, lm + 1, 0).getDate()
      return {
        dateFrom: `${ly}-${String(lm + 1).padStart(2, '0')}-01`,
        dateTo:   `${ly}-${String(lm + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      }
    }
    case 'thisQuarter': {
      const q = Math.floor(m / 3)
      const qStart = q * 3
      const qEnd   = qStart + 2
      const lastDay = new Date(y, qEnd + 1, 0).getDate()
      return {
        dateFrom: `${y}-${String(qStart + 1).padStart(2, '0')}-01`,
        dateTo:   `${y}-${String(qEnd   + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
      }
    }
    case 'thisYear':
      return { dateFrom: `${y}-01-01`, dateTo: `${y}-12-31` }
    case 'last30': {
      const from = new Date(now); from.setDate(from.getDate() - 29)
      return { dateFrom: toYMD(from), dateTo: toYMD(now) }
    }
    case 'last12': {
      const from = new Date(now); from.setFullYear(from.getFullYear() - 1); from.setDate(from.getDate() + 1)
      return { dateFrom: toYMD(from), dateTo: toYMD(now) }
    }
    case 'all':
      return { dateFrom: '', dateTo: '' }
    case 'custom':
      return null
  }
}

function detectActivePeriod(dateFrom: string, dateTo: string): PeriodId {
  if (!dateFrom && !dateTo) return 'all'
  for (const p of PERIODS) {
    if (p.id === 'custom') continue
    const dates = getPeriodDates(p.id)
    if (dates && dates.dateFrom === dateFrom && dates.dateTo === dateTo) return p.id
  }
  return 'custom'
}

function formatDateLabel(dateFrom: string, dateTo: string): string {
  if (!dateFrom && !dateTo) return 'Todo o período'
  const fmt = (s: string) => s.split('-').reverse().join('/')
  if (dateFrom && dateTo) return `${fmt(dateFrom)} – ${fmt(dateTo)}`
  if (dateFrom) return `A partir de ${fmt(dateFrom)}`
  return `Até ${fmt(dateTo)}`
}

interface PeriodPickerProps {
  dateFrom: string
  dateTo: string
  onChange: (from: string, to: string) => void
}

function PeriodPicker({ dateFrom, dateTo, onChange }: PeriodPickerProps) {
  const [open, setOpen]             = useState(false)
  const [activePeriod, setActive]   = useState<PeriodId>(() => detectActivePeriod(dateFrom, dateTo))
  const [customFrom, setCustomFrom] = useState(dateFrom)
  const [customTo,   setCustomTo]   = useState(dateTo)
  const ref = useRef<HTMLDivElement>(null)

  // Sync when parent resets dates externally (e.g. clearAll)
  useEffect(() => {
    const detected = detectActivePeriod(dateFrom, dateTo)
    setActive(detected)
    setCustomFrom(dateFrom)
    setCustomTo(dateTo)
  }, [dateFrom, dateTo])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selectPreset = (id: PeriodId) => {
    if (id === 'custom') {
      setActive('custom')
      return // stay open to show date inputs
    }
    const dates = getPeriodDates(id)
    if (!dates) return
    setActive(id)
    onChange(dates.dateFrom, dates.dateTo)
    setOpen(false)
  }

  const applyCustom = () => {
    onChange(customFrom, customTo)
    setOpen(false)
  }

  const label = activePeriod !== 'custom'
    ? PERIODS.find(p => p.id === activePeriod)?.label ?? formatDateLabel(dateFrom, dateTo)
    : formatDateLabel(dateFrom, dateTo)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="h-7 flex items-center gap-1.5 px-2.5 rounded text-[11px]"
        style={{
          border: '1px solid var(--line2)',
          background: 'var(--surf2)',
          color: 'var(--ink)',
          fontFamily: 'Inter, sans-serif',
          minWidth: 160,
          cursor: 'pointer',
        }}
      >
        <span className="flex-1 text-left truncate">{label}</span>
        <ChevronDown
          className="h-3 w-3 shrink-0"
          style={{
            color: 'var(--ink3)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50 rounded overflow-hidden"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
            minWidth: 210,
          }}
        >
          {PERIODS.map((p, i) => {
            const isLast   = p.id === 'all'
            const isActive = activePeriod === p.id
            return (
              <button
                key={p.id}
                onClick={() => selectPreset(p.id)}
                className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-left"
                style={{
                  background: isActive ? 'var(--surf2)' : 'transparent',
                  color: isActive ? 'var(--blue)' : 'var(--ink)',
                  fontFamily: 'Inter, sans-serif',
                  borderBottom: isLast ? '1px solid var(--line)' : 'none',
                  cursor: 'pointer',
                  fontWeight: isActive ? 600 : 400,
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surf2)' }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
              >
                <span>{p.label}</span>
                {isActive && <Check className="h-3 w-3 shrink-0" style={{ color: 'var(--blue)' }} />}
              </button>
            )
          })}

          {/* Custom date inputs — only shown when "custom" is active */}
          {activePeriod === 'custom' && (
            <div className="px-3 py-2.5 flex flex-col gap-2">
              {(['De', 'Até'] as const).map((lbl, i) => (
                <div key={lbl} className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-semibold tracking-wider uppercase w-6 shrink-0"
                    style={{ color: 'var(--ink3)' }}
                  >
                    {lbl}
                  </span>
                  <input
                    type="date"
                    value={i === 0 ? customFrom : customTo}
                    onChange={e => i === 0 ? setCustomFrom(e.target.value) : setCustomTo(e.target.value)}
                    className="flex-1 h-6 px-1.5 rounded text-[11px] outline-none"
                    style={{
                      border: '1px solid var(--line2)',
                      background: 'var(--surf2)',
                      color: 'var(--ink)',
                      fontFamily: 'Inter, sans-serif',
                    }}
                  />
                </div>
              ))}
              <button
                onClick={applyCustom}
                className="h-7 w-full rounded text-[11px] font-semibold mt-0.5"
                style={{
                  background: 'var(--blue)',
                  color: '#fff',
                  fontFamily: 'Inter, sans-serif',
                  cursor: 'pointer',
                  border: 'none',
                }}
              >
                Aplicar período
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Multi-Select Filter ───────────────────────────────────────────────────────

interface MultiSelectProps {
  options: string[]
  selected: string[]
  onChange: (v: string[]) => void
  width?: number
  placeholder?: string
}

function MultiSelect({ options, selected, onChange, width = 160, placeholder = 'Todos' }: MultiSelectProps) {
  const [open, setOpen]   = useState(false)
  const [draft, setDraft] = useState<string[]>(selected)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Re-sync draft when dropdown opens (discard uncommitted changes)
  useEffect(() => {
    if (open) {
      setDraft(selected)
      setSearch('')
      // Focus search after transition
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [open]) // intentionally only on open toggle

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const visibleOptions = useMemo(() => {
    if (!search.trim()) return options
    const q = search.toLowerCase()
    return options.filter(o => o.toLowerCase().includes(q))
  }, [options, search])

  const allChecked  = visibleOptions.length > 0 && visibleOptions.every(o => draft.includes(o))
  const someChecked = visibleOptions.some(o => draft.includes(o))

  const toggleAll = () => {
    if (allChecked) {
      setDraft(prev => prev.filter(v => !visibleOptions.includes(v)))
    } else {
      setDraft(prev => Array.from(new Set([...prev, ...visibleOptions])))
    }
  }

  const toggleItem = (item: string) => {
    setDraft(prev => prev.includes(item) ? prev.filter(v => v !== item) : [...prev, item])
  }

  const apply = () => { onChange(draft); setOpen(false) }
  const clear  = () => { onChange([]); setDraft([]); setOpen(false) }

  // Trigger label
  const triggerLabel =
    selected.length === 0 ? placeholder :
    selected.length === 1 ? selected[0] :
    `${selected.length} selecionados`

  const isActive = selected.length > 0

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="h-7 flex items-center gap-1.5 px-2.5 rounded text-[11px]"
        style={{
          border: isActive ? '1px solid var(--blue)' : '1px solid var(--line2)',
          background: 'var(--surf2)',
          color: isActive ? 'var(--blue)' : 'var(--ink)',
          fontFamily: 'Inter, sans-serif',
          minWidth: width,
          cursor: 'pointer',
          fontWeight: isActive ? 600 : 400,
        }}
      >
        <span className="flex-1 text-left truncate">{triggerLabel}</span>
        {isActive && (
          <span
            className="shrink-0 text-[9px] font-bold rounded-full px-1 py-px leading-none"
            style={{ background: 'var(--blue)', color: '#fff', minWidth: 16, textAlign: 'center' }}
          >
            {selected.length}
          </span>
        )}
        <ChevronDown
          className="h-3 w-3 shrink-0"
          style={{
            color: isActive ? 'var(--blue)' : 'var(--ink3)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50 rounded"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
            minWidth: Math.max(width, 200),
            maxWidth: 300,
          }}
        >
          {/* Search */}
          <div className="p-2" style={{ borderBottom: '1px solid var(--line)' }}>
            <div className="relative flex items-center">
              <Search className="absolute left-2 h-3 w-3 pointer-events-none" style={{ color: 'var(--ink3)' }} />
              <input
                ref={searchRef}
                type="text"
                placeholder="Buscar..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full h-6 pl-6 pr-2 rounded text-[11px] outline-none"
                style={{
                  border: '1px solid var(--line2)',
                  background: 'var(--surf2)',
                  color: 'var(--ink)',
                  fontFamily: 'Inter, sans-serif',
                }}
              />
            </div>
          </div>

          {/* Select all */}
          <div
            className="flex items-center gap-2 px-3 py-2 cursor-pointer"
            style={{ borderBottom: '1px solid var(--line)' }}
            onClick={toggleAll}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surf2)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <Checkbox checked={allChecked} indeterminate={someChecked && !allChecked} />
            <span className="text-[11px] font-medium" style={{ color: 'var(--ink2)', fontFamily: 'Inter, sans-serif' }}>
              Selecionar todas
            </span>
          </div>

          {/* Options */}
          <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
            {visibleOptions.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-center" style={{ color: 'var(--ink3)', fontFamily: 'Inter, sans-serif' }}>
                Nenhuma opção encontrada
              </div>
            ) : (
              visibleOptions.map(opt => (
                <div
                  key={opt}
                  className="flex items-center gap-2 px-3 py-1.5 cursor-pointer"
                  onClick={() => toggleItem(opt)}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--surf2)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <Checkbox checked={draft.includes(opt)} />
                  <span
                    className="text-[11px] flex-1 truncate"
                    style={{ color: 'var(--ink)', fontFamily: 'Inter, sans-serif' }}
                    title={opt}
                  >
                    {opt}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-between gap-2 p-2"
            style={{ borderTop: '1px solid var(--line)' }}
          >
            <button
              onClick={clear}
              className="text-[11px] px-2 py-1 rounded"
              style={{
                color: 'var(--ink3)',
                fontFamily: 'Inter, sans-serif',
                cursor: 'pointer',
                background: 'none',
                border: 'none',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--ink3)' }}
            >
              Limpar
            </button>
            <button
              onClick={apply}
              className="h-6 px-3 rounded text-[11px] font-semibold"
              style={{
                background: 'var(--blue)',
                color: '#fff',
                fontFamily: 'Inter, sans-serif',
                cursor: 'pointer',
                border: 'none',
              }}
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Checkbox primitive ────────────────────────────────────────────────────────

function Checkbox({ checked, indeterminate }: { checked: boolean; indeterminate?: boolean }) {
  return (
    <div
      className="shrink-0 flex items-center justify-center rounded-sm"
      style={{
        width: 14,
        height: 14,
        border: checked || indeterminate ? '1.5px solid var(--blue)' : '1.5px solid var(--line2)',
        background: checked ? 'var(--blue)' : 'transparent',
        transition: 'all 0.1s',
      }}
    >
      {checked && <Check style={{ width: 9, height: 9, color: '#fff', strokeWidth: 3 }} />}
      {!checked && indeterminate && (
        <div style={{ width: 6, height: 2, background: 'var(--blue)', borderRadius: 1 }} />
      )}
    </div>
  )
}

// ─── Tipo segmented control ────────────────────────────────────────────────────

function TipoFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const opts = [
    { id: '',        label: 'Todos'   },
    { id: 'Receita', label: 'Receita' },
    { id: 'Despesa', label: 'Despesa' },
  ]
  return (
    <div
      className="flex rounded overflow-hidden h-7"
      style={{ border: '1px solid var(--line2)' }}
    >
      {opts.map((opt, i) => {
        const active = value === opt.id
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className="px-2.5 text-[11px] font-medium"
            style={{
              background: active ? 'var(--blue)' : 'var(--surf2)',
              color: active ? '#fff' : 'var(--ink2)',
              fontFamily: 'Inter, sans-serif',
              cursor: 'pointer',
              border: 'none',
              borderRight: i < opts.length - 1 ? '1px solid var(--line2)' : 'none',
              transition: 'background 0.12s, color 0.12s',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Separator ─────────────────────────────────────────────────────────────────

function Sep() {
  return (
    <span
      className="text-[11px] select-none"
      style={{ color: 'var(--line2)', marginInline: 2 }}
      aria-hidden
    >
      ·
    </span>
  )
}

// ─── FilterBar ─────────────────────────────────────────────────────────────────

export function FilterBar({ filters, setFilters, allData }: FilterBarProps) {
  const categorias = useMemo(() => {
    const set = new Set<string>()
    for (const r of allData)
      for (const c of r.categorias)
        if (c.nome && c.nome !== '(em branco)') set.add(c.nome)
    return Array.from(set).sort()
  }, [allData])

  const centrosCusto = useMemo(() => {
    const set = new Set<string>()
    for (const r of allData)
      for (const c of r._ccList)
        if (c.nome && c.nome !== '(em branco)') set.add(c.nome)
    return Array.from(set).sort()
  }, [allData])

  const situacoes = useMemo(() => {
    const set = new Set<string>()
    for (const r of allData)
      if (r.situacao && r.situacao !== '(em branco)') set.add(r.situacao)
    return Array.from(set).sort()
  }, [allData])

  const contas = useMemo(() => {
    const set = new Set<string>()
    for (const r of allData)
      if (r.conta && r.conta !== '(em branco)') set.add(r.conta)
    return Array.from(set).sort()
  }, [allData])

  const update = <K extends keyof Filters>(key: K, val: Filters[K]) =>
    setFilters({ ...filters, [key]: val })

  const clearAll = () =>
    setFilters({
      dateFrom: '', dateTo: '',
      categoria: [], cc: [], tipo: '', situacao: [], conta: [],
    })

  const hasFilters =
    !!filters.dateFrom || !!filters.dateTo ||
    filters.categoria.length > 0 || filters.cc.length > 0 ||
    !!filters.tipo || filters.situacao.length > 0 || filters.conta.length > 0

  const label = (txt: string) => (
    <span
      className="text-[10px] font-semibold tracking-wider uppercase"
      style={{ color: 'var(--ink3)' }}
    >
      {txt}
    </span>
  )

  return (
    <div
      style={{ background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}
      className="px-6 py-[7px] flex flex-wrap items-center gap-2"
    >
      {/* Período */}
      <div className="flex items-center gap-1.5">
        {label('Período')}
        <PeriodPicker
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          onChange={(from, to) => setFilters({ ...filters, dateFrom: from, dateTo: to })}
        />
      </div>

      <Sep />

      {/* Tipo */}
      <div className="flex items-center gap-1.5">
        {label('Tipo')}
        <TipoFilter value={filters.tipo} onChange={v => update('tipo', v)} />
      </div>

      <Sep />

      {/* Situação */}
      <div className="flex items-center gap-1.5">
        {label('Situação')}
        <MultiSelect
          options={situacoes}
          selected={filters.situacao}
          onChange={v => update('situacao', v)}
          width={130}
          placeholder="Todas"
        />
      </div>

      <Sep />

      {/* Categoria */}
      <div className="flex items-center gap-1.5">
        {label('Categoria')}
        <MultiSelect
          options={categorias}
          selected={filters.categoria}
          onChange={v => update('categoria', v)}
          width={160}
          placeholder="Todas"
        />
      </div>

      <Sep />

      {/* Centro de Custo */}
      <div className="flex items-center gap-1.5">
        {label('CC')}
        <MultiSelect
          options={centrosCusto}
          selected={filters.cc}
          onChange={v => update('cc', v)}
          width={140}
          placeholder="Todos"
        />
      </div>

      <Sep />

      {/* Conta financeira */}
      <div className="flex items-center gap-1.5">
        {label('Conta')}
        <MultiSelect
          options={contas}
          selected={filters.conta}
          onChange={v => update('conta', v)}
          width={160}
          placeholder="Todas"
        />
      </div>

      {/* Limpar */}
      {hasFilters && (
        <button
          onClick={clearAll}
          className="ml-auto flex items-center gap-1 h-7 px-2.5 rounded text-[11px]"
          style={{
            border: '1px solid var(--line2)',
            color: 'var(--ink3)',
            background: 'none',
            fontFamily: 'Inter, sans-serif',
            cursor: 'pointer',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--red)'
            e.currentTarget.style.color = 'var(--red)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--line2)'
            e.currentTarget.style.color = 'var(--ink3)'
          }}
        >
          <X className="h-3 w-3" />
          Limpar tudo
        </button>
      )}
    </div>
  )
}
