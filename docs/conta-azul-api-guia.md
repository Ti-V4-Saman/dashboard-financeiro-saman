# Conta Azul API v1 — Guia Técnico Definitivo
## Campos de Competência vs Caixa para o Dashboard Financeiro Saman

> **Fonte da verdade do projeto.** Toda decisão sobre filtros, queries, modelagem ou visões de dashboard financeiro consulta este documento antes.
> Última revisão: maio/2026. API base: `https://api-v2.contaazul.com/v1/...`

---

## TL;DR

- **Trabalhe sempre na granularidade de PARCELA** (`/v1/financeiro/eventos-financeiros/parcelas`), nunca de venda ou nota fiscal. A parcela é o único objeto que carrega simultaneamente os três campos essenciais: `data_competencia` (competência), `data_vencimento` (caixa previsto) e `baixas[].data_pagamento` (caixa realizado).
- **Competência** = `evento.data_competencia` (também replicado em `itens[].data_competencia` na busca).
- **Caixa realizado** = `baixas[].data_pagamento` (filtrando parcelas com `status IN ('QUITADO','RECEBIDO_PARCIAL')`).
- **Caixa previsto** = `data_vencimento` (filtrando parcelas com `status IN ('PENDENTE','ATRASADO','RECEBIDO_PARCIAL')`).
- **Receita vs Despesa** = `evento.tipo` (`RECEITA` | `DESPESA`).
- **Nunca some Vendas + Contas a Receber** no mesmo total: toda venda aprovada/faturada gera evento financeiro com `origem = VENDA` ou `VENDA_AGENDADA`, então as parcelas já contêm o valor. Use vendas só para análise comercial (ticket médio, vendedor, conversão).

---

## 1. Tabela Mestre — Campos de Data por Entidade

### 1.1 Parcela (Contas a Receber e a Pagar)

Endpoint: `GET /v1/financeiro/eventos-financeiros/parcelas/{id}`

| Campo | Tipo | Significado contábil | Uso no dashboard |
|---|---|---|---|
| `evento.data_competencia` | date | **COMPETÊNCIA** — data do fato gerador | DRE por competência |
| `evento.tipo` | enum `RECEITA` \| `DESPESA` | Diferencia entrada de saída | Separar receita/despesa |
| `evento.referencia.origem` | enum (lista abaixo) | De onde o lançamento veio | Evitar duplicidade |
| `evento.agendado` | boolean | Lançamento recorrente | Filtrar previsões automáticas |
| `evento.rateio[].id_categoria` / `nome_categoria` | string | Plano de contas | DRE por categoria |
| `evento.rateio[].rateio_centro_custo[].id_centro_custo` / `nome_centro_custo` | string | Centro de custo | DRE por CC |
| `data_vencimento` | date | **CAIXA PREVISTO** | Fluxo de caixa previsto |
| `data_pagamento_previsto` | date | Previsão de pagamento (planejamento) — **NÃO é baixa** | Projeções |
| `status` | enum (lista abaixo) | Situação atual | Define a visão |
| `valor_pago` | number | Quanto já foi baixado | Caixa realizado |
| `nao_pago` | number | Saldo em aberto | Caixa previsto / inadimplência |
| `valor_composicao.valor_bruto/liquido/multa/juros/desconto/taxa` | number | Composição financeira | Conciliação detalhada |
| `valor_total_liquido` | number | Total líquido | Valor "do dinheiro" |
| `conciliado` | boolean | Conciliada com extrato? | Conciliação bancária |
| `baixa_agendada` | boolean | Baixa programada (não executada) | Excluir do realizado |
| `baixas[]` | array | Cada efetivação de pagamento | **Fonte do caixa realizado** |
| `baixas[].data_pagamento` | date | **CAIXA REALIZADO** — data efetiva | Fluxo realizado |
| `baixas[].valor_composicao.valor_liquido` | number | Líquido daquela baixa | Soma do realizado |
| `baixas[].conta_financeira` | obj | Conta bancária da baixa | Saldo por conta |
| `baixas[].metodo_pagamento` | enum | DINHEIRO, PIX_*, BOLETO_BANCARIO, CARTAO_*, TRANSFERENCIA_BANCARIA, etc. | Análise por meio |
| `baixas[].origem` | enum | Mesma de `evento.referencia.origem` | — |
| `baixas[].id_reconciliacao` | uuid | Conciliação bancária | — |
| `data_alteracao` | timestamptz GMT-3 | Última atualização | Sincronização incremental |
| `solicitacoes_cobrancas[]` | array | Boletos/PIX gerados | Cobrança |
| `renegociacao.id` / `id_evento` / `valor` | obj | Renegociação | Tratar separadamente |
| `perda.data` / `perda.valor` | obj | Marcação de perda | Inadimplência confirmada |
| `fatura.numero` / `tipo_fatura` (`NFE`, `NFSE`, `NFCE`) | obj | Vínculo com NF | Cruzar com `/v1/notas-fiscais` |
| `indice` | int | Número da parcela (1, 2, 3…) | "Parcela 2/6" |

