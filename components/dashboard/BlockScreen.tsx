'use client'

import { Lock } from 'lucide-react'
import { SCREEN_LABELS, SCREEN_TO_TAB, type Screen } from '@/lib/screens'

/**
 * Tela de bloqueio — exibida quando o usuário tenta abrir uma aba para a qual
 * NÃO tem permissão (slug fora de telas_permitidas e não-admin).
 *
 * Nota de arquitetura: o dashboard é um SPA (uma rota `/` com abas em estado
 * client), então não há "rota de página por tela" para o middleware redirecionar.
 * O bloqueio acontece aqui, no SPA; a proteção REAL dos dados é server-side,
 * nos guards das API routes (lib/access.ts → requireScreen).
 */
export function BlockScreen({
  allowedScreens,
  onNavigate,
}: {
  allowedScreens: Screen[]
  /** recebe o id de aba (TabNav) correspondente ao slug clicado. */
  onNavigate: (tabId: string) => void
}) {
  // 'acesso' não é um destino navegável aqui (é gestão de usuários/admin).
  const destinos = allowedScreens.filter(s => s !== 'acesso')

  return (
    <div className="flex flex-col items-center justify-center text-center" style={{ padding: '64px 24px' }}>
      <div
        style={{
          width: 56, height: 56, borderRadius: 14,
          background: 'var(--red-l, #fef2f2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 18,
        }}
      >
        <Lock size={26} style={{ color: 'var(--red)' }} />
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>
        Você não tem acesso a esta tela
      </h2>
      <p style={{ fontSize: 12.5, color: 'var(--ink3)', maxWidth: 420, lineHeight: 1.6, marginBottom: 24 }}>
        Seu usuário não está autorizado a visualizar esta seção. Se precisar de
        acesso, solicite a um administrador na aba <strong>Acesso</strong>.
      </p>

      {destinos.length > 0 ? (
        <div className="w-full" style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
            Telas que você pode acessar
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {destinos.map(slug => (
              <button
                key={slug}
                onClick={() => onNavigate(SCREEN_TO_TAB[slug])}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--line2)',
                  borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 600,
                  color: 'var(--ink2)', cursor: 'pointer',
                }}
              >
                {SCREEN_LABELS[slug]}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--ink3)' }}>
          Você ainda não tem nenhuma tela liberada. Contate um administrador.
        </p>
      )}
    </div>
  )
}
