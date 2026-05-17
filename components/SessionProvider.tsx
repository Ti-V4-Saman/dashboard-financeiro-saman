'use client'

import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react'
import type { Session } from 'next-auth'

interface Props {
  children: React.ReactNode
  /** Sessão pré-preenchida para dev bypass. Null/undefined = NextAuth gerencia normalmente. */
  session?: Session | null
}

export function SessionProvider({ children, session }: Props) {
  return (
    <NextAuthSessionProvider session={session ?? undefined}>
      {children}
    </NextAuthSessionProvider>
  )
}