**Enum `evento.referencia.origem`:** `LANCAMENTO_FINANCEIRO`, `DAS`, `FOLHA`, `TRANSFERENCIA`, `SALDO_CONTA_BANCARIA`, `VENDA`, `COMPRA`, `VENDA_AGENDADA`, `COMPRA_AGENDADA`, `IMPORTACAO_DOCUMENTO`, `IMPOSTO_RETIDO`, `SIC`, `NOTA_COMPRA`, `ANTECIPACAO`, `RENEGOCIACAO`, `HONORARIOS_CONTABEIS`.

### 1.2 Filtros — `GET /v1/financeiro/eventos-financeiros/contas-a-receber/buscar`

| Filtro | Tipo | Obrigatório? |
|---|---|---|
| `pagina`, `tamanho_pagina` | int | sim |
| `data_vencimento_de` / `data_vencimento_ate` | date | **sim** |
| `data_competencia_de` / `data_competencia_ate` | date | não |
| `data_pagamento_de` / `data_pagamento_ate` | date | não |
| `data_alteracao_de` / `data_alteracao_ate` | datetime ISO 8601 GMT-3 | não |
| `valor_de` / `valor_ate` | string | não |
| `status` | array enum: `PERDIDO`, `RECEBIDO`, `EM_ABERTO`, `RENEGOCIADO`, `RECEBIDO_PARCIAL`, `ATRASADO` | não |
| `ids_contas_financeiras` | array uuid | não |
| `ids_categorias` | array uuid | não |
| `ids_centros_de_custo` | array uuid | não |
| `ids_clientes` | array uuid | não |
| `descricao` | string | não |

⚠️ `data_vencimento_de`/`ate` são **obrigatórios**. Use range amplo (2000-01-01 a 2099-12-31) quando o foco for outra data.

⚠️ O enum do filtro `status` é **diferente** do enum retornado em `parcela.status`:
- Filtro: `EM_ABERTO`, `RECEBIDO`, `ATRASADO`, `RENEGOCIADO`, `RECEBIDO_PARCIAL`, `PERDIDO`.
- Retorno: `PENDENTE`, `QUITADO`, `CANCELADO`, `RENEGOCIADO`, `RECEBIDO_PARCIAL`, `ATRASADO`, `PERDIDO`.
- Nota da doc: "PENDENTE é o mesmo que EM_ABERTO. QUITADO é o mesmo que RECEBIDO."

### 1.3 Filtros — `GET /v1/financeiro/eventos-financeiros/contas-a-pagar/buscar`

Idêntico ao de receber, com:
- `ids_clientes` não disponível
- Resposta tem `itens[].fornecedor` em vez de `cliente`

### 1.4 Resposta da busca (`itens[]`)

| Campo | Tipo |
|---|---|
| `id` | uuid |
| `descricao` | string |
| `data_vencimento` | date |
| `data_competencia` | date |
| `data_criacao` | datetime |
| `data_alteracao` | datetime |
| `status` | string raw (ex: "OVERDUE") |
| `status_traduzido` | enum traduzido (use este na lógica) |
| `total` | number |
| `nao_pago` | number |
| `pago` | number |
| `categorias[]` (id, nome) | array |
| `centros_custo[]` (id, nome) | array |
| `cliente` / `fornecedor` | obj |
| `renegociacao` (id, valor, id_evento) | obj |

⚠️ **A busca NÃO retorna `baixas[]`.** Para obter `data_pagamento` real, filtre por `data_pagamento_de/ate` e depois faça `GET /v1/financeiro/eventos-financeiros/parcelas/{id}` para cada parcela retornada.

### 1.5 Baixas — `GET .../parcelas/{parcela_id}/baixa`

