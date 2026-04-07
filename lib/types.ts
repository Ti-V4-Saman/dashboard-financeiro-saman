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
