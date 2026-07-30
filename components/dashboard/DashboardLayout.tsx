'use client'

import { useState, useEffect, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { TopBar } from './TopBar'
import { FilterBar } from './FilterBar'
import { TabNav, TAB_ORDER, type Tab } from './TabNav'
import { VisaoGeral } from './tabs/VisaoGeral'
import { DRE } from './tabs/DRE'
import { CentrosCusto } from './tabs/CentrosCusto'
import { Comparativo } from './tabs/Comparativo'
import { Qualidade } from './tabs/Qualidade'
import { Lancamentos } from './tabs/Lancamentos'
import { MetasTab } from './tabs/Metas'
import { NotasFiscais } from './tabs/NotasFiscais'
import { BUs } from './tabs/BUs'
import { UsuariosTab } from './tabs/Usuarios'
import { BlockScreen } from './BlockScreen'
import { ScreenErrorBoundary } from './ScreenErrorBoundary'
import { ALL_SCREENS, sanitizeScreens, TAB_TO_SCREEN } from '@/lib/screens'
import type { Lancamento, Filters } from '@/lib/types'

interface DashboardLayoutProps {
  allData: Lancamento[]
  filteredData: Lancamento[]
  filters: Filters
  setFilters: (f: Filters) => void
  clearAll: () => void
  isLoading: boolean
  isRefetching: boolean
  refresh: () => void
  listaContas: string[]
}

export function DashboardLayout({
  allData,
  filteredData,
  filters,
  setFilters,
  clearAll,
  isLoading,
  isRefetching,
  refresh,
  listaContas,
}: DashboardLayoutProps) {
  const [activeTab, setActiveTab] = useState<Tab>('visao')
  const { data: session, status } = useSession()
  const isAdmin =
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true' ||
    (session?.user as { isAdmin?: boolean })?.isAdmin === true

  const sessionLoading = status === 'loading'

  // Telas que o usuário pode ver. Admin → todas. Vem DB-fresh via callback session.
  const allowedScreens = useMemo(
    () =>
      isAdmin
        ? [...ALL_SCREENS]
        : sanitizeScreens((session?.user as { telasPermitidas?: string[] })?.telasPermitidas),
    [isAdmin, session],
  )

  const activeSlug = TAB_TO_SCREEN[activeTab]
  const canSeeActive = isAdmin || allowedScreens.includes(activeSlug)

  /**
   * Primeira aba permitida NA ORDEM DO MENU. Usa TAB_ORDER, não a ordem de
   * `allowedScreens` — esta última vem do banco e pode estar em qualquer
   * ordem, o que faria o dash abrir numa aba do meio do menu.
   * 'acesso' fica fora: é gestão de usuários, não um destino de dados.
   */
  const primeiraTabPermitida = useMemo<Tab | null>(() => {
    const t = TAB_ORDER.find(tab => {
      const slug = TAB_TO_SCREEN[tab]
      return slug !== 'acesso' && allowedScreens.includes(slug)
    })
    return t ?? null
  }, [allowedScreens])

  /**
   * Aba inicial segura: nunca inicializar numa tela sem permissão.
   *
   * O estado começa em 'visao' porque a sessão ainda não resolveu no primeiro
   * render — mas o conteúdo só monta depois de `sessionLoading` virar false
   * (o loader cobre esse intervalo), então nenhum fetch de tela proibida
   * chega a disparar. Assim que a sessão resolve, se a aba corrente não for
   * permitida, troca para a primeira do menu que for.
   */
  useEffect(() => {
    if (sessionLoading || isAdmin || canSeeActive) return
    if (primeiraTabPermitida) setActiveTab(primeiraTabPermitida)
  }, [sessionLoading, isAdmin, canSeeActive, primeiraTabPermitida])

  return (
    <div className="min-h-screen" style={{ background: 'var(--page)' }}>
      <TopBar isLoading={isLoading} refresh={refresh} total={allData.length} />
      <FilterBar
        filters={filters}
        setFilters={setFilters}
        clearAll={clearAll}
        allData={allData}
        listaContas={listaContas}
        activeTab={activeTab}
      />
      <TabNav active={activeTab} onChange={setActiveTab} isAdmin={isAdmin} allowedScreens={allowedScreens} />

      <main className="px-6 py-5 w-full">
        {(isLoading || sessionLoading) ? (
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
        ) : !canSeeActive ? (
          <BlockScreen allowedScreens={allowedScreens} onNavigate={(t) => setActiveTab(t as Tab)} />
        ) : (
          // Boundary envolve SÓ o conteúdo da aba. TopBar/FilterBar/TabNav ficam
          // fora: se uma tela quebrar, o usuário ainda consegue navegar para outra.
          <ScreenErrorBoundary
            resetKey={activeTab}
            allowedScreens={allowedScreens}
            onNavigate={(t) => setActiveTab(t as Tab)}
          >
          // Opacity sutil durante refetch server-side (troca de período / regime)
          <div
            className="animate-fadeIn"
            style={{
              opacity:    isRefetching ? 0.55 : 1,
              transition: 'opacity 0.2s ease',
              pointerEvents: isRefetching ? 'none' : 'auto',
            }}
          >
            {/* TODO Fase 2: telas ACOPLADAS (visao/dre/cc/comparativo/lancamentos)
                ainda recebem o array BRUTO via /api/financeiro (prop filteredData/
                allData). Esconder-aba + bloqueio aqui é só UI — o dado bruto ainda
                desce. A proteção server-side real (agregação por permissão) é Fase 2. */}
            {activeTab === 'visao'       && <VisaoGeral data={filteredData} filters={filters} />}
            {activeTab === 'dre'         && <DRE data={filteredData} filters={filters} />}
            {activeTab === 'bus'         && <BUs filters={filters} />}
            {activeTab === 'cc'          && <CentrosCusto data={filteredData} filters={filters} />}
            {activeTab === 'comparativo' && <Comparativo data={filteredData} allData={allData} filters={filters} />}
            {activeTab === 'qualidade'   && <Qualidade data={filteredData} />}
            {activeTab === 'lancamentos' && <Lancamentos data={filteredData} />}
            {activeTab === 'metas'       && <MetasTab allData={allData} filters={filters} isAdmin={isAdmin} />}
            {activeTab === 'notas'       && <NotasFiscais filters={filters} />}
            {activeTab === 'acesso'      && isAdmin && <UsuariosTab />}
            </div>
          </ScreenErrorBoundary>
        )}
      </main>
    </div>
  )
}
