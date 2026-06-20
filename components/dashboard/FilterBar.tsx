'use client'

import { useMemo, useState, useEffect, useRef } from 'react'
import { X, ChevronDown, ChevronLeft, ChevronRight, Check, Search } from 'lucide-react'
import type { Filters, Lancamento, TipoPeriodo, Atalho } from '@/lib/types'
import { resolveAtalho } from '@/hooks/useFinanceiro'

interface FilterBarProps {
  filters: Filters
  setFilters: (f: Filters) => void
  clearAll: () => void
  allData: Lancamento[]
  listaContas: string[]
  /** Tab ativa do dashboard. Permite desabilitar controles que não fazem
   *  sentido em telas específicas (ex.: regime caixa na tab BUs). */
  activeTab?: string
}

// ── PT-BR month names ─────────────────────────────────────────────────────────

const MONTHS_LONG  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                      'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
const MONTHS_SHORT = ['jan','fev','mar','abr','mai','jun',
                      'jul','ago','set','out','nov','dez']

// ── Period navigator helpers ──────────────────────────────────────────────────

type AtalhoGroup = { label: string; items: { id: Atalho; label: string }[] }

const ATALHO_GROUPS: AtalhoGroup[] = [
  {
    label: 'Períodos atuais',
    items: [
      { id: 'este-mes',        label: 'Este mês'       },
      { id: 'mes-anterior',    label: 'Mês anterior'   },
      { id: 'este-trimestre',  label: 'Este trimestre' },
      { id: 'este-ano',        label: 'Este ano'       },
    ],
  },
  {
    label: 'Relativos',
    items: [
      { id: 'ultimos-30',       label: 'Últimos 30 dias'   },
      { id: 'ultimos-12-meses', label: 'Últimos 12 meses'  },
    ],
  },
  {
    label: 'Especiais',
    items: [
      { id: 'todo-periodo',  label: 'Todo o período'  },
      { id: 'personalizado', label: 'Personalizado…'  },
    ],
  },
]

function atalhoToTipoPeriodo(a: Atalho): TipoPeriodo {
  if (a === 'este-trimestre')                      return 'trimestre'
  if (a === 'este-ano' || a === 'ultimos-12-meses') return 'ano'
  if (a === 'personalizado' || a === 'todo-periodo') return 'personalizado'
  return 'mes'
}

function getLabel(tipoPeriodo: TipoPeriodo, atalho: Atalho, dateFrom: string): string {
  if (atalho === 'todo-periodo') return 'Todo o período'

  if (tipoPeriodo === 'mes' && dateFrom) {
    const d = new Date(dateFrom + 'T00:00:00')
    return `${MONTHS_LONG[d.getMonth()]} de ${d.getFullYear()}`
  }
  if (tipoPeriodo === 'trimestre' && dateFrom) {
    const d = new Date(dateFrom + 'T00:00:00')
    const q = Math.floor(d.getMonth() / 3) + 1
    return `Q${q} ${d.getFullYear()}`
  }
  if (tipoPeriodo === 'ano' && dateFrom) {
    const d = new Date(dateFrom + 'T00:00:00')
    return `${d.getFullYear()}`
  }
  // personalizado
  if (!dateFrom) return 'Período personalizado'
  const d = new Date(dateFrom + 'T00:00:00')
  return `${String(d.getDate()).padStart(2,'0')} ${MONTHS_SHORT[d.getMonth()]}`
}

function navigatePeriod(
  direction: -1 | 1,
  tipoPeriodo: TipoPeriodo,
  dateFrom: string,
): { dateFrom: string; dateTo: string } | null {
  if (tipoPeriodo === 'personalizado' || !dateFrom) return null

  const d = new Date(dateFrom + 'T00:00:00')

  if (tipoPeriodo === 'mes') {
    const nd = new Date(d.getFullYear(), d.getMonth() + direction, 1)
    const ld = new Date(nd.getFullYear(), nd.getMonth() + 1, 0).getDate()
    const m  = String(nd.getMonth() + 1).padStart(2, '0')
    return {
      dateFrom: `${nd.getFullYear()}-${m}-01`,
      dateTo:   `${nd.getFullYear()}-${m}-${String(ld).padStart(2, '0')}`,
    }
  }
  if (tipoPeriodo === 'trimestre') {
    const nd     = new Date(d.getFullYear(), d.getMonth() + direction * 3, 1)
    const q      = Math.floor(nd.getMonth() / 3)
    const qStart = q * 3
    const qEnd   = qStart + 2
    const ld     = new Date(nd.getFullYear(), qEnd + 1, 0).getDate()
    return {
      dateFrom: `${nd.getFullYear()}-${String(qStart + 1).padStart(2, '0')}-01`,
      dateTo:   `${nd.getFullYear()}-${String(qEnd   + 1).padStart(2, '0')}-${String(ld).padStart(2, '0')}`,
    }
  }
  if (tipoPeriodo === 'ano') {
    const y = d.getFullYear() + direction
    return { dateFrom: `${y}-01-01`, dateTo: `${y}-12-31` }
  }
  return null
}