| Campo | Significado |
|---|---|
| `id` | uuid |
| `data_pagamento` | **DATA EFETIVA do caixa** |
| `valor_composicao.valor_bruto/liquido/multa/juros/desconto/taxa` | Composição |
| `conta_financeira` | Conta usada |
| `id_reconciliacao` | Conciliação bancária |
| `id_parcela` | FK |
| `id_solicitacao_cobranca` | Se veio de cobrança |
| `metodo_pagamento` | DINHEIRO, PIX_*, BOLETO_*, CARTAO_*, etc. |
| `origem` | Mesma do evento pai |
| `tipo_evento_financeiro` | RECEITA / DESPESA (redundância útil) |
| `nsu` | NSU de cartão |
| `atualizado_em` | datetime |
| `anexos[]` | Comprovantes |

### 1.6 Vendas — `GET /v1/venda/busca`

| Filtro | Tipo |
|---|---|
| `data_inicio` / `data_fim` | date — data da venda |
| `data_criacao_de` / `data_criacao_ate` | date |
| `data_alteracao_de` / `data_alteracao_ate` | datetime ISO 8601 (máx 365 dias) |
| `situacoes` | array (`EM_ANDAMENTO`, `APROVADO`, `FATURADO`, `CANCELADO`) |
| `tipos` | array (`SALE`, `SALE_PROPOSAL`, `SCHEDULED_SALE`) |
| `ids_vendedores`, `ids_clientes`, `ids_categorias`, `ids_produtos`, `ids_natureza_operacao` | array uuid |
| `origens`, `numeros`, `pendente`, `totais` (`WAITING_APPROVED`, `APPROVED`, `CANCELED`, `ALL`) | — |
| `termo_busca` | string |

Resposta `itens[]`: `id`, `id_legado`, `numero`, `data` (data da venda — **note que é `data`, não `data_venda`**), `criado_em`, `data_alteracao`, `tipo`, `cliente`, `situacao.nome`/`descricao`, `total`, `condicao_pagamento`, `id_contrato` (se preenchido = venda recorrente), `status_email`, `origem`, `versao`.

Detalhe `GET /v1/venda/{id}` adiciona: `venda.data_compromisso`, `venda.tipo_negociacao`, `evento_financeiro.id` (UUID para joinar com parcelas), `contrato` (completo se recorrente), `natureza_operacao.tipo_operacao`, `template_operacao`, `mudanca_financeira`, `mudanca_estoque`.

### 1.7 NFS-e — `GET /v1/notas-fiscais-servico`

Filtros: `pagina`, `tamanho_pagina`, `data_competencia_de`/`ate` (**obrigatórios, range máx 15 dias**), `ids`, `id_cliente`, `numero_venda`, `numero_nfse_inicial`/`final`, `numero_rps_inicial`/`final`, `status` (array, enum abaixo), `tipo_negociacao` (`VENDA`, `CONTRATO`).

**Enum status:** `PENDENTE`, `PRONTA_ENVIO`, `AGUARDANDO_RETORNO`, `EM_ESPERA`, `EMITINDO`, `EMITIDA`, `CANCELADA`, `FALHA`, `FALHA_CANCELAMENTO`, `CORRIGIDA_SUCESSO`, `AGUARDANDO_CORRECAO`, `FALHA_CORRECAO`, `DENEGADA`, `CANCELAMENTO_MANUAL`.

Resposta `itens[]`: `id`, `id_venda`, `id_contrato`, `data_competencia` (= data emissão/competência), `cidade_emissao`, `codigo_cnae`, `documento_cliente`, `nome_cliente`, `numero_nfse`, `numero_rps`, `numero_venda`, `status`, `valor_total_nfse`, `escriturado_manualmente`, `informacao_transmissao.data_inicio_emissao`/`data_inicio_cancelamento`, `informacoes_cancelamento.motivo`/`usuario`.

⚠️ A listagem **não traz** `valor_iss`, `valor_liquido` nem detalhamento financeiro — só na consulta individual.

### 1.8 NF-e — `GET /v1/notas-fiscais`

Filtros: `data_inicial`/`data_final` (obrigatórios, date), `pagina`, `tamanho_pagina`, `documento_tomador`, `numero_nota`, `id_venda`.

Resposta `itens[]`: `chave_acesso` (44 dígitos), `data_emissao` (datetime), `nome_destinatario`, `numero_nota`, `status` (**só** `EMITIDA` ou `CORRIGIDA_SUCESSO` no momento).

