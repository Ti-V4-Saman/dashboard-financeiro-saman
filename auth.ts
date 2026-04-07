import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'

// Lista de e-mails autorizados a acessar o dashboard (separados por vírgula)
// Quando preenchida, SOMENTE esses e-mails têm acesso — domínio é ignorado.
// Exemplo: ALLOWED_EMAILS=felipe@v4company.com,joao@v4company.com
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean)

// Domínios autorizados — usado APENAS quando ALLOWED_EMAILS estiver vazio.
// Se ALLOWED_EMAILS tiver ao menos um e-mail, o domínio é ignorado.
// Exemplo: ALLOWED_DOMAIN=v4company.com,sejapraxis.com.br
const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAIN || '')
  .split(',')
  .map(d => d.trim().toLowerCase())
  .filter(Boolean)

function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false
  const e = email.toLowerCase()

  // Modo restrito: lista de e-mails explícita tem prioridade total
  if (ALLOWED_EMAILS.length > 0) {
    return ALLOWED_EMAILS.includes(e)
  }

  // Modo domínio: qualquer e-mail do(s) domínio(s) autorizado(s)
  if (ALLOWED_DOMAINS.length > 0) {
    return ALLOWED_DOMAINS.some(d => e.endsWith('@' + d))
  }

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
