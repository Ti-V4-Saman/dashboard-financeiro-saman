import { Suspense } from 'react'
import { DashboardRoot } from '@/components/dashboard/DashboardRoot'

/**
 * Server component — envolve DashboardRoot em Suspense para satisfazer
 * o requisito do useSearchParams() (Next.js App Router).
 */
export default function Home() {
  return (
    <Suspense fallback={null}>
      <DashboardRoot />
    </Suspense>
  )
}
