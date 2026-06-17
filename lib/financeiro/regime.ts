import type { Lancamento } from '@/lib/types'

/**
 * Filtro operacional de lançamentos por regime.
 * - Sempre exclui transferências e status Cancelado/Renegociado.
 * - Em CAIXA: inclui Quitado (por data_pagamento) + Aberto/Atrasado (por data_vencimento),
 *   refletindo "o que movimentou ou deveria movimentar no mês".
 *   Parcial fica de fora por ora (split valor_pago vs aberto — backlog).
 * - Em COMPETÊNCIA: inclui tudo exceto Cancelado/Renegociado.
 */
export function filtraOperacional(data: Lancamento[], regime: string): Lancamento[] {
  const isCaixa = regime === 'caixa'
  return data.filter(r => {
    if (r.isTransfer) return false
    if (r.situacao === 'Cancelado' || r.situacao === 'Renegociado') return false
    if (isCaixa && r.situacao === 'Parcial') return false
    return true
  })
}
