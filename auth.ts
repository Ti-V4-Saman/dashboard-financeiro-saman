import NextAuth from 'next-auth'
import authConfig from './auth.config'
import { Pool } from 'pg'

// ── Configuração de Acesso ───────────────────────────────────────────────────
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase()
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAIN || '')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean)

/**
 * Verifica permissão no PostgreSQL para ambiente Node.js.
 */
async function isAllowed(email: string | null | undefined): Promise<boolean> {
  if (!email) return false
  const e = email.toLowerCase()

  if (ADMIN_EMAIL && e === ADMIN_EMAIL) return true

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

    if (res.rows.length > 0 && res.rows[0].ativo) return true
  } catch (err) {
    console.error('[auth] Erro DB:', err)
  }

  if (ALLOWED_EMAILS.includes(e)) return true
  if (ALLOWED_DOMAINS.some(d => e.endsWith('@' + d))) return true

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
      token.isAdmin = !!ADMIN_EMAIL && email === ADMIN_EMAIL
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
