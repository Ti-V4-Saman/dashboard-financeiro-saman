/**
 * Tipos da tela /bus (controle por Business Unit).
 *
 * Espelha o response de /api/financeiro/bus. Mantém uma estrutura uniforme
 * para todas as 4 BUs — o frontend renderiza diferente conforme a BU
 * (Não Operacional mostra "Resultado Não Operacional", Sem Categoria só
 * conta + total bruto).
 */

export type BU = 'operacao' | 'receita' | 'nao_operacional' | 'sem_categoria'

/** Chaves dos KPIs clicáveis. Contrato API↔UI por causa de `link_target`. */
export type KpiKey = 'receita_liquida' | 'custos' | 'margem_bruta' | 'despesas_op' | 'ebitda' | 'nao_op'

export interface BuKpis {
  receita_bruta: number       // Σ cat 1.x da BU
  deducoes: number            // RATEADO (desde 0005): total_deducoes × proporcao desta BU
  proporcao: number           // 0..1; participação desta BU na receita bruta op+receita
  receita_liquida: number     // receita_bruta − deducoes (rateado)
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
  id: string                       // `${tipo_origem}:${id_db}` ou `sintetica:<key>`
  data: string                     // YYYY-MM-DD; '' quando sintética
  descricao: string
  categoria: string
  categoria_l1: number             // 1..7; 999 se sem categoria
  centro_custo: string
  contraparte: string
  tipo: 'Receita' | 'Despesa'
  status: string
  valor: number                    // sempre positivo (sinal é dado pelo `tipo`)
  /** Marcador de linha sintética (não é um lançamento físico). Hoje usado
   *  pelo rateio de deduções na BU Receita: a linha representa a parcela
   *  rateada cujos lançamentos físicos vivem em outra BU. */
  _sintetica?: boolean
  /** Destino de navegação ao clicar na sintética. Frontend troca de sub-tab
   *  e seleciona o KPI indicado. */
  link_target?: { bu: BU; kpi: KpiKey }
}

export interface BuData {
  bu: BU
  kpis: BuKpis
  evolucao: BuEvolucaoPonto[]      // 6 meses até mes_referencia inclusive
  top_despesas: BuTopItem[]        // top 5 por categoria
  top_receitas: BuTopItem[]        // top 5 por categoria
  // Todos os lançamentos da BU no período [de..ate], ordenados por data desc.
  // Frontend slice(0, 10) para a visão padrão. Drill-down de KPI filtra esta
  // lista por categoria_l1 em memória — sem round-trip ao backend.
  lancamentos: BuLancamento[]
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
