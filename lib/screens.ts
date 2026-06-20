/**
 * Lista canônica de telas (slugs) do dashboard — FONTE ÚNICA compartilhada
 * por front (TabNav/DashboardLayout), API (guards) e UI de admin (aba Acesso).
 *
 * ⚠️ Se adicionar/remover um slug aqui, atualize também:
 *   - scripts/migrations/0001_access_control.sql (lista do backfill/seed)
 *   - o mapa TAB_TO_SCREEN abaixo (id da aba na UI ↔ slug)
 *
 * Regra de negócio: a permissão 'acesso' equivale a is_admin (gerenciar
 * usuários). Por isso 'acesso' NÃO aparece nos checkboxes por-tela: quem
 * controla é o toggle is_admin.
 */
export const SCREENS = [
  'visao_geral',
  'dre',
  'centros_custo',
  'comparativo',
  'qualidade_insights',
  'lancamentos',
  'metas',
  'notas_fiscais',
  'acesso',
] as const

export type Screen = (typeof SCREENS)[number]

export const ALL_SCREENS: Screen[] = [...SCREENS]

/** Telas selecionáveis por checkbox (todas menos 'acesso', que é o is_admin). */
export const ASSIGNABLE_SCREENS: Screen[] = ALL_SCREENS.filter(s => s !== 'acesso')

export const SCREEN_LABELS: Record<Screen, string> = {
  visao_geral:        'Visão Geral',
  dre:                'DRE',
  centros_custo:      'Centros de Custo',
  comparativo:        'Comparativo',
  qualidade_insights: 'Qualidade & Insights',
  lancamentos:        'Lançamentos',
  metas:              'Metas',
  notas_fiscais:      'Notas Fiscais',
  acesso:             'Acesso',
}

/** id da aba no TabNav (UI) → slug canônico. */
export const TAB_TO_SCREEN: Record<string, Screen> = {
  visao:       'visao_geral',
  dre:         'dre',
  cc:          'centros_custo',
  comparativo: 'comparativo',
  qualidade:   'qualidade_insights',
  lancamentos: 'lancamentos',
  metas:       'metas',
  notas:       'notas_fiscais',
  acesso:      'acesso',
}

/** slug canônico → id da aba no TabNav (UI). */
export const SCREEN_TO_TAB: Record<Screen, string> = Object.fromEntries(
  Object.entries(TAB_TO_SCREEN).map(([tab, slug]) => [slug, tab]),
) as Record<Screen, string>

export function isValidScreen(s: string): s is Screen {
  return (SCREENS as readonly string[]).includes(s)
}

/** Sanitiza uma lista arbitrária para conter só slugs válidos e únicos. */
export function sanitizeScreens(input: unknown): Screen[] {
  if (!Array.isArray(input)) return []
  const set = new Set<Screen>()
  for (const v of input) {
    if (typeof v === 'string' && isValidScreen(v)) set.add(v)
  }
  return [...set]
}
