import type { Lancamento } from '@/lib/types'

/**
 * Categorias consideradas FOLHA (remuneração/pessoas). O DETALHE por
 * fornecedor/cliente dessas linhas é sensível: para quem não tem
 * `ver_folha_detalhe`, mascaramos fornecedor/descrição (mantendo o valor, para
 * os totais ficarem corretos). Agregados (somas) NÃO são afetados.
 *
 * ⚠️ Lista de prefixos de cat1 — VALIDAR com o Felipe qual conjunto exato conta
 * como "folha detalhada". Espelha os grupos de pessoas usados no DRE.
 */
export const FOLHA_PREFIXES = [
  '3.1',                                  // Mão de obra CSP
  '4.1.01',                               // Remuneração comercial
  '4.2.01', '4.2.02', '4.2.03', '4.2.04', // Remunerações/encargos administrativos
  '4.2.05', '4.2.06', '4.2.07', '4.2.08', '4.2.09',
  '4.2.25', '4.2.26',                     // Pró-labore + INSS s/ pró-labore
]

export function isFolhaCategoria(cat1: string | null | undefined): boolean {
  const c = cat1 || ''
  return FOLHA_PREFIXES.some(p => c.startsWith(p))
}

/**
 * Mascara o DETALHE de uma linha de folha (fornecedor/descrição), preservando
 * valor/categoria/CC/data — usado server-side quando o usuário não pode ver
 * folha detalhada. Não-folha passa intacta.
 */
export function maskFolhaRow(r: Lancamento): Lancamento {
  if (!isFolhaCategoria(r.cat1)) return r
  return { ...r, fornecedor: 'Folha (restrito)', desc: 'Folha (detalhe restrito)' }
}