// ── PeriodNavigator ───────────────────────────────────────────────────────────

interface PeriodNavigatorProps {
  filters: Filters
  onChange: (patch: Partial<Filters>) => void
}

function PeriodNavigator({ filters, onChange }: PeriodNavigatorProps) {
  const { tipoPeriodo, atalho, dateFrom, dateTo } = filters
  const [open, setOpen]         = useState(false)
  const [customFrom, setCFrom]  = useState(dateFrom)
  const [customTo,   setCTo]    = useState(dateTo)
  const ref = useRef<HTMLDivElement>(null)

  // Sync custom inputs when filter resets externally
  useEffect(() => {
    setCFrom(dateFrom)
    setCTo(dateTo)
  }, [dateFrom, dateTo])

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const arrowsDisabled = tipoPeriodo === 'personalizado' || atalho === 'todo-periodo'

  const handleArrow = (dir: -1 | 1) => {
    if (arrowsDisabled) return
    const result = navigatePeriod(dir, tipoPeriodo, dateFrom)
    if (result) {
      // After navigating away from a preset, mark as personalizado
      onChange({ ...result, atalho: 'personalizado', tipoPeriodo })
    }
  }

  const selectAtalho = (id: Atalho) => {
    if (id === 'personalizado') {
      onChange({ atalho: 'personalizado', tipoPeriodo: 'personalizado' })
      // Keep dropdown open to show date inputs
      return
    }
    const dates = resolveAtalho(id)
    onChange({ atalho: id, tipoPeriodo: atalhoToTipoPeriodo(id), ...dates })
    setOpen(false)
  }

  const applyCustom = () => {
    onChange({ atalho: 'personalizado', tipoPeriodo: 'personalizado', dateFrom: customFrom, dateTo: customTo })
    setOpen(false)
  }

  const label = getLabel(tipoPeriodo, atalho, dateFrom)

  const NAV_BTN: React.CSSProperties = {
    width: 36, height: 36,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'none', border: 'none',
    color: arrowsDisabled ? 'var(--line2)' : 'var(--ink3)',
    cursor: arrowsDisabled ? 'not-allowed' : 'pointer',
    flexShrink: 0,
  }

  return (
    <div ref={ref} className="relative">
      {/* Navigator pill */}
      <div
        className="flex items-center"
        style={{
          border: '0.5px solid var(--line2)',
          borderRadius: 6,
          background: 'var(--surf2)',
          height: 36,
          minWidth: 220,
        }}
      >
        {/* Left arrow */}
        <button
          style={NAV_BTN}
          disabled={arrowsDisabled}
          onClick={() => handleArrow(-1)}
          aria-label="Período anterior"
          onMouseEnter={e => { if (!arrowsDisabled) e.currentTarget.style.color = 'var(--ink)' }}
          onMouseLeave={e => { e.currentTarget.style.color = arrowsDisabled ? 'var(--line2)' : 'var(--ink3)' }}
        >
          <ChevronLeft size={14} />
        </button>

        {/* Center label + dropdown trigger */}
        <button
          onClick={() => setOpen(v => !v)}
          className="flex-1 flex items-center justify-center gap-1"
          style={{
            height: '100%',
            background: 'none',
            border: 'none',
            borderLeft: '0.5px solid var(--line2)',
            borderRight: '0.5px solid var(--line2)',
            cursor: 'pointer',
            padding: '0 10px',
          }}
        >
          <span
            style={{
              fontSize: 12, fontWeight: 500,
              color: 'var(--ink)',
              fontFamily: 'Inter, sans-serif',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </span>
          <ChevronDown
            size={11}
            style={{
              color: 'var(--ink3)',
              transform: open ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s',
              flexShrink: 0,
            }}
          />
        </button>

        {/* Right arrow */}
        <button
          style={NAV_BTN}
          disabled={arrowsDisabled}
          onClick={() => handleArrow(1)}
          aria-label="Próximo período"
          onMouseEnter={e => { if (!arrowsDisabled) e.currentTarget.style.color = 'var(--ink)' }}
          onMouseLeave={e => { e.currentTarget.style.color = arrowsDisabled ? 'var(--line2)' : 'var(--ink3)' }}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50"
          style={{
            background: 'var(--surface)',
            border: '0.5px solid var(--line2)',
            borderRadius: 6,
            boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
            minWidth: 220,
            padding: 4,
          }}
        >
          {ATALHO_GROUPS.map((group, gi) => (
            <div key={group.label}>
              {gi > 0 && (
                <div style={{ height: '0.5px', background: 'var(--line)', margin: '4px 0' }} />
              )}
              {group.items.map(item => {
                const isActive = atalho === item.id
                const isSpecial = item.id === 'personalizado' || item.id === 'todo-periodo'
                return (
                  <button
                    key={item.id}
                    onClick={() => selectAtalho(item.id)}
                    className="w-full flex items-center justify-between"
                    style={{
                      padding: '8px 10px',
                      borderRadius: 4,
                      border: 'none',
                      background: isActive ? 'var(--surf2)' : 'none',
                      color: isSpecial ? 'var(--blue)' : isActive ? 'var(--ink)' : 'var(--ink)',
                      fontFamily: 'Inter, sans-serif',
                      fontSize: 12,
                      fontWeight: isActive ? 600 : 400,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surf2)' }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'none' }}
                  >
                    <span>{item.label}</span>
                    {isActive && <Check size={12} style={{ color: 'var(--blue)', flexShrink: 0 }} />}
                  </button>
                )
              })}
            </div>
          ))}

          {/* Custom date inputs (shown when personalizado selected) */}
          {(atalho === 'personalizado') && (
            <div style={{ borderTop: '0.5px solid var(--line)', marginTop: 4, paddingTop: 8, padding: '8px 10px 4px' }}>
              {(['De', 'Até'] as const).map((lbl, i) => (
                <div key={lbl} className="flex items-center gap-2 mb-2">
                  <span
                    style={{
                      fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                      letterSpacing: '0.06em', color: 'var(--ink3)',
                      width: 24, flexShrink: 0,
                    }}
                  >
                    {lbl}
                  </span>
                  <input
                    type="date"
                    value={i === 0 ? customFrom : customTo}
                    onChange={e => i === 0 ? setCFrom(e.target.value) : setCTo(e.target.value)}
                    style={{
                      flex: 1, height: 26, padding: '0 6px',
                      border: '0.5px solid var(--line2)',
                      borderRadius: 4,
                      background: 'var(--surf2)',
                      color: 'var(--ink)',
                      fontFamily: 'Inter, sans-serif',
                      fontSize: 11,
                      outline: 'none',
                    }}
                  />
                </div>
              ))}
              <button
                onClick={applyCustom}
                style={{
                  width: '100%', height: 28, borderRadius: 4, border: 'none',
                  background: 'var(--blue)', color: '#fff',
                  fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600,
                  cursor: 'pointer',
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

// ── Regime toggle (Competência / Caixa) ───────────────────────────────────────

function RegimeToggle({
  value, onChange, disabledMap,
}: {
  value: 'competencia' | 'caixa'
  onChange: (v: 'competencia' | 'caixa') => void
  /** Mapa id → tooltip quando o botão está desabilitado. */
  disabledMap?: Partial<Record<'competencia' | 'caixa', string>>
}) {
  const opts: { id: 'competencia' | 'caixa'; label: string }[] = [
    { id: 'competencia', label: 'Competência' },
    { id: 'caixa',       label: 'Caixa'       },
  ]
  return (
    <div
      className="flex items-center"
      style={{
        background: 'var(--surf2)',
        borderRadius: 99,
        padding: 3,
        gap: 2,
        border: '0.5px solid var(--line2)',
        height: 36,
      }}
    >
      {opts.map(opt => {
        const active = value === opt.id
        const disabledTip = disabledMap?.[opt.id]
        const isDisabled = !!disabledTip
        return (
          <button
            key={opt.id}
            onClick={isDisabled ? undefined : () => onChange(opt.id)}
            disabled={isDisabled}
            title={disabledTip}
            style={{
              height: 30,
              padding: '0 12px',
              borderRadius: 99,
              border: 'none',
              background:  active ? 'var(--surface)' : 'transparent',
              color:       active ? 'var(--ink)'     : 'var(--ink3)',
              fontFamily:  'Inter, sans-serif',
              fontSize:    11,
              fontWeight:  active ? 600 : 400,
              cursor:      isDisabled ? 'not-allowed' : 'pointer',
              opacity:     isDisabled ? 0.5 : 1,
              boxShadow:   active ? '0 0 0 0.5px var(--line2)' : 'none',
              transition:  'all 0.12s',
              whiteSpace:  'nowrap',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Multi-Select Filter ───────────────────────────────────────────────────────

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

  useEffect(() => {
    if (open) {
      setDraft(selected)
      setSearch('')
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (allChecked) setDraft(prev => prev.filter(v => !visibleOptions.includes(v)))
    else            setDraft(prev => Array.from(new Set([...prev, ...visibleOptions])))
  }

  const toggleItem = (item: string) =>
    setDraft(prev => prev.includes(item) ? prev.filter(v => v !== item) : [...prev, item])

  const apply = () => { onChange(draft); setOpen(false) }
  const clear  = () => { onChange([]);   setDraft([]);   setOpen(false) }

  const triggerLabel =
    selected.length === 0 ? placeholder :
    selected.length === 1 ? selected[0] :
    `${selected.length} selecionados`

  const isActive = selected.length > 0

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="h-9 flex items-center gap-1.5 px-2.5 text-[11px]"
        style={{
          border:       isActive ? '1px solid var(--blue)' : '1px solid var(--line2)',
          background:   'var(--surf2)',
          color:        isActive ? 'var(--blue)' : 'var(--ink)',
          fontFamily:   'Inter, sans-serif',
          minWidth:     width,
          cursor:       'pointer',
          fontWeight:   isActive ? 600 : 400,
          borderRadius: 8,
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
            color:     isActive ? 'var(--blue)' : 'var(--ink3)',
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
            border:     '1px solid var(--line)',
            boxShadow:  '0 4px 16px rgba(0,0,0,0.10)',
            minWidth:   Math.max(width, 200),
            maxWidth:   300,
          }}
        >
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
                  border:     '1px solid var(--line2)',
                  background: 'var(--surf2)',
                  color:      'var(--ink)',
                  fontFamily: 'Inter, sans-serif',
                }}
              />
            </div>
          </div>

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

          <div
            className="flex items-center justify-between gap-2 p-2"
            style={{ borderTop: '1px solid var(--line)' }}
          >
            <button
              onClick={clear}
              className="text-[11px] px-2 py-1 rounded"
              style={{ color: 'var(--ink3)', fontFamily: 'Inter, sans-serif', cursor: 'pointer', background: 'none', border: 'none' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--ink3)' }}
            >
              Limpar
            </button>
            <button
              onClick={apply}
              className="h-6 px-3 rounded text-[11px] font-semibold"
              style={{ background: 'var(--blue)', color: '#fff', fontFamily: 'Inter, sans-serif', cursor: 'pointer', border: 'none' }}
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Checkbox primitive ────────────────────────────────────────────────────────

function Checkbox({ checked, indeterminate }: { checked: boolean; indeterminate?: boolean }) {
  return (
    <div
      className="shrink-0 flex items-center justify-center rounded-sm"
      style={{
        width: 14, height: 14,
        border:     checked || indeterminate ? '1.5px solid var(--blue)' : '1.5px solid var(--line2)',
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

// ── Tipo segmented control ────────────────────────────────────────────────────

function TipoFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const opts = [
    { id: '',        label: 'Todos'   },
    { id: 'Receita', label: 'Receita' },
    { id: 'Despesa', label: 'Despesa' },
  ]
  return (
    <div className="flex overflow-hidden h-9" style={{ border: '1px solid var(--line2)', borderRadius: 8 }}>
      {opts.map((opt, i) => {
        const active = value === opt.id
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className="px-2.5 text-[11px] font-medium"
            style={{
              background:  active ? 'var(--surface)' : 'var(--surf2)',
              color:       active ? 'var(--ink)'     : 'var(--ink3)',
              fontFamily:  'Inter, sans-serif',
              fontWeight:  active ? 600 : 400,
              cursor:      'pointer',
              border:      'none',
              borderRight: i < opts.length - 1 ? '1px solid var(--line2)' : 'none',
              boxShadow:   active ? 'inset 0 0 0 0.5px var(--line2)' : 'none',
              transition:  'background 0.12s, color 0.12s',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Tipo dropdown (seleção única) ─────────────────────────────────────────────

function TipoDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const opts = [
    { id: '',        label: 'Todos'   },
    { id: 'Receita', label: 'Receita' },
    { id: 'Despesa', label: 'Despesa' },
  ]

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const isActive = value !== ''
  const triggerLabel = opts.find(o => o.id === value)?.label ?? 'Todos'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="h-9 flex items-center gap-1.5 px-2.5 text-[11px]"
        style={{
          border:       isActive ? '1px solid var(--blue)' : '1px solid var(--line2)',
          background:   'var(--surf2)',
          color:        isActive ? 'var(--blue)' : 'var(--ink)',
          fontFamily:   'Inter, sans-serif',
          minWidth:     130,
          cursor:       'pointer',
          fontWeight:   isActive ? 600 : 400,
          borderRadius: 8,
        }}
      >
        <span className="flex-1 text-left">{triggerLabel}</span>
        <ChevronDown
          className="h-3 w-3 shrink-0"
          style={{
            color:      isActive ? 'var(--blue)' : 'var(--ink3)',
            transform:  open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50"
          style={{
            background:   'var(--surface)',
            border:       '1px solid var(--line)',
            borderRadius: 6,
            boxShadow:    '0 4px 16px rgba(0,0,0,0.10)',
            minWidth:     130,
            padding:      4,
          }}
        >
          {opts.map(opt => {
            const isSelected = value === opt.id
            return (
              <button
                key={opt.id}
                onClick={() => { onChange(opt.id); setOpen(false) }}
                className="w-full flex items-center justify-between"
                style={{
                  padding:    '7px 10px',
                  borderRadius: 4,
                  border:     'none',
                  background: isSelected ? 'var(--surf2)' : 'none',
                  color:      'var(--ink)',
                  fontFamily: 'Inter, sans-serif',
                  fontSize:   12,
                  fontWeight: isSelected ? 600 : 400,
                  cursor:     'pointer',
                  textAlign:  'left',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--surf2)' }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'none' }}
              >
                <span>{opt.label}</span>
                {isSelected && <Check size={12} style={{ color: 'var(--blue)', flexShrink: 0 }} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Separator ─────────────────────────────────────────────────────────────────

function Sep() {
  return (
    <div
      aria-hidden
      style={{
        width: 1,
        height: 18,
        background: 'var(--line2)',
        alignSelf: 'center',
        flexShrink: 0,
        marginInline: 2,
      }}
    />
  )
}

// ── FilterBar (public export) ─────────────────────────────────────────────────

export function FilterBar({ filters, setFilters, clearAll, allData, listaContas, activeTab }: FilterBarProps) {
  const update = <K extends keyof Filters>(key: K, val: Filters[K]) =>
    setFilters({ ...filters, [key]: val })

  const patchFilters = (patch: Partial<Filters>) =>
    setFilters({ ...filters, ...patch })

  // Dynamic options from data
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

  const contas = useMemo(() => listaContas.sort(), [listaContas])

  // "Limpar tudo" shows if any non-default filter is active
  const hasFilters =
    filters.regime      !== 'competencia' ||
    filters.atalho      !== 'este-mes'    ||
    filters.categoria.length > 0          ||
    filters.cc.length   > 0              ||
    !!filters.tipo                         ||
    filters.situacao.length > 0           ||
    filters.conta.length > 0

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
      {/* Regime — sem label (auto-explicativo).
          Na tab BUs o regime caixa ainda não foi implementado (o route
          /api/financeiro/bus só consulta competência). Desabilitamos
          temporariamente o botão pra evitar confusão. */}
      <RegimeToggle
        value={filters.regime}
        onChange={v => update('regime', v)}
        disabledMap={activeTab === 'bus'
          ? { caixa: 'Regime caixa ainda não disponível para BUs. Em breve.' }
          : undefined}
      />

      <Sep />

      {/* Período — PeriodNavigator */}
      <div className="flex items-center gap-1.5">
        {label('Período')}
        <PeriodNavigator filters={filters} onChange={patchFilters} />
      </div>

      <Sep />

      {/* Tipo */}
      <div className="flex items-center gap-1.5">
        {label('Tipo')}
        <TipoDropdown value={filters.tipo} onChange={v => update('tipo', v)} />
      </div>

      <Sep />

      {/* Situação */}
      <div className="flex items-center gap-1.5">
        {label('Situação')}
        <MultiSelect
          options={situacoes}
          selected={filters.situacao}
          onChange={v => update('situacao', v)}
          width={150}
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
          width={150}
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
          width={150}
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
          width={150}
          placeholder="Todas"
        />
      </div>

      {/* Limpar tudo */}
      {hasFilters && (
        <button
          onClick={clearAll}
          className="ml-auto flex items-center gap-1 h-9 px-2.5 rounded text-[11px]"
          style={{
            border:     '1px solid var(--line2)',
            color:      'var(--ink3)',
            background: 'none',
            fontFamily: 'Inter, sans-serif',
            cursor:     'pointer',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--red)'
            e.currentTarget.style.color       = 'var(--red)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--line2)'
            e.currentTarget.style.color       = 'var(--ink3)'
          }}
        >
          <X className="h-3 w-3" />
          Limpar tudo
        </button>
      )}
    </div>
  )
}
