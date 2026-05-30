import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      isAdmin?: boolean
      /** Slugs de tela permitidos (lib/screens.ts). Admin recebe todas. */
      telasPermitidas?: string[]
      /** Pode ver detalhe (fornecedor/desc) de linhas de folha. Admin sempre true. */
      verFolhaDetalhe?: boolean
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
