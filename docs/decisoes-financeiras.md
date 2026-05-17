# Decisões e Descobertas — Dashboard Financeiro Saman

Histórico de decisões técnicas, descobertas de auditoria e backlog pendente
da integração com a API v1 da Conta Azul.

Referência técnica completa: `docs/conta-azul-api-v1-competencia-caixa.md`.

---

## 2026-05-15 — Auditoria inicial pós CLAUDE.md

### Contexto

Implantado `CLAUDE.md` e `docs/conta-azul-api-v1-competencia-caixa.md` no repo.
Solicitada auditoria do código atual (frontend Next.js + ETL Python) para
identificar divergências entre a implementação e as regras documentadas.

### Estado das correções aplicadas

| Fase | Item | Status |
|---|---|---|
| 1 | Filtrar `Cancelado` e `Renegociado` na API route (caixa receber, caixa pagar, competência receber, competência pagar) | ✅ Aplicado |
| 2 | Adicionar coluna `origem` em `ca.contas_receber` e `ca.contas_pagar` (DDL idempotente) | ✅ Aplicado |
| 2 | ETL `_map_conta_receber` e `_map_conta_pagar` mapeando `origem` do payload da API | ✅ Aplicado |
| 2 | API route lendo `origem` da query SQL e derivando `isTransfer` a partir dele | ✅ Aplicado |
| 2 | Remoção da constante `TRANSFER_CATS` (lógica antiga de nome de categoria) | ✅ Aplicado (sem fallback comentado) |
| 2 | Full sync para popular `origem` em todos os registros existentes | 🔄 Em andamento |
| 3 | Hierarquia de categorias DRE | ⏸️ Aguardando fim do sync |
| 4 | Correções de pagamento Parcial | ⏸️ Aguardando decisão de conceito |
| 4 | `forma_pagamento` no SELECT da API route | 📋 Backlog |
| 4 | Substring matching frágil de status (`includes('atraso')`) | 📋 Backlog |

### Descobertas

#### Cancelados em contas_receber

- 43 registros com `status = 'Cancelado'` em `ca.contas_receber`
- Volume total: ~R$ 90.000 distribuídos entre mai/25 e abr/26
- **Concentração em dez/25:** 13 cancelamentos somando R$ 32.886
  - Hipótese: possível renegociação em bloco (parcelas futuras canceladas
    todas de uma vez)
  - **Validar com Saman:** foi cancelamento puro ou parte de renegociação?
  - Após fim do sync, cruzar com `origem = 'RENEGOCIACAO'` em parcelas
    substitutas para descartar dupla contagem

#### Status no banco hoje

`ca.contas_receber`:
- `Quitado`: 1.622
- `Aberto`: 447
- `Atrasado`: 76
- `Cancelado`: 43

`ca.contas_pagar`:
- `Quitado`: 5.631
- `Aberto`: 610
- `Atrasado`: 57
- `Parcial`: 3

Status `Renegociado` não existe nos dados sincronizados até agora. O filtro
preventivo está aplicado (cobre quando aparecer).

#### Transferências estavam vazando nos totais

A constante `TRANSFER_CATS` antiga (`'transferência de entrada'`,
`'transferência de saída'`, `'saldo inicial'`) nunca capturou nenhum
registro — as categorias do banco do Saman não têm esses nomes literais.

**Implicação:** transferências entre contas estavam contaminando DRE e
Fluxo de Caixa há toda a vida do dashboard. A lógica nova baseada em
`origem IN ('TRANSFERENCIA', 'SALDO_CONTA_BANCARIA')` é a primeira
proteção real contra isso.

**Quando comunicar à Saman:** após fim do sync, quantificar quanto valor
de transferência será filtrado pela lógica nova. Provavelmente os totais
de Receita e Despesa vão cair — explicar que é correção, não erro novo.

### Pagamento Parcial — 3 gaps identificados (aguardando correção)

