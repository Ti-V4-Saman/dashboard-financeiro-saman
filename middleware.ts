import { auth } from '@/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const isLoggedIn = !!req.auth
  const { pathname } = req.nextUrl

  // Rotas públicas — não precisam de autenticação
  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth')

  if (!isLoggedIn && !isPublic) {
    const loginUrl = new URL('/login', req.nextUrl.origin)
    loginUrl.searchParams.set('callbackUrl', req.nextUrl.href)
    return NextResponse.redirect(loginUrl)
  }

  // Rota da API de dados — bloqueia mesmo com auth desativado no client
  if (pathname.startsWith('/api/financeiro') && !isLoggedIn) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
