'use client'
import useSWR from 'swr'
import { useMemo, useState } from 'react'
import type { Lancamento, Filters } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export function useFinanceiro() {
  const { data: raw, isLoading, mutate } = useSWR<{ lancamentos: Lancamento[], contas: string[] }>(
    '/api/financeiro', 
    fetcher,
    { refreshInterval: 15 * 60 * 1000 } // Atualiza o dash a cada 15 min
  )
  const [filters, setFilters] = useState<Filters>(() => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate()
    return {
      dateFrom: `${y}-${m}-01`,
      dateTo: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
      categoria: [], cc: [], tipo: '', situacao: [], conta: [],
    }
  })

  const allData = useMemo(() => {
    if (!raw?.lancamentos || !Array.isArray(raw.lancamentos)) return []
    return raw.lancamentos.map(r => ({ ...r, data: r.data ? new Date(r.data) : null }))
  }, [raw])

  const listaContas = useMemo(() => raw?.contas || [], [raw])

  const filteredData = useMemo(() => {
    return allData.filter(r => {
      if (!r.data) return false
      if (filters.dateFrom && r.data < new Date(filters.dateFrom)) return false
      if (filters.dateTo && r.data > new Date(filters.dateTo + 'T23:59:59')) return false
      if (filters.categoria.length > 0) {
        const allCats = r.categorias.map(c => c.nome)
        if (!filters.categoria.some(cat => allCats.includes(cat))) return false
      }
      if (filters.cc.length > 0) {
        const allCCs = r._ccList.map(c => c.nome)
        if (!filters.cc.some(cc => allCCs.includes(cc))) return false
      }
      if (filters.tipo && r.tipo !== filters.tipo) return false
      if (filters.situacao.length > 0 && !filters.situacao.includes(r.situacao)) return false
      if (filters.conta.length > 0 && !filters.conta.includes(r.conta)) return false
      return true
    })
  }, [allData, filters])

  return { allData, filteredData, filters, setFilters, isLoading, refresh: mutate, listaContas }
}
