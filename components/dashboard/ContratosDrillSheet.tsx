'use client'

/**
 * Drawer lateral (Sheet) que abre ao clicar nos numeros "A vencer em 60 dias"
 * e "Vencidos (ativos)" do card Recorrencia-Contratos.
 *
 * Lista apenas o NOME do cliente (conforme decisao do design-critique).
 * Fetch lazy via SWR — so dispara quando `open` vira true.
 *
 * Construido sobre @radix-ui/react-dialog (ja instalado para o Dialog central),
 * com Content posicionado a direita via classes utilitarias.
 */
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import useSWR from 'swr'
import { cn } from '@/lib/utils'

type Filtro = 'vencidos' | 'a-vencer-60d'

interface Contrato {
  id:   string
  nome: string
}

interface ApiResp {
  contratos: Contrato[]
  total:     number
}

interface Props {
  open:     boolean
  onClose:  () => void
  filtro:   Filtro | null
}

const fetcher = async (url: string) => {
  const r = await fetch(url)
  // Sem isso, um 500 (que devolve {error}) viraria `data` em vez de acionar
  // o estado de erro — e `data.contratos.length` quebraria o componente.
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

const TITULO: Record<Filtro, string> = {
  'vencidos':     'Contratos vencidos (ativos)',
  'a-vencer-60d': 'Contratos a vencer em 60 dias',
}

const SUBTITULO: Record<Filtro, string> = {
  'vencidos':
    'Contratos com status ATIVO cuja data fim ja passou. Verifique renovacao ou desativacao.',
  'a-vencer-60d':
    'Contratos com status ATIVO cuja data fim cai nos proximos 60 dias.',
}

export function ContratosDrillSheet({ open, onClose, filtro }: Props) {
  // Fetch lazy: so quando drawer abre e filtro definido
  const apiKey = open && filtro ? `/api/contratos-drill?filtro=${filtro}` : null
  const { data, isLoading, error } = useSWR<ApiResp>(apiKey, fetcher)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogPrimitive.Portal>
        {/* Overlay */}
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm
                     data-[state=open]:animate-in data-[state=closed]:animate-out
                     data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />

        {/* Sheet lateral direita */}
        <DialogPrimitive.Content
          className={cn(
            'fixed right-0 top-0 z-50 h-full w-full max-w-[480px]',
            'bg-[var(--surface)] border-l border-[var(--line)] shadow-xl',
            'flex flex-col',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
            'duration-200',
          )}
        >
          {/* Header */}
          <div
            className="flex items-start justify-between gap-3 px-5 py-4 border-b"
            style={{ borderColor: 'var(--line)' }}
          >
            <div className="min-w-0">
              <DialogPrimitive.Title
                className="text-[14px] font-semibold leading-tight"
                style={{ color: 'var(--ink)' }}
              >
                {filtro ? TITULO[filtro] : '—'}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description
                className="text-[11px] mt-1 leading-snug"
                style={{ color: 'var(--ink3)' }}
              >
                {filtro ? SUBTITULO[filtro] : ''}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              className="shrink-0 rounded p-1 transition-colors hover:bg-[var(--surf2)]"
              aria-label="Fechar"
            >
              <X size={16} style={{ color: 'var(--ink2)' }} />
            </DialogPrimitive.Close>
          </div>

          {/* Resumo: total */}
          <div
            className="px-5 py-2.5 text-[11px] uppercase tracking-wider font-semibold"
            style={{
              color: 'var(--ink3)',
              background: 'var(--surf2)',
              borderBottom: '0.5px solid var(--line)',
            }}
          >
            {isLoading
              ? 'Carregando…'
              : error
                ? 'Erro ao carregar'
                : `${data?.total ?? 0} contrato${(data?.total ?? 0) === 1 ? '' : 's'}`}
          </div>

          {/* Lista de nomes */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="px-5 py-4 space-y-2">
                {[...Array(6)].map((_, i) => (
                  <div
                    key={i}
                    className="h-4 rounded animate-pulse"
                    style={{ background: 'var(--surf2)', opacity: 0.7 }}
                  />
                ))}
              </div>
            ) : error ? (
              <div className="px-5 py-6 text-[12px]" style={{ color: 'var(--red)' }}>
                Falha ao carregar contratos. Tente novamente.
              </div>
            ) : !data || data.contratos.length === 0 ? (
              <div className="px-5 py-6 text-[12px]" style={{ color: 'var(--ink3)' }}>
                Nenhum contrato encontrado.
              </div>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {data.contratos.map((c, i) => (
                  <li
                    key={c.id}
                    className="px-5 py-2.5 text-[12px]"
                    style={{
                      color: 'var(--ink2)',
                      borderBottom:
                        i === data.contratos.length - 1
                          ? 'none'
                          : '0.5px solid var(--line)',
                    }}
                    title={c.nome}
                  >
                    {c.nome}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
