import NextAuth from 'next-auth'
import authConfig from './auth.config'
import { Pool } from 'pg'

// ── Configuração de Acesso ───────────────────────────────────────────────────
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase()
const MASTER_ADMINS = [ADMIN_EMAIL, 'felipe@v4company.com'].filter(Boolean)

/**
 * Verifica permissão no PostgreSQL para ambiente Node.js.
 */
async function isAllowed(email: string | null | undefined): Promise<boolean> {
  if (!email) return false
  const e = email.toLowerCase()

  // Master Admins (sempre têm acesso para poder gerenciar os outros)
  if (MASTER_ADMINS.includes(e)) return true

  try {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })

    const res = await pool.query(
      'SELECT ativo FROM ca.usuarios_dashboard WHERE LOWER(email) = $1',
      [e]
    )
    await pool.end()

    // Só permite acesso se estiver no banco e ativo
    if (res.rows.length > 0 && res.rows[0].ativo) return true
  } catch (err) {
    console.error('[auth] Erro DB:', err)
  }

  // Se não for admin e não estiver no banco (ativo), é bloqueado.
  return false
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user }) {
      return await isAllowed(user.email)
    },
    async jwt({ token, user }) {
      const email = ((user?.email || token.email) ?? '').toLowerCase()
      token.isAdmin = MASTER_ADMINS.includes(email)
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).isAdmin = !!token.isAdmin
      }
      return session
    },
  },
})
