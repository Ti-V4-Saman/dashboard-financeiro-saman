export interface Lancamento {
  data: Date | null
  desc: string
  fornecedor: string
  tipo: 'Receita' | 'Despesa'
  origem: string
  conta: string
  forma: string
  valor: number        // sempre positivo (Math.abs)
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
  categoria: string
  cc: string
  tipo: string
  situacao: string
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
