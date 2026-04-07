import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { getSheetRows } from '@/lib/gsheetsApi'

// ── Configuração de acesso ────────────────────────────────────────────────────
// Admin fixo — sempre permitido, independente da planilha.
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase()

// Fallback legado (usado apenas quando o Service Account NÃO está configurado).
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAIN || '')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean)

/**
 * Verifica se um e-mail tem permissão de acesso.
 *
 * Prioridade:
 * 1. Admin fixo (ADMIN_EMAIL) → sempre permitido.
 * 2. Se o Service Account estiver configurado → consulta aba USUARIOS da planilha.
 * 3. Fallback: ALLOWED_EMAILS / ALLOWED_DOMAIN do .env (comportamento legado).
 */
async function isAllowed(email: string | null | undefined): Promise<boolean> {
  if (!email) return false
  const e = email.toLowerCase()

  // 1. Admin fixo
  if (ADMIN_EMAIL && e === ADMIN_EMAIL) return true

  // 2. Planilha (quando SA configurado)
  if (process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_KEY && process.env.SHEETS_ID) {
    try {
      const rows = await getSheetRows('USUARIOS')
      // Linha 0 = cabeçalho. Colunas: NOME(0), CPF(1), EMAIL(2), TELEFONE(3), ATIVO(4)
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]
        const rowEmail = (row[2] || '').trim().toLowerCase()
        const rowAtivo = (row[4] || 'FALSE').toUpperCase() === 'TRUE'
        if (rowEmail === e && rowAtivo) return true
      }
      // SA configurado: planilha é autoritativa → não cai no fallback
      return false
    } catch (err) {
      console.error('[auth] Erro ao consultar planilha USUARIOS, usando fallback:', err)
    }
  }

  // 3. Fallback legado
  if (ALLOWED_EMAILS.length > 0) return ALLOWED_EMAILS.includes(e)
  if (ALLOWED_DOMAINS.length > 0) return ALLOWED_DOMAINS.some(d => e.endsWith('@' + d))

  return false
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    async signIn({ user }) {
      return await isAllowed(user.email)
    },

    // Reavalia isAdmin a cada refresh do JWT — funciona mesmo para sessões já existentes
    async jwt({ token, user }) {
      const email = ((user?.email || token.email) ?? '').toLowerCase()
      token.isAdmin = !!ADMIN_EMAIL && email === ADMIN_EMAIL
      return token
    },

    // Expõe isAdmin na session (acessível via useSession no cliente)
    async session({ session, token }) {
      if (session.user) {
        session.user.isAdmin = (token.isAdmin as boolean) ?? false
      }
      return session
    },
  },
})
