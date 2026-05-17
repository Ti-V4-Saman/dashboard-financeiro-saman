import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { SessionProvider } from '@/components/SessionProvider'
import { getDevBypassSession } from '@/lib/auth-dev-bypass'
import type { Session } from 'next-auth'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'V4 Saman & Co — Dashboard Financeiro',
  description: 'Dashboard financeiro V4 Saman & Co',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Em dev local com DEV_AUTH_BYPASS=true, injeta sessão fake para que
  // useSession() nos componentes já retorne o usuário sem Google OAuth.
  const devSession = getDevBypassSession() as Session | null

  return (
    <html lang="pt-BR">
      <body className={inter.variable}>
        <SessionProvider session={devSession}>{children}</SessionProvider>
      </body>
    </html>
  )
}
