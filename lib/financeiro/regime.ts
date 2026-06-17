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

export interface DRELinhaRow {
  data: Date | null
  desc: string
  contraparte: string              // r.fornecedor
  cc: string                       // r._ccList?.[0]?.nome ?? 'Sem CC'
  categoria: string                // r.cat1
  tipo: 'Receita' | 'Despesa'
  valor: number                    // ASSINADO: +Receita, −Despesa (espelha a DRE)
}

/**
 * Retorna lançamentos detalhados para uma linha da DRE.
 * - data: filteredData do dash (já com filtros aplicados)
 * - regime: 'caixa' | 'competencia' (mesma filtraOperacional do dash)
 * - matcher: função composta no caller que decide se um lançamento entra na linha
 * - mes: opcional, formato YYYY-MM. Se passado, filtra `data_ym === mes`
 */
export function detalheDRE(
  data: Lancamento[],
  regime: string,
  matcher: (r: Lancamento) => boolean,
  mes?: string,
): DRELinhaRow[] {
  return filtraOperacional(data, regime)
    .filter(matcher)
    .filter(r => !mes || r.data_ym === mes)
    .map(r => ({
      data: r.data,
      desc: r.desc,
      contraparte: r.fornecedor,
      cc: r._ccList?.[0]?.nome || 'Sem CC',
      categoria: r.cat1,
      tipo: r.tipo,
      // IMPORTANTE: usa r.valorDRE (col 51) deliberadamente — espelha o cálculo da célula
      // da DRE em DRE.tsx:201, que hoje usa o mesmo campo. Mantém a regra de consistência
      // "rodapé do modal == valor da célula" funcionando em meses com Parcial.
      // TODO Gap 1 (docs/decisoes-financeiras.md): quando DRE.tsx migrar para r.valor,
      // trocar AQUI no mesmo PR — não antes, não depois. Os dois lugares devem mudar juntos.
      valor: r.tipo === 'Receita' ? r.valorDRE : -r.valorDRE,
    }))
    .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor))
}
