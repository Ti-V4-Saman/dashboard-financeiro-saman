import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import NextAuth from 'next-auth'
import authConfig from './auth.config'

const nextAuthMiddleware = NextAuth(authConfig).auth

/**
 * Bloqueio POR TELA não vive aqui, por dois motivos:
 *   1. O dashboard é um SPA — uma única rota de página (`/`) com as telas como
 *      abas em estado client. Não há "/dre", "/metas" etc. para redirecionar.
 *   2. O middleware roda no edge runtime, onde `pg` não funciona — não dá para
 *      ler telas_permitidas do banco aqui.
 * Por isso a autorização por tela é feita: (a) server-side nos guards das API
 * routes (lib/access.ts → requireScreen — proteção REAL dos dados) e (b) no SPA,
 * escondendo abas + tela de bloqueio (DashboardLayout/BlockScreen).
 * Este middleware permanece como o gate de LOGIN (sessão).
 */
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
