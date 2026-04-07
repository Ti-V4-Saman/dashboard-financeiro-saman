'use client'

import { useState } from 'react'
import { TopBar } from './TopBar'
import { FilterBar } from './FilterBar'
import { TabNav, type Tab } from './TabNav'
import { VisaoGeral } from './tabs/VisaoGeral'
import { DRE } from './tabs/DRE'
import { CentrosCusto } from './tabs/CentrosCusto'
import { Comparativo } from './tabs/Comparativo'
import { Qualidade } from './tabs/Qualidade'
import { Lancamentos } from './tabs/Lancamentos'
import { MetasTab } from './tabs/Metas'
import type { Lancamento, Filters } from '@/lib/types'

interface DashboardLayoutProps {
  allData: Lancamento[]
  filteredData: Lancamento[]
  filters: Filters
  setFilters: (f: Filters) => void
  isLoading: boolean
  refresh: () => void
}

export function DashboardLayout({
  allData,
  filteredData,
  filters,
  setFilters,
  isLoading,
  refresh,
}: DashboardLayoutProps) {
  const [activeTab, setActiveTab] = useState<Tab>('visao')

  return (
    <div className="min-h-screen" style={{ background: 'var(--page)' }}>
      <TopBar isLoading={isLoading} refresh={refresh} total={allData.length} />
      <FilterBar filters={filters} setFilters={setFilters} allData={allData} />
      <TabNav active={activeTab} onChange={setActiveTab} />

      <main className="px-6 py-5 w-full">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div
              className="w-40 h-0.5 rounded overflow-hidden"
              style={{ background: 'var(--line)' }}
            >
              <div
                className="h-full rounded"
                style={{
                  background: 'var(--brand)',
                  animation: 'ldp 1.4s ease-in-out infinite',
                }}
              />
            </div>
            <p className="text-[11px]" style={{ color: 'var(--ink3)' }}>
              Carregando dados...
            </p>
            <style>{`
              @keyframes ldp {
                0% { width: 0%; margin-left: 0 }
                50% { width: 60%; margin-left: 20% }
                100% { width: 0%; margin-left: 100% }
              }
            `}</style>
          </div>
        ) : (
          <div className="animate-fadeIn">
            {activeTab === 'visao' && <VisaoGeral data={filteredData} />}
            {activeTab === 'dre' && <DRE data={filteredData} />}
            {activeTab === 'cc' && <CentrosCusto data={filteredData} />}
            {activeTab === 'comparativo' && <Comparativo data={filteredData} allData={allData} />}
            {activeTab === 'qualidade' && <Qualidade data={filteredData} />}
            {activeTab === 'lancamentos' && <Lancamentos data={filteredData} />}
            {activeTab === 'metas' && <MetasTab allData={allData} filters={filters} />}
          </div>
        )}
      </main>
    </div>
  )
}