⚠️ Resposta enxuta: **não retorna `valor_total`, `id_venda`, `id_cliente`** mesmo aceitando `id_venda` como filtro.

### 1.9 Auxiliares

- `GET /v1/conta-financeira` — tipos: `APLICACAO`, `CAIXINHA`, `CONTA_CORRENTE`, `CARTAO_CREDITO`, `INVESTIMENTO`, `OUTROS`, `MEIOS_RECEBIMENTO`, `POUPANCA`, `COBRANCAS_CONTA_AZUL`, `RECEBA_FACIL_CARTAO`.
- `GET /v1/conta-financeira/{id}/saldo-atual` — saldo atual.
- `GET /v1/financeiro/eventos-financeiros/saldo-inicial` — saldos iniciais em período.
- `GET /v1/financeiro/transferencias` — transferências entre contas.
- `GET /v1/categorias` — `tipo` RECEITA/DESPESA, hierárquico.
- `GET /v1/financeiro/categorias-dre` — estrutura hierárquica do DRE (N1, N2, N3).
- `GET /v1/centro-de-custo`.
- `GET /v1/financeiro/eventos-financeiros/alteracoes` — **IDs alterados em período** (chave para sincronização incremental).

### 1.10 Contratos (vendas recorrentes) — `/v1/contratos`

`data_emissao`, `data_inicio`, `data_fim` (em `termos`), `termos.tipo_frequencia` (MENSAL/SEMANAL/ANUAL), `intervalo_frequencia`, `dia_emissao_venda`, `tipo_expiracao` (DATA/INDETERMINADO), `condicao_pagamento.dia_vencimento`, `primeira_data_vencimento`.

Cada execução do contrato gera uma venda com `id_contrato` preenchido e tipo `SCHEDULED_SALE`, que gera evento financeiro com `origem = VENDA_AGENDADA`.

---

## 2. Status por Entidade

### 2.1 Parcela

| Status retornado | Status traduzido (filtro) | Significado | Caixa realizado? |
|---|---|---|---|
| `PENDENTE` | `EM_ABERTO` | Em aberto, vencimento futuro | Não — **caixa previsto** |
| `ATRASADO` | `ATRASADO` | Vencida e não paga | Não — **previsto + inadimplência** |
| `QUITADO` | `RECEBIDO` | Totalmente paga | **Sim** |
| `RECEBIDO_PARCIAL` | `RECEBIDO_PARCIAL` | Parcialmente paga | **Sim** (`valor_pago`) + **previsto** (`nao_pago`) |
| `CANCELADO` | (não no filtro) | Cancelada — ignorar | Não |
| `RENEGOCIADO` | `RENEGOCIADO` | Substituída — checar `renegociacao.id_evento` | Não (evita dupla contagem) |
| `PERDIDO` | `PERDIDO` | Marcada como perda | Não, mas registra `perda.valor` |

### 2.2 Venda

| `situacao.nome` | Inclui em DRE/Caixa? |
|---|---|
| `EM_ANDAMENTO` | Não — não gera parcela definitiva |
| `APROVADO` | Sim (via parcelas) |
| `FATURADO` | Sim |
| `CANCELADO` | Não |

### 2.3 Solicitação de Cobrança

`AGUARDANDO_CONFIRMACAO`, `EM_CANCELAMENTO`, `REGISTRADO`, `QUITADO`, `CANCELADO`, `INVALIDO`, `EXPIRADO`, `FALHA_EMISSAO`, `FALHA_CANCELAR`, `REMESSA_GERADO`, `REMESSA_PENDENTE`, `PAGO`, `EXTORNADO`.

---

## 3. Receitas SQL para Cada Visão

### 3.1 DRE por Competência — Receita

```sql
SELECT SUM(p.valor_total_liquido) AS receita_competencia
FROM parcelas p
JOIN eventos_financeiros e ON e.id = p.id_evento
WHERE e.tipo = 'RECEITA'
  AND p.data_competencia >= '2026-01-01'
  AND p.data_competencia <  '2026-02-01'
  AND p.status NOT IN ('CANCELADO', 'RENEGOCIADO');
```

### 3.2 DRE por Competência — Despesa
Idem com `e.tipo = 'DESPESA'`.

### 3.3 Fluxo de Caixa Realizado

