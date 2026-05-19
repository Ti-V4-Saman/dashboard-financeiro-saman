/**
 * Árvore estática de categorias do DRE + linhas não-DRE e KPIs.
 * Usada como base do tab "Metas vs Realizado" para que todas as linhas
 * apareçam mesmo sem dados reais ou metas cadastradas.
 *
 * fullName deve corresponder EXATAMENTE ao campo cat1 dos lançamentos
 * (conforme cadastro na ContaAzul).
 */

export interface CatLeaf {
  fullName: string
  tipo: 'Receita' | 'Despesa'
  isNonDre?: boolean
  isKpi?: boolean
}

// ─── 1. Receitas Operacionais ──────────────────────────────────────────────────

export const DRE_LEAVES: CatLeaf[] = [
  // 1.1 Aquisição
  { fullName: '1.1.01 Aquisição | [Saber] BR',        tipo: 'Receita' },
  { fullName: '1.1.02 Aquisição | [Ter] BR',           tipo: 'Receita' },
  { fullName: '1.1.03 Aquisição | [Executar] BR',      tipo: 'Receita' },
  { fullName: '1.1.04 Aquisição | [Potencializar] BR', tipo: 'Receita' },
  { fullName: '1.1.05 Aquisição | [Saber] USA',        tipo: 'Receita' },
  { fullName: '1.1.06 Aquisição | [Ter] USA',          tipo: 'Receita' },
  { fullName: '1.1.07 Aquisição | [Executar] USA',     tipo: 'Receita' },
  { fullName: '1.1.08 Aquisição | [Potencializar] USA',tipo: 'Receita' },

  // 1.2 Renovação
  { fullName: '1.2.01 Renovação | [Saber] BR',        tipo: 'Receita' },
  { fullName: '1.2.02 Renovação | [Ter] BR',           tipo: 'Receita' },
  { fullName: '1.2.03 Renovação | [Executar] BR',      tipo: 'Receita' },
  { fullName: '1.2.04 Renovação | [Potencializar] BR', tipo: 'Receita' },
  { fullName: '1.2.05 Renovação | [Saber] USA',        tipo: 'Receita' },
  { fullName: '1.2.06 Renovação | [Ter] USA',          tipo: 'Receita' },
  { fullName: '1.2.07 Renovação | [Executar] USA',     tipo: 'Receita' },
  { fullName: '1.2.08 Renovação | [Potencializar] USA',tipo: 'Receita' },

  // 1.3 Expansão
  { fullName: '1.3.01 Expansão | [Saber] BR',        tipo: 'Receita' },
  { fullName: '1.3.02 Expansão | [Ter] BR',           tipo: 'Receita' },
  { fullName: '1.3.03 Expansão | [Executar] BR',      tipo: 'Receita' },
  { fullName: '1.3.04 Expansão | [Potencializar] BR', tipo: 'Receita' },
  { fullName: '1.3.05 Expansão | [Saber] USA',        tipo: 'Receita' },
  { fullName: '1.3.06 Expansão | [Ter] USA',          tipo: 'Receita' },
  { fullName: '1.3.07 Expansão | [Executar] USA',     tipo: 'Receita' },
  { fullName: '1.3.08 Expansão | [Potencializar] USA',tipo: 'Receita' },

  // 1.4 Variáveis
  { fullName: '1.4.01 Comissão de Cliente (BV / Variável)', tipo: 'Receita' },
  { fullName: '1.4.02 Comissão Stack Digital',              tipo: 'Receita' },

  // ─── 2. Deduções ─────────────────────────────────────────────────────────────

  // 2.1 Impostos
  { fullName: '2.1.01 PIS',                                         tipo: 'Despesa' },
  { fullName: '2.1.02 COFINS',                                      tipo: 'Despesa' },
  { fullName: '2.1.03 ISS',                                         tipo: 'Despesa' },
  { fullName: '2.1.04 CBS',                                         tipo: 'Despesa' },
  { fullName: '2.1.05 IBS',                                         tipo: 'Despesa' },
  { fullName: '2.1.06 DAS (Simples Nacional)',                       tipo: 'Despesa' },
  { fullName: '2.1.07 Outros Impostos (IOF, DIFAL, INSS, etc)',     tipo: 'Despesa' },

  // 2.2 Tarifas
  { fullName: '2.2.01 Tarifas Receita - Boleto',                   tipo: 'Despesa' },
  { fullName: '2.2.02 Tarifas Receita - PIX',                      tipo: 'Despesa' },
  { fullName: '2.2.03 Tarifas Receita - Cartões de Crédito',       tipo: 'Despesa' },
  { fullName: '2.2.04 Tarifas Receita - Antecipação de Recebíveis',tipo: 'Despesa' },
  { fullName: '2.2.05 Tarifas Receita - Stripe [USA]',             tipo: 'Despesa' },
  { fullName: '2.2.06 Tarifas Receita - Variação Cambial [USA]',   tipo: 'Despesa' },

  // 2.3 Royalties
  { fullName: '2.3.01 Royalties [BR]',                             tipo: 'Despesa' },
  { fullName: '2.3.02 Royalties [USA]',                            tipo: 'Despesa' },
  { fullName: '2.3.03 Descontos, Devoluções e Cancelamentos',      tipo: 'Despesa' },

  // ─── 3. Custos Operacionais ───────────────────────────────────────────────────

  // 3.1 Mão de Obra CSP
  { fullName: '3.1.01 CSP - Gerente de PE&G',                     tipo: 'Despesa' },
  { fullName: '3.1.02 CSP - Coordenador de PE&G',                 tipo: 'Despesa' },
  { fullName: '3.1.03 CSP - Operação  [Saber]',                   tipo: 'Despesa' },
  { fullName: '3.1.04 CSP - Operação  [Ter]',                     tipo: 'Despesa' },
  { fullName: '3.1.05 CSP - Operação  [Executar]',                tipo: 'Despesa' },
  { fullName: '3.1.06 Encargos Folha CSP [Saber]',                tipo: 'Despesa' },
  { fullName: '3.1.07 Encargos Folha CSP [Ter]',                  tipo: 'Despesa' },
  { fullName: '3.1.08 Encargos Folha CSP [Executar]',             tipo: 'Despesa' },

  // 3.2 ISAAS
  { fullName: '3.2.01 ISAAS - Fixo',                              tipo: 'Despesa' },
  { fullName: '3.2.02 ISAAS - Variável',                          tipo: 'Despesa' },
  { fullName: '3.2.03 ISAAS -  Encargos sobre Folha',             tipo: 'Despesa' },

  // 3.3 Terceirizados
  { fullName: '3.3.01 CSP Terceirizados - [Saber] (Account, GT, Design, Copy)',       tipo: 'Despesa' },
  { fullName: '3.3.02 CSP Terceirizados - [Ter] (Account, GT, Design e Copy)',        tipo: 'Despesa' },
  { fullName: '3.3.03 CSP Terceirizados - [Executar] (Account, GT, Design e Copy)',   tipo: 'Despesa' },
  { fullName: '3.3.04 CSP Terceirizados - [Potencializar] (Account, GT, Design e Copy)', tipo: 'Despesa' },

  // ─── 4. Despesas ─────────────────────────────────────────────────────────────

  // 4.1 Comerciais
  { fullName: '4.1.01 Remuneração - Coordenador de Receita',           tipo: 'Despesa' },
  { fullName: '4.1.02 Remuneração - Time Comercial Aquisição',         tipo: 'Despesa' },
  { fullName: '4.1.03 Comissão/Variável - Coordenador de Receita',     tipo: 'Despesa' },
  { fullName: '4.1.04 Comissão/Variável - Time Comercial Aquisição',   tipo: 'Despesa' },
  { fullName: '4.1.05 Encargos sobre Folha Comercial',                  tipo: 'Despesa' },
  { fullName: '4.1.06 Lead Broker',                                     tipo: 'Despesa' },
  { fullName: '4.1.07 Deal Broker',                                     tipo: 'Despesa' },
  { fullName: '4.1.08 Meet Broker',                                     tipo: 'Despesa' },
  { fullName: '4.1.09 V4 Fund',                                         tipo: 'Despesa' },
  { fullName: '4.1.10 Visita a Clientes (Aquisição)',                   tipo: 'Despesa' },
  { fullName: '4.1.11 CAC de Atribuição',                               tipo: 'Despesa' },
  { fullName: '4.1.12 CAC de Indicação',                                tipo: 'Despesa' },
  { fullName: '4.1.13 Eventos (Aquisição)',                             tipo: 'Despesa' },
  { fullName: '4.1.14 Influenciadores',                                 tipo: 'Despesa' },
  { fullName: '4.1.15 Brindes (Aquisição)',                             tipo: 'Despesa' },
  { fullName: '4.1.16 Centro de Serviço Compartilhado - CSC (Aquisição)',tipo: 'Despesa' },
  { fullName: '4.1.17 Outros Investimentos em Marketing',               tipo: 'Despesa' },
  { fullName: '4.1.18 Eventos (Renovação / Expansão)',                  tipo: 'Despesa' },
  { fullName: '4.1.19 Visita a Clientes (Renovação / Expansão)',        tipo: 'Despesa' },
  { fullName: '4.1.20 Brindes (Renovação / Expansão)',                  tipo: 'Despesa' },
  { fullName: '4.1.21 Outros Investimentos (Renovação / Expansão)',     tipo: 'Despesa' },
  { fullName: '4.1.22 Comissão - Renovação / Expansão',                tipo: 'Despesa' },
  { fullName: '4.1.23 Líder de Expansão (CSM)',                         tipo: 'Despesa' },

  // 4.2 Administrativas
  { fullName: '4.2.01 Remuneração - Diretor de PE&G',                  tipo: 'Despesa' },
  { fullName: '4.2.02 Remuneração - Coordenador Administrativo',        tipo: 'Despesa' },
  { fullName: '4.2.03 Remuneração - Time Financeiro',                   tipo: 'Despesa' },
  { fullName: '4.2.04 Remuneração - P&P',                               tipo: 'Despesa' },
  { fullName: '4.2.05 Remuneração - Sucesso do Cliente (CS)',           tipo: 'Despesa' },
  { fullName: '4.2.06 Remuneração - Tech / BI',                         tipo: 'Despesa' },
  { fullName: '4.2.07 Remuneração - Education',                         tipo: 'Despesa' },
  { fullName: '4.2.08 Variável Mão de Obra Administrativa',             tipo: 'Despesa' },
  { fullName: '4.2.09 Encargos sobre Folha Administrativa',             tipo: 'Despesa' },
  { fullName: '4.2.10 Software e Ferramentas (Matriz)',                  tipo: 'Despesa' },
  { fullName: '4.2.11 Software e Ferramentas (Unidade)',                 tipo: 'Despesa' },
  { fullName: '4.2.12 Manutenção Geral e Equipamentos/Hardware (Não Imobilizado)', tipo: 'Despesa' },
  { fullName: '4.2.13 Assessoria Contábil',                             tipo: 'Despesa' },
  { fullName: '4.2.14 Assessoria Jurídica',                             tipo: 'Despesa' },
  { fullName: '4.2.15 Indenizações / Acordos Judiciais',                tipo: 'Despesa' },
  { fullName: '4.2.16 Consultorias Externas',                           tipo: 'Despesa' },
  { fullName: '4.2.17 Cursos e Treinamentos Gerais (Sócios/Investidores)', tipo: 'Despesa' },
  { fullName: '4.2.18 Eventos V4 (Convenções)',                         tipo: 'Despesa' },
  { fullName: '4.2.19 Alimentação / Refeição',                          tipo: 'Despesa' },
  { fullName: '4.2.20 Transporte',                                       tipo: 'Despesa' },
  { fullName: '4.2.21 Benefícios e Incentivos',                         tipo: 'Despesa' },
  { fullName: '4.2.22 Premiações / Bonificações',                       tipo: 'Despesa' },
  { fullName: '4.2.23 Seguro de Vida',                                   tipo: 'Despesa' },
  { fullName: '4.2.24 Onboarding, rotinas e rituais',                   tipo: 'Despesa' },
  { fullName: '4.2.25 Pró-Labore (Sócios)',                             tipo: 'Despesa' },
  { fullName: '4.2.26 INSS s/ Pró-Labore',                             tipo: 'Despesa' },
  { fullName: '4.2.27 Investimento no People Broker',                   tipo: 'Despesa' },

  // 4.3 Gerais
  { fullName: '4.3.01 Telefone e Internet',                             tipo: 'Despesa' },
  { fullName: '4.3.02 Energia Elétrica e Água',                         tipo: 'Despesa' },
  { fullName: '4.3.03 Aluguéis e Condomínio',                          tipo: 'Despesa' },
  { fullName: '4.3.04 IPTU e Taxas Municipais',                         tipo: 'Despesa' },
  { fullName: '4.3.05 Materiais de Uso e Consumo',                      tipo: 'Despesa' },
  { fullName: '4.3.06 Limpeza e Conservação',                           tipo: 'Despesa' },
  { fullName: '4.3.07 Segurança e Monitoramento',                       tipo: 'Despesa' },
  { fullName: '4.3.08 Seguro Predial',                                   tipo: 'Despesa' },
  { fullName: '4.3.09 Seguro Financeiro',                               tipo: 'Despesa' },
  { fullName: '4.3.10 Pequenas Manutenções Prediais',                   tipo: 'Despesa' },

  // ─── 5. Depreciações ─────────────────────────────────────────────────────────

  // 5.1 Depreciação
  { fullName: '5.1.01 Depreciação - Reformas e Melhorias', tipo: 'Despesa' },
  { fullName: '5.1.02 Depreciação - Equipamentos',         tipo: 'Despesa' },
  { fullName: '5.1.03 Depreciação - Mobiliário',           tipo: 'Despesa' },
  { fullName: '5.1.04 Depreciação - Imobiliário',          tipo: 'Despesa' },

  // 5.2 Amortização
  { fullName: '5.2.01 Amortização - Software e Licença',  tipo: 'Despesa' },
  { fullName: '5.2.02 Amortização - Carteira de clientes',tipo: 'Despesa' },

  // ─── 6. Resultados Financeiros ───────────────────────────────────────────────

  // 6.1 Receita Financeira
  { fullName: '6.1.01 Rendimentos de Aplicações',          tipo: 'Receita' },
  { fullName: '6.1.02 Dividendos Recebidos',               tipo: 'Receita' },
  { fullName: '6.1.03 Aluguel de Sublocação',              tipo: 'Receita' },
  { fullName: '6.1.04 Receitas de Exercícios Anteriores',  tipo: 'Receita' },
  { fullName: '6.1.05 Outras Receitas Não Operacionais',   tipo: 'Receita' },
  { fullName: '6.1.06 Multas e Juros Recebidos',           tipo: 'Receita' },
  { fullName: '6.1.07 Variação Cambial',                   tipo: 'Receita' },

  // 6.2 Despesa Financeira
  { fullName: '6.2.01 Juros e Encargos s/ Empréstimos',                    tipo: 'Despesa' },
  { fullName: '6.2.02 Tarifas Bancárias (Manutenção Conta / Contas a Pagar)', tipo: 'Despesa' },
  { fullName: '6.2.03 Despesas de Exercícios Anteriores',                  tipo: 'Despesa' },
  { fullName: '6.2.04 Outras Despesas Não Operacionais',                   tipo: 'Despesa' },
  { fullName: '6.2.05 Perdas com Clientes (Inadimplência)',                tipo: 'Despesa' },

  // ─── 7. Impostos Sobre Lucro ─────────────────────────────────────────────────
  { fullName: '7.1 CSLL', tipo: 'Despesa' },
  { fullName: '7.2 IRPJ', tipo: 'Despesa' },
]

