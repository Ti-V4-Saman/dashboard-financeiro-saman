'use client'

import { DashboardLayout } from '@/components/dashboard/DashboardLayout'
import { useFinanceiro } from '@/hooks/useFinanceiro'

export default function Home() {
  const fin = useFinanceiro()
  return <DashboardLayout {...fin} />
}
