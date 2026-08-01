/**
 * Proteção do detalhe de PAGAMENTO INDIVIDUAL A PESSOA.
 *
 * O QUE PROTEGE
 * Linhas cuja categoria representa pagamento individual carregam, por
 * lançamento, o NOME da pessoa (`fornecedor`) e uma descrição que a identifica
 * ("6/14 - Remuneração de Fulano", "‹nome› 8 reuniões", nome seguido de CPF).
 * Para quem não tem `ver_folha_detalhe`, esses dois campos são substituídos por
 * texto neutro. Nada mais muda: valor, valorDRE, data, categoria, CC, situação,
 * conta e tipo passam intactos, para que os totais continuem conferindo.
 *
 * O CRITÉRIO (decisão do Felipe, 2026-08-01)
 * Não é a classificação contábil de "folha". É a exposição: protege-se o que
 * revela nome de pessoa, CPF/CNPJ associado a pessoa, remuneração individual,
 * comissão individual, prêmio ou bonificação individual, ou informação de
 * desempenho pessoal. Por isso comissão e premiação entraram sem serem folha.
 *
 * O QUE NÃO É CRITÉRIO
 *   • Nome do fornecedor. Não se classifica por quem aparece na linha.
 *   • Busca textual por palavra. `6.2.01 Juros e Encargos s/ Empréstimos`
 *     casaria com "encargos" e é despesa financeira — fica de fora. É o
 *     lembrete permanente de por que a detecção é por PREFIXO de CÓDIGO.
 *   • Compartilhar contraparte com uma linha protegida. A mesma pessoa aparece
 *     legitimamente em reembolso, transporte e CSP; isso não protege a linha.
 *
 * FORA DA PROTEÇÃO, por decisão explícita:
 *   3.1.01..3.1.05  CSP (Gerente/Coordenador/Operação) — custo de serviço
 *     prestado. Só 3.1.06/07/08, os ENCARGOS de folha, entram.
 *   2.3.01  Royalties [BR]
 *   6.2.01  Juros e Encargos s/ Empréstimos
 *   4.2.08  Variável Mão de Obra Administrativa
 *   reembolsos e pagamentos comuns a fornecedores
 */

/**
 * Prefixos de `cat1` protegidos. Allowlist explícita de códigos: a comparação é
 * por prefixo do CÓDIGO da categoria, nunca por palavra no nome — nome é livre
 * e mudaria a proteção sem ninguém perceber.
 *
 * Este é o único ponto a alterar quando uma categoria entra ou sai. Antes de
 * incluir qualquer uma, o critério exige levantar: nome completo da categoria,
 * finalidade contábil, se o lançamento é pagamento individual a pessoa, se
 * fornecedor e descrição identificam colaborador ou sócio, quantidade, valor e
 * exemplos sanitizados.
 */
export const PREFIXOS_FOLHA: readonly string[] = [
  '3.1.06', '3.1.07', '3.1.08',   // Encargos Folha CSP (Saber/Ter/Executar)
  '3.2.03',                        // ISAAS - Encargos sobre Folha
  '4.1.01', '4.1.02',              // Remuneração comercial
  '4.1.04',                        // Comissão/Variável - Time Comercial Aquisição
  '4.1.05',                        // Encargos sobre Folha Comercial
  '4.2.01', '4.2.02', '4.2.03',    // Remunerações administrativas
  '4.2.04', '4.2.05', '4.2.06', '4.2.07',
  '4.2.09',                        // Encargos sobre Folha Administrativa
  '4.2.22',                        // Premiações / Bonificações
  '4.2.25', '4.2.26',              // Pró-Labore (Sócios) + INSS s/ Pró-Labore
] as const

export const CONTRAPARTE_PROTEGIDA = 'Dados protegidos'
export const DESCRICAO_PROTEGIDA = 'Lançamento de folha protegido'

/** A categoria é de folha? Comparação por prefixo de código de `cat1`. */
export function isCategoriaFolha(cat1: string | null | undefined): boolean {
  const c = (cat1 || '').trim()
  if (!c) return false
  return PREFIXOS_FOLHA.some(p => c.startsWith(p))
}

/**
 * Substitui a contraparte por texto neutro. NÃO preserva iniciais nem
 * qualquer fragmento do nome — o objetivo é que nada identifique a pessoa.
 */
