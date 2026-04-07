import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { SessionProvider } from '@/components/SessionProvider'

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
  return (
    <html lang="pt-BR">
      <body className={inter.variable}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  )
}
