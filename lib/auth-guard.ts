import { auth } from '@/auth'

/**
 * Retorna true somente para usuários master admin (token.isAdmin === true,
 * definido no callback `jwt` em auth.ts a partir de MASTER_ADMINS).
 *
 * Use em rotas de API que fazem escrita sensível (gestão de usuários, metas)
 * — o middleware global só garante que o usuário está logado, não que é admin.
 */
export async function isAdmin(): Promise<boolean> {
  const session = await auth()
  return (session?.user as { isAdmin?: boolean })?.isAdmin === true
}

/**
 * Helper para rotas: retorna uma Response 403 quando o usuário não é admin,
 * ou null quando a requisição pode prosseguir.
 *
 *   const denied = await requireAdmin()
 *   if (denied) return denied
 */
import { NextResponse } from 'next/server'
export async function requireAdmin(): Promise<NextResponse | null> {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }
  return null
}
