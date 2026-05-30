import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { auth } from '@/auth'
import { isDevBypassEnabled } from '@/lib/auth-dev-bypass'
import { ALL_SCREENS, sanitizeScreens, type Screen } from '@/lib/screens'

export interface UserAccess {
  email: string | null
  isAdmin: boolean
  telasPermitidas: Screen[]
  /** Pode ver o detalhe (fornecedor/cliente) das linhas de folha. Admin sempre true. */
  verFolhaDetalhe: boolean
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
  if (!email) return { email: null, isAdmin: false, telasPermitidas: [], verFolhaDetalhe: false }
  const e = email.toLowerCase()
  try {
    const { rows } = await getPool().query(
      'SELECT is_admin, telas_permitidas, ver_folha_detalhe FROM ca.usuarios_dashboard WHERE LOWER(email) = $1 AND ativo = true',
      [e],
    )
    if (rows.length === 0) return { email: e, isAdmin: false, telasPermitidas: [], verFolhaDetalhe: false }
    const isAdmin = rows[0].is_admin === true
    return {
      email: e,
      isAdmin,
      telasPermitidas: isAdmin ? [...ALL_SCREENS] : sanitizeScreens(rows[0].telas_permitidas),
      verFolhaDetalhe: isAdmin || rows[0].ver_folha_detalhe === true,
    }
  } catch (err) {
    console.error('[access] erro ao ler permissões:', err)
    return { email: e, isAdmin: false, telasPermitidas: [], verFolhaDetalhe: false } // fail-closed
  }
}

/**
 * Acesso do usuário do REQUEST atual. Resolve a sessão (que já foi populada
 * pelo callback `session` com estado fresco do banco → revogação na hora).
 * Em dev bypass, libera tudo.
 */
export async function getUserAccess(): Promise<UserAccess> {
  if (isDevBypassEnabled()) {
    return {
      email: process.env.DEV_USER_EMAIL || 'dev@local.test',
      isAdmin: true,
      telasPermitidas: [...ALL_SCREENS],
      verFolhaDetalhe: true,
    }
  }
  const session = await auth()
  const u = session?.user
  if (!u?.email) return { email: null, isAdmin: false, telasPermitidas: [], verFolhaDetalhe: false }
  const isAdmin = u.isAdmin === true
  return {
    email: u.email,
    isAdmin,
    telasPermitidas: isAdmin ? [...ALL_SCREENS] : sanitizeScreens(u.telasPermitidas),
    verFolhaDetalhe: isAdmin || (u as { verFolhaDetalhe?: boolean }).verFolhaDetalhe === true,
  }
}

/** O usuário do request atual pode ver o detalhe (fornecedor/desc) das linhas de folha? */
export async function canSeeFolhaDetalhe(): Promise<boolean> {
  return (await getUserAccess()).verFolhaDetalhe
}

/**
 * Guard de rota: retorna uma Response 403 quando o usuário não pode ver a tela,
 * ou `null` quando está liberado (admin OU slug em telas_permitidas).
 *
 *   const denied = await requireScreen('notas_fiscais')
 *   if (denied) return denied
 */
export async function requireScreen(slug: Screen): Promise<NextResponse | null> {
  const access = await getUserAccess()
  if (access.isAdmin) return null
  if (access.telasPermitidas.includes(slug)) return null
  return NextResponse.json(
    { error: 'Sem permissão para acessar esta tela.' },
    { status: 403 },
  )
}

