import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      isAdmin?: boolean
      /** Slugs de tela permitidos (lib/screens.ts). Admin recebe todas. */
      telasPermitidas?: string[]
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    isAdmin?: boolean
    /** Epoch (segundos) do login — base do time-box absoluto de 72h. */
    loginAt?: number
  }
}