3 registros em `ca.contas_pagar` com status `'Parcial'`:

| Descrição | Total | Pago | Aberto | Competência | Vencimento |
|---|---|---|---|---|---|
| 2/10 - Remuneração \| Transporte | R$ 3.500,65 | R$ 500,65 | R$ 3.000,00 | 2026-04-18 | 2026-05-01 |
| Remuneração | R$ 5.000,00 | R$ 4.000,00 | R$ 1.000,00 | 2025-10-28 | 2025-11-28 |
| 1/13 - APPWOOT - Ferramenta | R$ 207,73 | R$ 199,00 | R$ 8,73 | 2025-12-31 | 2026-01-25 |

#### Gap 1 — DRE exclui Parcial (R$ 8.708 sumindo do DRE competência)

- **Onde:** `DRE.tsx`, `VisaoGeral.tsx` (KPIs principais), `Metas.tsx`
  (realizado) — todos filtram `situacao === 'Quitado'`
- **Doc diz:** DRE competência deve incluir tudo exceto
  `CANCELADO`/`RENEGOCIADO` — Parcial entra com `valor_total_liquido`
  (o `total`)
- **Impacto:** R$ 8.708,38 a menos nas despesas. Margem do DRE inflada.

#### Gap 2 — Caixa Realizado ignora `valor_pago` de Parcial (R$ 4.699 invisível)

- **Onde:** regime caixa na API filtra `status = 'Quitado'`
- **Doc diz:** Parcial deve entrar no caixa realizado pelo `valor_pago`
  (idealmente pela soma de `baixas[].valor_liquido` na data da baixa)
- **Impacto:** R$ 4.699,65 de saída de caixa real não contabilizada.

#### Gap 3 — Inadimplência ignora `nao_pago` de Parcial vencidos (R$ 1.009–4.009 faltando)

- **Onde:** `VisaoGeral.tsx` card "Atrasados" e `Qualidade.tsx` lista de
  atrasados — filtram `situacao === 'Atrasado'`
- **Doc diz:** inadimplência inclui `RECEBIDO_PARCIAL` com
  `data_vencimento < hoje` e `nao_pago > 0`
- **Impacto:**
  - Remuneração (venceu nov/25): R$ 1.000,00 não aparece
  - APPWOOT (venceu jan/26): R$ 8,73 não aparece
  - Transporte (venceu mai/26): R$ 3.000,00 não aparece
  - Total: R$ 4.008,73 invisível no card de atrasados

**Causa raiz comum dos 3 gaps:** frontend trata Parcial como
"não quitado = não existe", quando o correto é split (parte paga no
realizado, parte aberta no previsto/inadimplência).

---

## Decisões pendentes (aguardando fim do full sync)

### 1. Validar `origem` populado

Após o sync, rodar as queries de validação documentadas na conversa
de hoje:

```sql
-- Cobertura
SELECT
  COUNT(*) AS total,
  COUNT(origem) AS com_origem,
  COUNT(*) FILTER (WHERE origem IS NULL) AS sem_origem
FROM ca.contas_receber;
-- Repetir para contas_pagar

-- Distribuição
SELECT origem, COUNT(*)
FROM ca.contas_receber
GROUP BY origem
ORDER BY 2 DESC;
-- Repetir para contas_pagar

-- Transferências detectadas
SELECT COUNT(*)
FROM ca.contas_receber
WHERE origem IN ('TRANSFERENCIA', 'SALDO_CONTA_BANCARIA');
-- Repetir para contas_pagar
```

**O que olhar:**
- Cobertura deve ser ~100%
- Valores de `origem` fora do enum conhecido (verificar contra seção 1.1
  do doc) — pode indicar que a Conta Azul adicionou novos valores
- Quantidade de transferências capturadas → quanto vai sair dos totais

### 2. Conceito de DRE — competência puro ou Gerencial Conta Azul?