export function mascararContraparte(): string {
  return CONTRAPARTE_PROTEGIDA
}

/**
 * Substitui a descrição inteira. Descartar tudo é deliberado: as descrições
 * reais têm a forma "6/14 - Remuneração de Fulano", e qualquer tentativa de
 * preservar "a parte não sensível" acabaria vazando a parcela ou o nome.
 */
export function mascararDescricao(): string {
  return DESCRICAO_PROTEGIDA
}

/**
 * Lançamento protegível — o formato que sai de `normalizeRow` e trafega em
 * `/api/financeiro`. Nomes de campo diferem do detalhe da DRE (`cat1` em vez de
 * `categoria`, `fornecedor` em vez de `contraparte`), por isso a interface
 * separada: converter de um para o outro só para reusar uma função seria mais
 * fácil de errar do que ter as duas.
 */
export interface LancamentoProtegivel {
  cat1: string
  fornecedor: string
  desc: string
}

/**
 * Protege UM lançamento na origem, antes de qualquer serialização.
 *
 * Mascara `fornecedor` E `desc` juntos, sempre. `desc` não pode ficar de fora:
 * em `normalizeRow` ele é `row.desc || row.fornecedor`, ou seja, quando a
 * descrição está vazia o próprio nome ocupa o campo. Mascarar só um dos dois
 * deixaria o nome visível na metade dos casos.
 *
 * Devolve a MESMA referência quando nada muda, para o chamador contar quantas
 * linhas foram efetivamente mascaradas por identidade.
 */
export function protegerLancamentoFolha<T extends LancamentoProtegivel>(
  l: T,
  podeVerFolhaDetalhada: boolean,
): T {
  if (podeVerFolhaDetalhada) return l
  if (!isCategoriaFolha(l.cat1)) return l
  return { ...l, fornecedor: mascararContraparte(), desc: mascararDescricao() }
}

/**
 * Protege a lista inteira e devolve quantas linhas foram mascaradas.
 *
 * Não muta a entrada, não reordena, não descarta nada: quantidade, ordem,
 * valores, datas, categorias, CCs, tipos e situações saem intactos. Só os dois
 * campos de texto das linhas de folha mudam.
 */
export function protegerLancamentos<T extends LancamentoProtegivel>(
  linhas: readonly T[],
  podeVerFolhaDetalhada: boolean,
): { rows: T[]; mascaradas: number } {
  if (podeVerFolhaDetalhada) return { rows: linhas as T[], mascaradas: 0 }
  let mascaradas = 0
  const rows = linhas.map(l => {
    const p = protegerLancamentoFolha(l, podeVerFolhaDetalhada)
    if (p !== l) mascaradas++
    return p
  })
  return { rows, mascaradas }
}

/** Linha de detalhe protegível — o formato que o Sheet da DRE consome. */
export interface LinhaProtegivel {
  categoria: string
  contraparte: string
  desc: string
}

/**
 * Aplica a proteção a UMA linha. Por lançamento, não pelo agrupador clicado:
 * abrir o EBITDA mascara só as linhas de folha e deixa as comuns completas.
 *
 * Devolve a MESMA referência quando nada muda, para o chamador poder detectar
 * alteração por identidade.
 */
export function protegerLinhaFolha<T extends LinhaProtegivel>(
  linha: T,
  podeVerFolhaDetalhada: boolean,
): T {
  if (podeVerFolhaDetalhada) return linha
  if (!isCategoriaFolha(linha.categoria)) return linha
  return { ...linha, contraparte: mascararContraparte(), desc: mascararDescricao() }
}

/**
 * Aplica a proteção a uma lista e informa se ALGUMA linha foi mascarada —
 * é isso que alimenta `dadosProtegidos` no contrato do detalhe.
 *
 * Não muta a entrada. Quantidade, ordem e valores permanecem idênticos.
 */
export function protegerDetalheFolha<T extends LinhaProtegivel>(
  linhas: readonly T[],
  podeVerFolhaDetalhada: boolean,
): { rows: T[]; dadosProtegidos: boolean } {
  let protegido = false
  const rows = linhas.map(l => {
    const p = protegerLinhaFolha(l, podeVerFolhaDetalhada)
    if (p !== l) protegido = true
    return p
  })
  return { rows, dadosProtegidos: protegido }
}
