'use client'

import { useMemo } from 'react'
import { X } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Filters, Lancamento } from '@/lib/types'

interface FilterBarProps {
  filters: Filters
  setFilters: (f: Filters) => void
  allData: Lancamento[]
}

export function FilterBar({ filters, setFilters, allData }: FilterBarProps) {
  const categorias = useMemo(() => {
    const set = new Set<string>()
    for (const r of allData) {
      for (const c of r.categorias) {
        if (c.nome && c.nome !== '(em branco)') set.add(c.nome)
      }
    }
    return Array.from(set).sort()
  }, [allData])

  const centrosCusto = useMemo(() => {
    const set = new Set<string>()
    for (const r of allData) {
      for (const c of r._ccList) {
        if (c.nome && c.nome !== '(em branco)') set.add(c.nome)
      }
    }
    return Array.from(set).sort()
  }, [allData])

  const situacoes = useMemo(() => {
    const set = new Set<string>()
    for (const r of allData) {
      if (r.situacao && r.situacao !== '(em branco)') set.add(r.situacao)
    }
    return Array.from(set).sort()
  }, [allData])

  const update = (key: keyof Filters, val: string) =>
    setFilters({ ...filters, [key]: val })

  const clearAll = () =>
    setFilters({ dateFrom: '', dateTo: '', categoria: '', cc: '', tipo: '', situacao: '' })

  const hasFilters = Object.values(filters).some(v => v !== '')

  return (
    <div
      style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--line)',
      }}
      className="px-6 py-[7px] flex flex-wrap items-center gap-2"
    >
      {/* Date From */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: 'var(--ink3)' }}>
          De
        </span>
        <input
          type="date"
          value={filters.dateFrom}
          onChange={e => update('dateFrom', e.target.value)}
          className="h-7 px-2 rounded border text-[11px] outline-none transition-colors focus:ring-1 focus:ring-[var(--blue)] focus:border-[var(--blue)] w-[118px]"
          style={{
            background: 'var(--surf2)',
            border: '1px solid var(--line2)',
            color: 'var(--ink)',
            fontFamily: 'Inter, sans-serif',
          }}
        />
      </div>

      <span style={{ color: 'var(--line2)' }} className="text-[11px]">—</span>

      {/* Date To */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: 'var(--ink3)' }}>
          Até
        </span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={e => update('dateTo', e.target.value)}
          className="h-7 px-2 rounded border text-[11px] outline-none transition-colors focus:ring-1 focus:ring-[var(--blue)] focus:border-[var(--blue)] w-[118px]"
          style={{
            background: 'var(--surf2)',
            border: '1px solid var(--line2)',
            color: 'var(--ink)',
            fontFamily: 'Inter, sans-serif',
          }}
        />
      </div>

      {/* Categoria */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: 'var(--ink3)' }}>
          Categoria
        </span>
        <Select value={filters.categoria || '__all__'} onValueChange={v => update('categoria', v === '__all__' ? '' : v)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas</SelectItem>
            {categorias.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Centro de Custo */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: 'var(--ink3)' }}>
          CC
        </span>
        <Select value={filters.cc || '__all__'} onValueChange={v => update('cc', v === '__all__' ? '' : v)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos</SelectItem>
            {centrosCusto.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tipo */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: 'var(--ink3)' }}>
          Tipo
        </span>
        <Select value={filters.tipo || '__all__'} onValueChange={v => update('tipo', v === '__all__' ? '' : v)}>
          <SelectTrigger className="w-[110px]">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos</SelectItem>
            <SelectItem value="Receita">Receita</SelectItem>
            <SelectItem value="Despesa">Despesa</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Situação */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: 'var(--ink3)' }}>
          Situação
        </span>
        <Select value={filters.situacao || '__all__'} onValueChange={v => update('situacao', v === '__all__' ? '' : v)}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas</SelectItem>
            {situacoes.map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Clear */}
      {hasFilters && (
        <button
          onClick={clearAll}
          className="ml-auto flex items-center gap-1 h-7 px-2.5 rounded text-[11px] transition-all"
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
          Limpar
        </button>
      )}
    </div>
  )
}
