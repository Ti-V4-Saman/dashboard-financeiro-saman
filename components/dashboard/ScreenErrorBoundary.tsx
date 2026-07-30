'use client'

import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { SCREEN_LABELS, SCREEN_TO_TAB, type Screen } from '@/lib/screens'

/**
 * Error Boundary do conteúdo do dashboard.
 *
 * Por que existe: o dash é um SPA de uma rota só. Sem boundary, QUALQUER
 * exceção de render em QUALQUER aba derruba a árvore React inteira e o
 * usuário vê tela branca — sem TopBar, sem TabNav, sem saída. Foi exatamente
 * o que aconteceu com um usuário sem a tela 'metas': o widget de resumo
 * recebia o corpo do 403 e chamava `.filter()` nele.
 *
 * Onde fica: envolvendo SÓ o <main> do DashboardLayout. O shell (TopBar,
 * FilterBar, TabNav) fica FORA de propósito — se uma aba quebrar, o usuário
 * continua conseguindo navegar para outra.
 *
 * Reset: o boundary recebe `resetKey={activeTab}`. Trocar de aba zera o
 * estado de erro; sem isso, uma vez quebrado ele permaneceria quebrado para
 * sempre, mesmo navegando para uma aba sã.
 *
 * Isto é rede de segurança, não conserto. A causa raiz (fetch que não trata
 * 403) é tratada em lib/fetchJson.ts.
 */

interface Props {
  children: ReactNode
  /** Muda → o boundary se recupera. Passar a aba ativa. */
  resetKey: string
  /** Telas liberadas, para oferecer saída ao usuário. */
  allowedScreens: Screen[]
  /** Navega para o id de aba do TabNav. */
  onNavigate: (tabId: string) => void
}

interface State {
  error: Error | null
  lastResetKey: string
}

export class ScreenErrorBoundary extends Component<Props, State> {
  state: State = { error: null, lastResetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  /**
   * Zera o erro quando a aba muda. Feito em getDerivedStateFromProps (e não
   * em componentDidUpdate) para o render seguinte já sair limpo, sem frame
   * intermediário mostrando o fallback na aba nova.
   */
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.lastResetKey) {
      return { error: null, lastResetKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Sem serviço de telemetria no projeto hoje; console é o que temos.
    // Mantém a stack no navegador para diagnóstico, sem quebrar a UI.
    console.error('[dashboard] erro de render capturado pelo boundary:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    const destinos = this.props.allowedScreens.filter(s => s !== 'acesso')

    return (
      <div className="flex flex-col items-center justify-center text-center" style={{ padding: '64px 24px' }}>
        <div
          style={{
            width: 56, height: 56, borderRadius: 14,
            background: 'var(--amber-l)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 18,
          }}
        >
          <AlertTriangle size={26} style={{ color: 'var(--amber)' }} />
        </div>

        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>
          Não foi possível carregar esta área
        </h2>
        <p style={{ fontSize: 12.5, color: 'var(--ink3)', maxWidth: 460, lineHeight: 1.6, marginBottom: 24 }}>
          Algo deu errado ao montar esta tela. As demais continuam funcionando —
          escolha outra abaixo ou recarregue a página.
        </p>

        {destinos.length > 0 && (
          <div className="w-full" style={{ maxWidth: 460 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              Telas que você pode acessar
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {destinos.map(slug => (
                <button
                  key={slug}
                  onClick={() => this.props.onNavigate(SCREEN_TO_TAB[slug])}
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
        )}

        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 22, background: 'none', border: 'none',
            color: 'var(--brand)', fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          Recarregar a página
        </button>
      </div>
    )
  }
}