```sql
SELECT e.tipo, SUM(b.valor_liquido) AS valor
FROM baixas b
JOIN parcelas p ON p.id = b.id_parcela
JOIN eventos_financeiros e ON e.id = p.id_evento
WHERE b.data_pagamento >= '2026-01-01'
  AND b.data_pagamento <  '2026-02-01'
GROUP BY e.tipo;
```
Use `data_pagamento` da **baixa**, não da parcela. Uma parcela pode ter múltiplas baixas em datas diferentes.

### 3.4 Fluxo de Caixa Previsto

```sql
SELECT e.tipo, SUM(p.nao_pago) AS valor_previsto
FROM parcelas p
JOIN eventos_financeiros e ON e.id = p.id_evento
WHERE p.data_vencimento >= '2026-01-01'
  AND p.data_vencimento <  '2026-02-01'
  AND p.status IN ('PENDENTE', 'ATRASADO', 'RECEBIDO_PARCIAL')
  AND p.nao_pago > 0
GROUP BY e.tipo;
```

### 3.5 Fluxo de Caixa Total (Realizado + Previsto)

UNION ALL das duas views com coluna `tipo_visao` ('REALIZADO' | 'PREVISTO'). Para mês corrente/passado, realizado é o que entrou e previsto complementa o que estava esperado e não veio. Para meses futuros, só há previsto.

### 3.6 Inadimplência

```sql
SELECT p.id, p.nao_pago, p.data_vencimento,
       CURRENT_DATE - p.data_vencimento AS dias_atraso
FROM parcelas p
JOIN eventos_financeiros e ON e.id = p.id_evento
WHERE e.tipo = 'RECEITA'
  AND p.status IN ('ATRASADO', 'PERDIDO', 'RECEBIDO_PARCIAL')
  AND p.data_vencimento < CURRENT_DATE
  AND p.nao_pago > 0;
```

### 3.7 Contas a Pagar/Receber em Aberto

```sql
SELECT e.tipo, SUM(p.nao_pago)
FROM parcelas p
JOIN eventos_financeiros e ON e.id = p.id_evento
WHERE p.status IN ('PENDENTE', 'ATRASADO', 'RECEBIDO_PARCIAL')
  AND p.nao_pago > 0
GROUP BY e.tipo;
```

### 3.8 DRE Gerencial

Use `/v1/financeiro/categorias-dre` para a árvore (DRE N1, N2, N3) e joine via `evento.rateio[].id_categoria → categoria.id_categoria_dre`. Grupos padronizados da Conta Azul (não personalizáveis): Receita Bruta, Deduções, Custos das Vendas, Despesas Operacionais (Adm./Comerciais), Outras Receitas, Outras Despesas.

⚠️ No DRE Gerencial nativo, **taxas, descontos, juros e perdas seguem regime de caixa dentro do DRE**. Replique se quiser bater com o relatório nativo.

---

## 4. Armadilhas Conhecidas

1. **Vendas geram parcelas automaticamente** — `origem = VENDA` ou `VENDA_AGENDADA`. Nunca some vendas + parcelas.
2. **NFS-e/NF-e podem ter valor diferente da venda** (ISS retido, frete, descontos fiscais). Use sempre o valor da parcela.
3. **NFS-e tomada com competência artificial:** quando vem só mês/ano de competência, é registrada no dia 1. Trate notas tomadas com cuidado.
4. **Renegociações duplicam parcelas** — exclua `status = 'RENEGOCIADO'` dos totais. Para DRE por competência, a Conta Azul passa a considerar a data da renegociação, deslocando valores entre meses.
5. **Pagamentos parciais** — parcela `RECEBIDO_PARCIAL` entra simultaneamente em realizado (via `baixas[].data_pagamento`, `valor_pago`) e previsto (pela parte `nao_pago` no `data_vencimento`). Nunca conte a parcela inteira em ambos.
6. **Receba Fácil / Conta PJ / Cobranças Conta Azul** — contas com tipo `COBRANCAS_CONTA_AZUL` / `RECEBA_FACIL_CARTAO` têm baixa automática. Não dá para baixar via API. Para "previsto" dessas, filtre `solicitacoes_cobrancas[].status_solicitacao_cobranca IN ('REGISTRADO','AGUARDANDO_CONFIRMACAO')`.
7. **Transferências não são DRE** — `origem = 'TRANSFERENCIA'` é movimentação interna. Sempre exclua do DRE e do fluxo consolidado. Use `/v1/financeiro/transferencias` separado.
8. **`SALDO_CONTA_BANCARIA`** — ajustes de saldo inicial. Exclua do DRE.
9. **NF-e sem venda** — possível para NF-e importadas. A listagem `/v1/notas-fiscais` só retorna `EMITIDA`/`CORRIGIDA_SUCESSO` no momento. Não use NF-e como fonte de receita primária.
10. **Conciliação ≠ Baixa** — `baixas[].id_reconciliacao IS NOT NULL` ou `parcela.conciliado = true` indica bate com extrato. Baixa é o lançamento contábil; conciliação é o pareamento.
11. **NFS-e: range máx 15 dias** — paginar por janelas quinzenais para sincronizar histórico.
12. **Sync incremental** via `data_alteracao_de`/`ate` (ISO 8601 GMT-3, máx 365 dias em vendas) ou via `/v1/financeiro/eventos-financeiros/alteracoes`.
13. **Rate limit:** 600 req/min e 10 req/s por conta conectada do ERP. Para múltiplos clientes, isole worker por tenant.
14. **Webhooks não existem.** Toda atualização é via polling.

