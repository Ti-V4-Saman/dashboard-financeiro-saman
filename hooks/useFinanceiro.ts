'use client'
import useSWR from 'swr'
import { useMemo, useState } from 'react'
import type { Lancamento, Filters } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export function useFinanceiro() {
  const { data: raw, isLoading, mutate } = useSWR<Lancamento[]>('/api/financeiro', fetcher)
  const [filters, setFilters] = useState<Filters>(() => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate()
    return {
      dateFrom: `${y}-${m}-01`,
      dateTo: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
      categoria: '', cc: '', tipo: '', situacao: ''
    }
  })

  const allData = useMemo(() => {
    if (!raw) return []
    // converter datas (JSON perde Date objects)
    return raw.map(r => ({ ...r, data: r.data ? new Date(r.data) : null }))
  }, [raw])

  const filteredData = useMemo(() => {
    return allData.filter(r => {
      if (!r.data) return false
      if (filters.dateFrom && r.data < new Date(filters.dateFrom)) return false
      if (filters.dateTo && r.data > new Date(filters.dateTo + 'T23:59:59')) return false
      if (filters.categoria) {
        const allCats = r.categorias.map(c => c.nome)
        if (!allCats.includes(filters.categoria)) return false
      }
      if (filters.cc) {
        const allCCs = r._ccList.map(c => c.nome)
        if (!allCCs.includes(filters.cc)) return false
      }
      if (filters.tipo && r.tipo !== filters.tipo) return false
      if (filters.situacao && r.situacao !== filters.situacao) return false
      return true
    })
  }, [allData, filters])

  return { allData, filteredData, filters, setFilters, isLoading, refresh: mutate }
}
