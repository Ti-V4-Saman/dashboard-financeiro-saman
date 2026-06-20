/**
 * DEV_AUTH_BYPASS — permite pular o Google OAuth em dev local.
 *
 * Ativação: NODE_ENV=development + DEV_AUTH_BYPASS=true no .env.local
 * Segurança: o duplo guard (NODE_ENV + flag) garante que nunca dispara em produção,
 * pois a Vercel sempre define NODE_ENV=production.
 */
import { ALL_SCREENS } from '@/lib/screens'

export function isDevBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV === 'development' &&
    process.env.DEV_AUTH_BYPASS === 'true'
  )
}

export function getDevBypassSession() {
  if (!isDevBypassEnabled()) return null

  return {
    user: {
      email: process.env.DEV_USER_EMAIL || 'dev@local.test',
      name: process.env.DEV_USER_NAME || 'Dev Local',
      image: null,
      isAdmin: true,
      // Dev bypass enxerga todas as telas (espelha isAdmin).
      telasPermitidas: [...ALL_SCREENS],
    },
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }
}
