import { getPool } from '@/lib/db'
import { ALL_SCREENS, sanitizeScreens, type Screen } from '@/lib/screens'

export interface UserAccess {
  email: string | null
  isAdmin: boolean
  telasPermitidas: Screen[]
}

/**
 * Lê is_admin + telas_permitidas DIRETO do banco (estado atual do usuário).
 *
 * Esta é a fonte da verdade de autorização — usada pelo callback `session`
 * (auth.ts) a cada resolução de sessão, garantindo **revogação na hora**:
 * mudou a permissão no banco → vale no próximo request, sem depender de relogin.
 *
 * Fail-closed: qualquer erro/usuário inexistente → sem acesso.
 * Admin enxerga TODAS as telas (bypass).
 */
export async function getUserAccessByEmail(
  email: string | null | undefined,
): Promise<UserAccess> {
  if (!email) return { email: null, isAdmin: false, telasPermitidas: [] }
  const e = email.toLowerCase()
  try {
    const { rows } = await getPool().query(
      'SELECT is_admin, telas_permitidas FROM ca.usuarios_dashboard WHERE LOWER(email) = $1 AND ativo = true',
      [e],
    )
    if (rows.length === 0) return { email: e, isAdmin: false, telasPermitidas: [] }
    const isAdmin = rows[0].is_admin === true
    return {
      email: e,
      isAdmin,
      telasPermitidas: isAdmin ? [...ALL_SCREENS] : sanitizeScreens(rows[0].telas_permitidas),
    }
  } catch (err) {
    console.error('[access] erro ao ler permissões:', err)
    return { email: e, isAdmin: false, telasPermitidas: [] } // fail-closed
  }
}
