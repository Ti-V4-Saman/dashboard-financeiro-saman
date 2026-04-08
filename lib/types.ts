/**
 * REGRAS OFICIAIS — competência e valor
 *
 * data  → Quitado/Pago  : "Data da baixa"      (col Q)
 *         Demais         : "Data de vencimento" (col A)
 *         fallback        : "Data da baixa ou previsão"
 *
 * valor → campo padrão para TODOS os cards, gráficos e totais
 *         col 44 "Valor" — valor face do lançamento
 *         Sempre excluir isTransfer=true
 *
 * valorDRE → auxiliar, col 51 "Valor baixado/previsto"
 *            NÃO usar para totais gerais (diverge ~R$6k em meses parciais)
 */
export interface Lancamento {
  data: Date | null
  desc: string
  fornecedor: string
  tipo: 'Receita' | 'Despesa'
  origem: string
  conta: string
  forma: string
  valor: number     // ← padrão para todos os totais — col 44 "Valor"
  valorDRE: number  // auxiliar — col 51 "Valor baixado/previsto"
  situacao: string
  isTransfer: boolean
  cat1: string
  catSup: string
  catSup1: string
  cc1: string
  categorias: { nome: string; valor: number }[]
  _ccList: { nome: string; valor: number }[]
}

export interface Filters {
  dateFrom: string
  dateTo: string
  categoria: string[]  // multi-select — lista de categorias selecionadas (vazia = todas)
  cc: string[]         // multi-select — centros de custo selecionados   (vazia = todos)
  tipo: string         // single: '' | 'Receita' | 'Despesa'
  situacao: string[]   // multi-select — situações selecionadas          (vazia = todas)
  conta: string[]      // multi-select — contas financeiras selecionadas (vazia = todas) — NOVO
}

export interface Meta {
  id: string
  tipo: 'categoria' | 'centro_de_custo'
  categoria: string          // backward compat (old sheets without nivel cols)
  categoria_nivel_1: string  // L1 hierarchy (e.g. "1. Receita Bruta")
  categoria_nivel_2: string  // L2 hierarchy
  categoria_nivel_3: string  // L3 hierarchy (matches cat1 in lancamentos)
  centro_de_custo: string
  mes_referencia: string // YYYY-MM
  valor_planejado: number
  tipo_lancamento: 'Despesa' | 'Receita'
  observacao: string
  criado_em: string // ISO timestamp
}

export interface KpiData {
  receita: number
  despesa: number
  resultado: number
  margem: number
  total: number
  atrasados: number
  semCat: number
  semCC: number
}
