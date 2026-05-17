'use client'

import { DashboardLayout } from './DashboardLayout'
import { useFinanceiro } from '@/hooks/useFinanceiro'

/**
 * Thin client wrapper — isolated here so that app/page.tsx pode ser
 * um server component e envolver este componente em <Suspense>,
 * satisfazendo o requisito do useSearchParams() dentro do useFinanceiro hook.
 */
export function DashboardRoot() {
  const fin = useFinanceiro()
  return <DashboardLayout {...fin} />
}