---

## 5. Modelagem Recomendada (Postgres/Supabase)

### 5.1 Tabelas mínimas

- `eventos_financeiros (id, tipo, data_competencia, origem, agendado, id_contato, id_conta_financeira_default, criado_em, atualizado_em)`
- `parcelas (id, id_evento FK, indice, status, data_vencimento, data_pagamento_previsto, valor_total_liquido, valor_pago, nao_pago, conciliado, id_conta_financeira, fatura_numero, fatura_tipo, perda_data, perda_valor, renegociacao_id, renegociacao_id_evento, data_alteracao, atualizado_em)`
- `baixas (id, id_parcela FK, data_pagamento, valor_liquido, valor_bruto, multa, juros, desconto, taxa, id_conta_financeira, metodo_pagamento, origem, tipo_evento_financeiro, id_reconciliacao, atualizado_em)`
- `evento_rateios (id_evento FK, id_categoria, valor)`
- `evento_rateio_centro_custo (id_evento_rateio FK, id_centro_custo, valor)`
- `vendas (id, numero, data_venda, situacao, tipo_negociacao, id_cliente, id_categoria, id_centro_custo, id_vendedor, id_contrato, evento_financeiro_id, total, criado_em, atualizado_em)`
- `notas_fiscais_servico (id, id_venda, id_contrato, data_competencia, numero_nfse, numero_rps, status, valor_total_nfse, ...)`
- `notas_fiscais (chave_acesso PK, data_emissao, numero_nota, status, nome_destinatario)`

### 5.2 Índices essenciais

```sql
CREATE INDEX idx_parcelas_competencia
  ON parcelas (data_competencia)
  WHERE status NOT IN ('CANCELADO', 'RENEGOCIADO');

CREATE INDEX idx_parcelas_vencimento_status
  ON parcelas (data_vencimento, status);

CREATE INDEX idx_parcelas_status_abertas
  ON parcelas (status)
  WHERE status IN ('PENDENTE', 'ATRASADO', 'RECEBIDO_PARCIAL');

CREATE INDEX idx_parcelas_evento ON parcelas (id_evento);

CREATE INDEX idx_baixas_data_pagamento ON baixas (data_pagamento);
CREATE INDEX idx_baixas_parcela ON baixas (id_parcela);

CREATE INDEX idx_eventos_tipo_origem ON eventos_financeiros (tipo, origem);

CREATE INDEX idx_parcelas_alteracao ON parcelas (data_alteracao);
CREATE INDEX idx_vendas_alteracao ON vendas (atualizado_em);

CREATE INDEX idx_rateio_categoria ON evento_rateios (id_categoria);
CREATE INDEX idx_rateio_evento ON evento_rateios (id_evento);
```

### 5.3 Views materializadas

