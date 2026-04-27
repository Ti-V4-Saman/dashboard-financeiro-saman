import type { NextAuthConfig } from 'next-auth'
import Google from 'next-auth/providers/google'

export default {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const isPublic = nextUrl.pathname.startsWith('/login') || nextUrl.pathname.startsWith('/api/auth')
      
      if (!isPublic && !isLoggedIn) {
        return false
      }
      return true
    },
  },
} satisfies NextAuthConfig