// ─── Linhas não-DRE (fluxo de caixa / balanço) ───────────────────────────────

export const NON_DRE_ROWS: CatLeaf[] = [
  { fullName: '(+) Aporte de Capital (Sócios)',                                    tipo: 'Receita', isNonDre: true },
  { fullName: '(+) Entrada de Empréstimos / Financiamentos',                       tipo: 'Receita', isNonDre: true },
  { fullName: '(+) Venda de Ativo / Quotas',                                       tipo: 'Receita', isNonDre: true },
  { fullName: '(-) Parcela de Financiamento / Empréstimos - Curto Prazo',          tipo: 'Despesa', isNonDre: true },
  { fullName: '(-) Parcela de Financiamento / Empréstimos - Longo Prazo',          tipo: 'Despesa', isNonDre: true },
  { fullName: '(-) Distribuição de Lucros / Dividendos (Retirada Sócios)',         tipo: 'Despesa', isNonDre: true },
  { fullName: '(-) Recompra de Quotas',                                            tipo: 'Despesa', isNonDre: true },
  { fullName: '(Não DRE) Aquis. Imobilizado - Reformas e Melhorias',              tipo: 'Despesa', isNonDre: true },
  { fullName: '(Não DRE) Aquis. Imobilizado - Equipamentos',                      tipo: 'Despesa', isNonDre: true },
  { fullName: '(Não DRE) Aquis. Imobilizado - Mobiliário',                        tipo: 'Despesa', isNonDre: true },
  { fullName: '(Não DRE) Aquis. Imobilizado - Imóveis',                           tipo: 'Despesa', isNonDre: true },
]

