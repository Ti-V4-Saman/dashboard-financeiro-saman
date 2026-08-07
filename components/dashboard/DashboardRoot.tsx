'use client'

import { useState } from 'react'
import { DashboardLayout } from './DashboardLayout'
import { useFinanceiro } from '@/hooks/useFinanceiro'
import type { Tab } from './TabNav'

/**
 * Thin client wrapper — isolated here so that app/page.tsx pode ser
 * um server component e envolver este componente em <Suspense>,
 * satisfazendo o requisito do useSearchParams() dentro do useFinanceiro hook.
 *
 * `activeTab` mora AQUI, e não no DashboardLayout, por um motivo só: o
 * useFinanceiro precisa saber se alguém ainda consome o array bruto para
 * decidir se busca /api/financeiro. Com AGG_BACKEND ON, Qualidade é o único
 * consumidor — ela faz conferência linha a linha (sem categoria, sem CC,
 * atrasados) e não tem endpoint agregado. Fora dela, a chave do SWR vira null.
 *
 * Toda a lógica de qual aba pode abrir continua no DashboardLayout; aqui está
 * só o estado, elevado o mínimo necessário.
 */
export function DashboardRoot() {
  const [activeTab, setActiveTab] = useState<Tab>('visao')
  const fin = useFinanceiro(activeTab === 'qualidade')
  return <DashboardLayout {...fin} activeTab={activeTab} setActiveTab={setActiveTab} />
}
