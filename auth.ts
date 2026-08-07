import NextAuth from 'next-auth'
import authConfig from './auth.config'
import { getPool } from '@/lib/db'
import { getUserAccessByEmail } from '@/lib/access'

/**
 * Time-box ABSOLUTO da sessão: 72h. O refresh NÃO estende além disso —
 * 72h após o login o usuário precisa autenticar de novo, independente de atividade.
 */
export const SESSION_MAX_AGE = 60 * 60 * 72 // 72h em segundos

/**
 * Allowlist (gate de login): o usuário precisa existir e estar ativo no banco.
 * Admin NÃO é mais hardcoded — vem de is_admin em ca.usuarios_dashboard
 * (ver lib/access.ts). Os admins atuais foram migrados via migration 0001.
 */
async function isAllowed(email: string | null | undefined): Promise<boolean> {
  if (!email) return false
  const e = email.toLowerCase()
  try {
    const res = await getPool().query(
      'SELECT ativo FROM ca.usuarios_dashboard WHERE LOWER(email) = $1',
      [e],
    )
    if (res.rows.length > 0 && res.rows[0].ativo) return true
  } catch (err) {
    console.error('[auth] Erro DB:', err)
  }
  // Não cadastrado / inativo / erro de DB → bloqueado (fail-closed).
  return false
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  // Time-box absoluto: updateAge === maxAge evita rolling (não estende antes de expirar).
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE, updateAge: SESSION_MAX_AGE },
  jwt: { maxAge: SESSION_MAX_AGE },
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user }) {
      return await isAllowed(user.email)
    },
    async jwt({ token, user }) {
      // Carimba o instante do login na primeira emissão do token.
      if (user) {
        token.loginAt = Math.floor(Date.now() / 1000)
      }
      // Time-box absoluto: invalida 72h após o login, mesmo com atividade contínua.
      if (
        typeof token.loginAt === 'number' &&
        Math.floor(Date.now() / 1000) - token.loginAt > SESSION_MAX_AGE
      ) {
        return null
      }
      return token
    },
    async session({ session }) {
      // REVOGAÇÃO NA HORA: lê o estado ATUAL do banco a cada resolução de sessão,
      // não confia em valor congelado no JWT. Mudou is_admin/telas no banco →
      // vale já no próximo request (mesmo caminho de DB da allowlist).
      if (session.user?.email) {
        const access = await getUserAccessByEmail(session.user.email)
        session.user.isAdmin = access.isAdmin
        session.user.telasPermitidas = access.telasPermitidas
        session.user.verFolhaDetalhe = access.verFolhaDetalhe
      }
      return session
    },
  },
})