// ─── KPIs computados ($ e %) ─────────────────────────────────────────────────

export const KPI_ROWS: CatLeaf[] = [
  { fullName: '$ Despesas Variáveis',                tipo: 'Despesa', isKpi: true },
  { fullName: '$ Gastos Totais c/ Pessoas',          tipo: 'Despesa', isKpi: true },
  { fullName: '% Deduções',                          tipo: 'Despesa', isKpi: true },
  { fullName: '% Receita Líquida',                   tipo: 'Receita', isKpi: true },
  { fullName: '% Margem Bruta',                      tipo: 'Receita', isKpi: true },
  { fullName: '% Margem Operacional',                tipo: 'Receita', isKpi: true },
  { fullName: '% Margem de Contribuição',            tipo: 'Receita', isKpi: true },
  { fullName: '% EBITDA',                            tipo: 'Receita', isKpi: true },
  { fullName: '% Lucro operacional (EBIT)',          tipo: 'Receita', isKpi: true },
  { fullName: '% Lucro Líquido',                     tipo: 'Receita', isKpi: true },
  { fullName: '% Custos da atividade principal (CSP)',tipo: 'Despesa', isKpi: true },
  { fullName: '% Custos com Terceirizados (CSP)',    tipo: 'Despesa', isKpi: true },
  { fullName: '% Despesas Comerciais',               tipo: 'Despesa', isKpi: true },
  { fullName: '% Despesas Totais com Aquisição',     tipo: 'Despesa', isKpi: true },
  { fullName: '% Despesas Totais com Lead Broker',   tipo: 'Despesa', isKpi: true },
  { fullName: '% Despesas Totais com Expansão',      tipo: 'Despesa', isKpi: true },
  { fullName: '% Despesas Administrativas',          tipo: 'Despesa', isKpi: true },
  { fullName: '% Despesas Gerais',                   tipo: 'Despesa', isKpi: true },
  { fullName: '% Despesas Gerais e Administrativas (G&A)', tipo: 'Despesa', isKpi: true },
  { fullName: '% Pró-labore',                        tipo: 'Despesa', isKpi: true },
  { fullName: '% Growth Rate',                       tipo: 'Receita', isKpi: true },
]

/** Todos os leaves disponíveis para seleção no formulário de metas */
export const ALL_CATEGORY_LEAVES: CatLeaf[] = [
  ...DRE_LEAVES,
  ...NON_DRE_ROWS,
  ...KPI_ROWS,
]