Antes de corrigir o Gap 1, alinhar com Saman:

- **DRE competência puro:** reconhece valor total no fato gerador,
  independente de pagamento. Parcial entra com `total` no mês de
  competência.
- **DRE Gerencial Conta Azul:** híbrido — taxas, descontos, juros e
  perdas seguem regime de caixa. Replica o relatório nativo do Conta
  Azul.

A escolha define a lógica de Parcial e também se vamos usar
`/v1/categorias` (estrutura livre) ou `/v1/financeiro/categorias-dre`
(estrutura DRE padrão Conta Azul) na Fase 3.

### 3. Caixa Realizado — `data_recebimento` aproximada ou consumir `ca.baixas`?

Para corrigir o Gap 2:

- **Opção rápida:** usar `data_recebimento` e `valor_pago` da própria
  tabela `ca.contas_receber/pagar`. Mantém a aproximação atual de ~R$6k
  em meses parciais (já documentada no `types.ts`). Sem refactor.
- **Opção correta:** começar a consumir `ca.baixas` (que o ETL já
  sincroniza mas a API ignora). Cada baixa tem `data_pagamento` e
  `valor_liquido` reais. Refactor maior na API route.

Decidir antes de mexer.

---

## Backlog

### Fase 3 — Hierarquia de Categorias DRE

Hoje `catSup` e `catSup1` chegam sempre vazios ao frontend. DRE e
Comparativo agrupam tudo em "Outros".

Passos esperados (após fim do sync):
1. Decidir endpoint (`/v1/categorias` vs `/v1/financeiro/categorias-dre`)
2. Migration: criar tabela `ca.categorias_dre` no Supabase
3. Adicionar sync no ETL Python
4. Atualizar `app/api/financeiro/route.ts` com JOIN para popular
   `catSup` e `catSup1`
5. Frontend não precisa mudar — DRE e Comparativo voltam a funcionar

### Fase 4 — Polimento

- Adicionar `forma_pagamento` no SELECT da query em
  `app/api/financeiro/route.ts` e expor no tipo TypeScript
- Trocar `r.situacao?.toLowerCase().includes('atraso')` por matching
  exato (`r.situacao === 'Atrasado'`) em `VisaoGeral.tsx` e
  `Qualidade.tsx`
- Avaliar se rateio de Centro de Custo realmente é necessário (depende
  se algum lançamento real do Saman usa rateio múltiplo)

### Refactors maiores (avaliar quando virar prioridade)

- Consumir `ca.baixas` em vez de `data_recebimento` agregado
  (precisão de ~R$6k em meses parciais, conforme nota em `types.ts`)
- Mover refresh de views materializadas para `pg_cron` no Supabase
- Particionamento das tabelas `parcelas` e `baixas` por data caso
  volume passe de ~100k parcelas/mês

---

## Operacional

### ETL

- `FULL_SYNC_START = "2024-12-31"` — histórico disponível só a partir
  dessa data. Alterar manualmente antes de qualquer `--full` que precise
  de período anterior.
- ETL faz UPSERT — rodar `--full` é seguro, atualiza registros
  existentes sem duplicar.
- Rate limit Conta Azul: 600 req/min e 10 req/s **por conta conectada**
  (não mais por aplicação, conforme changelog 2025).
- Não há webhook — toda atualização exige polling
  (`data_alteracao_*` ou endpoint `/alteracoes`).

### Comunicação com Saman

Quando totais do dashboard mudarem após correções, comunicar
proativamente:

1. **Filtro de cancelados (já aplicado):** R$ 90k removidos do período
   mai/25–abr/26. Validar especialmente os R$ 32k de dez/25.
2. **Filtro de transferências (após sync):** quantificar e comunicar
   antes de mostrar os números novos.
3. **Correções de Parcial (após decisão):** explicar o split (parte
   paga em caixa, parte aberta em previsto/inadimplência).
