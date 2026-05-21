# Dashboard Financeiro Saman — Instruções para Claude

> Este arquivo é lido automaticamente pelo Claude Code no início de toda sessão neste repositório. **Não remover, não renomear.**

## Sobre o projeto

Dashboard financeiro que consome a API v1 (nova plataforma `api-v2.contaazul.com/v1/...`) da Conta Azul e sincroniza os dados em um banco PostgreSQL/Supabase próprio para alimentar visões de **Competência** e **Caixa** (realizado + previsto).

**Stack:** Next.js 15 · Supabase (Postgres + SSR) · Tailwind · shadcn/ui · React 19

## ⚠️ REGRAS OBRIGATÓRIAS — leia antes de tocar em qualquer código financeiro

Antes de criar uma tela nova, modificar um campo, escrever uma query, criar uma view, alterar uma migration ou sugerir um filtro **que envolva qualquer dado financeiro** (receita, despesa, parcela, baixa, venda, NF, fluxo de caixa, DRE, inadimplência, contas a pagar/receber, conciliação), **você DEVE primeiro abrir e consultar**:

```
docs/conta-azul-api-guia.md
```

Esse documento é a fonte da verdade sobre:
- quais campos da API v1 representam **competência** (`data_competencia`)
- quais representam **caixa previsto** (`data_vencimento`)
- quais representam **caixa realizado** (`baixas[].data_pagamento`)
- enums de status (`PENDENTE`, `QUITADO`, `RECEBIDO_PARCIAL`, `ATRASADO`, `CANCELADO`, `RENEGOCIADO`, `PERDIDO`)
- armadilhas conhecidas (duplicidade venda+parcela, renegociações, transferências, pagamentos parciais, NFS-e com competência ≠ emissão)
- receitas SQL prontas para cada visão do dashboard
- índices e views materializadas recomendados

## Checklist obrigatório antes de gerar código financeiro

- [ ] Li a seção relevante de `docs/conta-azul-api-guia.md`?
- [ ] A query/filtro está na granularidade de **parcela** (não de venda nem de NF)?
- [ ] Excluí `status IN ('CANCELADO', 'RENEGOCIADO')` dos somatórios de DRE?
- [ ] Excluí `origem IN ('TRANSFERENCIA', 'SALDO_CONTA_BANCARIA')` do DRE e do fluxo de caixa consolidado?
- [ ] Para caixa realizado, estou usando `baixas[].data_pagamento` e não `parcelas.data_pagamento_previsto`?
- [ ] Para pagamentos parciais (`RECEBIDO_PARCIAL`), estou tratando `valor_pago` no realizado e `nao_pago` no previsto separadamente?
- [ ] Se a tela mostra NFS-e, lembrei que a `data_competencia` em notas tomadas pode ser o dia 1 do mês (artificial)?

## Convenções do projeto

- Nomes de campos no banco: **snake_case em português**, espelhando a API (`data_competencia`, `data_vencimento`, `valor_total_liquido`, `nao_pago`).
- Status sempre como `text` com `CHECK constraint` listando os enums válidos.
- Toda view de dashboard é **materialized view** com refresh agendado via `pg_cron` (Supabase).
- Datas: `date` para `data_competencia`, `data_vencimento`, `data_pagamento`. `timestamptz` para `data_alteracao`, `atualizado_em`.
- Joins financeiros sempre passam por `parcelas → eventos_financeiros` (nunca direto em vendas).

## O que NÃO fazer

- ❌ Somar valor de vendas + valor de parcelas (dupla contagem garantida).
- ❌ Usar `valor_total_nfse` como base de DRE (impostos retidos distorcem).
- ❌ Filtrar caixa realizado por `parcelas.status = 'QUITADO'` sem olhar `baixas[].data_pagamento` (a data da quitação não está na parcela, está na baixa).
- ❌ Esquecer de filtrar `status != 'CANCELADO'` em qualquer somatório.
- ❌ Confundir `data_pagamento_previsto` (planejamento) com `baixas[].data_pagamento` (efetivo).
- ❌ Assumir que existe webhook da Conta Azul — não existe; toda sincronização é via polling com `data_alteracao_de`/`data_alteracao_ate` ou via `/v1/financeiro/eventos-financeiros/alteracoes`.
- ❌ Estourar o rate limit: 600 req/min e 10 req/s por conta conectada do ERP.

## Quando estiver em dúvida

Se o documento `docs/conta-azul-api-guia.md` não cobrir o caso, **pare e pergunte ao Felipe antes de inventar**. Decisões sobre regime contábil (competência vs caixa em itens específicos como juros, descontos, perdas) podem afetar o relatório oficial e devem ser validadas.

## ETL — onde está o log real

O ETL roda em **GitHub Actions de hora em hora** em produção. 
Logs reais estão no histórico de runs do Actions, não no repo.

⚠️ O arquivo `etl_run.log` na raiz é HISTÓRICO LOCAL antigo — pode 
conter erros (ex: invalid_grant) que NÃO refletem o estado de produção. 
Ignore esse arquivo em qualquer análise de saúde do ETL.

Para verificar saúde real do ETL, consulte:
- ca.sync_log (tabela de log de cada sincronização)
- ca.contas_financeiras.synced_at (timestamp da última atualização)
- GitHub Actions → workflow de sync

## Setup de worktree pra testes locais

Worktrees criados não herdam `.env.local`. Pra testar localmente:

```bash
cp ../<main-checkout>/.env worktree/.env.local
```

Depois rode `npm run dev`. O bypass de auth dev é controlado por 
[nome da flag — você confirma qual é]. Quando ativado, dashboard 
abre sem login Google.
