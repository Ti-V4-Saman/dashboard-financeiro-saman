'use client'

import { useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { ALL_SCREENS, sanitizeScreens, type Screen } from '@/lib/screens'

/**
 * Permissões de tela do usuário logado, no client.
 *
 * Mesma lógica que o DashboardLayout já fazia inline, extraída para poder ser
 * usada por widgets fundos na árvore sem prop drilling — principalmente para
 * DECIDIR SE UM FETCH DEVE ACONTECER.
 *
 * ⚠️ Isto é UI, não segurança. A autorização real é server-side, nos guards
 * das API routes (lib/access.ts → requireScreen). Este hook só evita disparar
 * requisições que sabidamente voltariam 403 — reduz ruído no console/network
 * e elimina uma classe inteira de bug de "resposta de erro tratada como dado".
 * Se alguém burlar isto no browser, a API continua respondendo 403.
 *
 * `loading` importa: enquanto a sessão não resolveu não dá para afirmar que o
 * usuário NÃO tem uma tela. Quem usa deve segurar o fetch até resolver, em vez
 * de assumir "sem permissão" e renderizar um vazio que depois pisca com dado.
 */
export interface AccessInfo {
  isAdmin: boolean
  allowedScreens: Screen[]
  loading: boolean
  /**
   * Pode ver contraparte/descrição de lançamentos de folha. Admin sempre true.
   * Espelha lib/access.ts. É UI: a proteção real é server-side, nos endpoints.
   */
  verFolhaDetalhe: boolean
  /** true só quando a sessão já resolveu E a tela está liberada. */
  can: (slug: Screen) => boolean
}

export function useAccess(): AccessInfo {
  const { data: session, status } = useSession()

  const isAdmin =
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true' ||
    (session?.user as { isAdmin?: boolean })?.isAdmin === true

  const loading = status === 'loading'

  const allowedScreens = useMemo(
    () =>
      isAdmin
        ? [...ALL_SCREENS]
        : sanitizeScreens((session?.user as { telasPermitidas?: string[] })?.telasPermitidas),
    [isAdmin, session],
  )

  const verFolhaDetalhe =
    isAdmin || (session?.user as { verFolhaDetalhe?: boolean })?.verFolhaDetalhe === true

  return useMemo(
    () => ({
      isAdmin,
      allowedScreens,
      loading,
      verFolhaDetalhe,
      can: (slug: Screen) => !loading && (isAdmin || allowedScreens.includes(slug)),
    }),
    [isAdmin, allowedScreens, loading, verFolhaDetalhe],
  )
}
