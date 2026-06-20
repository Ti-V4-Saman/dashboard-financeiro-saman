/**
 * Tipos da tela /bus (controle por Business Unit).
 *
 * Espelha o response de /api/financeiro/bus. Mantém uma estrutura uniforme
 * para todas as 4 BUs — o frontend renderiza diferente conforme a BU
 * (Não Operacional mostra "Resultado Não Operacional", Sem Categoria só
 * conta + total bruto).
 */

export type BU = 'operacao' | 'receita' | 'nao_operacional' | 'sem_categoria'

export interface BuKpis {
  receita_bruta: number       // Σ cat 1.x (cat de receita)
  deducoes: number            // Σ |cat 2.x| (deduções, valor absoluto)
  receita_liquida: number     // receita_bruta − deducoes
  custos: number              // Σ cat 3.x
  margem_bruta: number        // receita_liquida − custos
  despesas_op: number         // Σ cat 4.x
  ebitda: number              // margem_bruta − despesas_op
  margem_ebitda_pct: number   // ebitda / receita_liquida × 100 (0 se RL ≤ 0)

  // Para 'nao_operacional': agregados das categorias 5/6/7
  nao_operacional_total: number   // saldo líquido do bloco (resultado não op)

  // Para 'sem_categoria': só estes campos importam
  qtd_lancamentos: number
  total_bruto: number             // Σ |valor| sem distinção de tipo

  delta_vs_m1: {
    receita_liquida_pct: number | null   // % vs M-1; null se M-1 = 0
    ebitda_pct: number | null
    margem_ebitda_pp: number | null      // diff em pontos percentuais
  }
}

export interface BuEvolucaoPonto {
  mes: string       // YYYY-MM
  receita: number   // receita líquida do mês
  despesa: number   // custos + despesas op (módulo)
  ebitda: number
}

export interface BuTopItem {
  categoria: string
  valor: number
}

export interface BuLancamento {
  id: string                       // `${tipo_origem}:${id_db}` para evitar colisão
  data: string                     // YYYY-MM-DD
  descricao: string
  categoria: string
  centro_custo: string
  contraparte: string
  tipo: 'Receita' | 'Despesa'
  status: string
  valor: number                    // sempre positivo
}

export interface BuData {
  bu: BU
  kpis: BuKpis
  evolucao: BuEvolucaoPonto[]      // 6 meses até mes_referencia inclusive
  top_despesas: BuTopItem[]        // top 5 por categoria
  top_receitas: BuTopItem[]        // top 5 por categoria
  lancamentos_recentes: BuLancamento[]  // 10 mais recentes em [de..ate]
}

export interface BusApiResponse {
  periodo: {
    de: string                     // YYYY-MM-DD (espelho do query param)
    ate: string                    // YYYY-MM-DD
    mes_referencia: string         // YYYY-MM (derivado de `ate`)
  }
  // Operação e Receita sempre vêm (mesmo zeradas, pra fixar as tabs).
  // Não Operacional e Sem Categoria só vêm se qtd_lancamentos > 0.
  bus: BuData[]
}