```sql
CREATE MATERIALIZED VIEW mv_dre_competencia AS
SELECT
  date_trunc('month', p.data_competencia) AS mes_competencia,
  e.tipo,
  er.id_categoria,
  c.nome AS categoria,
  SUM(p.valor_total_liquido) AS valor
FROM parcelas p
JOIN eventos_financeiros e ON e.id = p.id_evento
LEFT JOIN evento_rateios er ON er.id_evento = e.id
LEFT JOIN categorias c ON c.id = er.id_categoria
WHERE p.status NOT IN ('CANCELADO', 'RENEGOCIADO')
  AND e.origem NOT IN ('TRANSFERENCIA', 'SALDO_CONTA_BANCARIA')
GROUP BY 1, 2, 3, 4;

CREATE INDEX ON mv_dre_competencia (mes_competencia, tipo);

CREATE MATERIALIZED VIEW mv_caixa_realizado AS
SELECT
  b.data_pagamento,
  date_trunc('month', b.data_pagamento) AS mes,
  e.tipo,
  b.id_conta_financeira,
  cf.nome AS conta,
  SUM(b.valor_liquido) AS valor
FROM baixas b
JOIN parcelas p ON p.id = b.id_parcela
JOIN eventos_financeiros e ON e.id = p.id_evento
LEFT JOIN contas_financeiras cf ON cf.id = b.id_conta_financeira
WHERE e.origem NOT IN ('TRANSFERENCIA', 'SALDO_CONTA_BANCARIA')
GROUP BY 1, 2, 3, 4, 5;

CREATE MATERIALIZED VIEW mv_caixa_previsto AS
SELECT
  p.data_vencimento,
  date_trunc('month', p.data_vencimento) AS mes,
  e.tipo,
  p.id_conta_financeira,
  SUM(p.nao_pago) AS valor_previsto
FROM parcelas p
JOIN eventos_financeiros e ON e.id = p.id_evento
WHERE p.status IN ('PENDENTE', 'ATRASADO', 'RECEBIDO_PARCIAL')
  AND p.nao_pago > 0
  AND e.origem NOT IN ('TRANSFERENCIA', 'SALDO_CONTA_BANCARIA')
GROUP BY 1, 2, 3, 4;
```

Refresh agendado via `pg_cron` no Supabase:

```sql
SELECT cron.schedule(
  'refresh-mv-financeiro',
  '*/15 * * * *',
  $$ REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dre_competencia;
     REFRESH MATERIALIZED VIEW CONCURRENTLY mv_caixa_realizado;
     REFRESH MATERIALIZED VIEW CONCURRENTLY mv_caixa_previsto; $$
);
```

### 5.4 Estratégia de sincronização

1. **Carga inicial:** paginar todos os endpoints em janelas mensais (15 dias para NFS-e), priorizar parcelas + baixas + vendas.
2. **Sync incremental** (a cada N minutos):
   - `GET /v1/financeiro/eventos-financeiros/alteracoes?inicio={ultimo_sync}&fim={now}` → lista de IDs alterados.
   - `GET /v1/financeiro/eventos-financeiros/parcelas/{id}` para cada um.
   - `GET /v1/venda/busca?data_alteracao_de=...&data_alteracao_ate=...` para vendas.
3. **NFS-e:** janelas de 15 dias por `data_competencia`.
4. **NF-e:** janelas por `data_inicial`/`data_final`.
5. **Rate limit:** respeitar 600 req/min e 10 req/s por conta. Isolar worker por tenant.
6. **>100k parcelas/mês:** considerar partitioning de `parcelas` e `baixas` por `data_competencia`/`data_pagamento` e `REFRESH ... CONCURRENTLY` via `pg_cron`.

---

## 6. Avisos Importantes

- A "API v1" desta documentação é a **plataforma nova** `api-v2.contaazul.com/v1/...` (março/2025), em snake_case português. A API antiga (`api.contaazul.com/v1/...` em inglês com `/v1/sales`, `/v1/service_invoices`, `/v1/financial-events`) está sendo descontinuada — só permanece para integrações pré-março/2025.
- Alguns endpoints ainda estão em construção (NF-e só retorna `EMITIDA`/`CORRIGIDA_SUCESSO`; NFS-e do Padrão Nacional ainda não é importada automaticamente).
- Não há sandbox dedicado: cria-se um App de Desenvolvimento que dá acesso a Conta de Desenvolvimento de 30 dias.
- A `data_competencia` em NFS-e equivale a "data de emissão" na descrição do filtro, mas pode divergir em NFS-e tomadas. Confirme o critério com o contador antes de cravar.
- Boletos não têm endpoint próprio: aparecem dentro da parcela como `solicitacoes_cobrancas[]`.
- Não existem webhooks: polling é o único caminho.
