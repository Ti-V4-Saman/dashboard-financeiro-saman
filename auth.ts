import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'

// Lista de e-mails autorizados a acessar o dashboard
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean)

// Domínios autorizados — múltiplos separados por vírgula
// Funciona tanto com Google Workspace quanto com Gmail comum
const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAIN || '')
  .split(',')
  .map(d => d.trim().toLowerCase())
  .filter(Boolean)

function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false
  const e = email.toLowerCase()
  if (ALLOWED_DOMAINS.some(d => e.endsWith('@' + d))) return true
  if (ALLOWED_EMAILS.length > 0 && ALLOWED_EMAILS.includes(e)) return true
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
      if (!isAllowed(user.email)) return false
      return true
    },
    async session({ session }) {
      return session
    },
  },
})
