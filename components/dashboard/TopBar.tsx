'use client'

import { RefreshCw, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { signOut, useSession } from 'next-auth/react'

interface TopBarProps {
  isLoading: boolean
  refresh: () => void
  total: number
}

export function TopBar({ isLoading, refresh, total }: TopBarProps) {
  const [refreshing, setRefreshing] = useState(false)
  const { data: session } = useSession()

  const handleRefresh = async () => {
    setRefreshing(true)
    await refresh()
    setTimeout(() => setRefreshing(false), 700)
  }

  return (
    <div
      style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--line)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
      className="flex items-center justify-between px-6 h-[50px] gap-4"
    >
      {/* Left */}
      <div className="flex items-center gap-4 min-w-0">
        <span className="font-bold text-[15px] tracking-tight" style={{ color: 'var(--brand)' }}>
          V4 Saman &amp; Co
        </span>
        <div className="w-px h-[18px]" style={{ background: 'var(--line2)' }} />
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ink3)' }}>
          <span
            className="w-[6px] h-[6px] rounded-full flex-shrink-0 pulse-dot"
            style={{ background: 'var(--green)' }}
          />
          <span>
            {isLoading ? 'Carregando...' : `${total.toLocaleString('pt-BR')} lançamentos`}
          </span>
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {session?.user && (
          <div className="flex items-center gap-2">
            {session.user.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt={session.user.name || ''}
                className="w-6 h-6 rounded-full"
              />
            )}
            <span className="text-[11px] hidden sm:block" style={{ color: 'var(--ink3)' }}>
              {session.user.name || session.user.email}
            </span>
          </div>
        )}
        <div className="w-px h-[16px]" style={{ background: 'var(--line2)' }} />
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isLoading || refreshing}
          className="gap-1.5"
        >
          <RefreshCw
            className={`h-3 w-3 ${refreshing || isLoading ? 'animate-spin-fast' : ''}`}
          />
          Atualizar
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="gap-1.5"
          title="Sair"
        >
          <LogOut className="h-3 w-3" />
          <span className="hidden sm:inline">Sair</span>
        </Button>
      </div>
    </div>
  )
}
