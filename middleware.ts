import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import NextAuth from 'next-auth'
import authConfig from './auth.config'

const nextAuthMiddleware = NextAuth(authConfig).auth

export default function middleware(request: NextRequest) {
  // DEV_AUTH_BYPASS: duplo guard — só funciona em development + flag explícita.
  // Em produção, NODE_ENV=production (Vercel) e este bloco NUNCA executa.
  if (
    process.env.NODE_ENV === 'development' &&
    process.env.DEV_AUTH_BYPASS === 'true'
  ) {
    return NextResponse.next()
  }

  // Fluxo normal: NextAuth verifica sessão e redireciona para /login se necessário.
  return (nextAuthMiddleware as any)(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
