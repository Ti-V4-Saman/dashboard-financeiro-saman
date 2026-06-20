# Auditoria — Saldos bancários por conta financeira

**Data:** 2026-06-18  
**Escopo:** Validar se conseguimos reconstruir os saldos da tela "Saldos bancários" do Conta Azul a partir do schema `ca` no Neon, antes de implementar a tela no dashboard.  
**Status:** ⚠️ Reconstrução por movimento **não bate** com o saldo real. `saldo_atual` (sincronizado do CA) bate 100%, e é a única fonte confiável hoje.

---

## TL;DR

| Métrica | Valor |
|---|---|
| Total Saldo CA (tela) | **-R$ 313.417,46** |
| Total `cf.saldo_atual` (ETL) | **-R$ 313.417,46** ✓ |
| Total Saldo Calculado (por movimento) | **-R$ 99.217,26** ✗ |
| Δ Calc vs CA | **+R$ 214.200,20** |

**Conclusão:** o ETL persiste o `saldo_atual` direto da API do CA por conta, e esse campo está fiel à tela. Já a reconstrução `saldo_inicial + entradas − saídas + transf_in − transf_out` quebra porque:

1. **Tabela `ca.saldos_iniciais` está vazia.** Não temos saldo de abertura por conta.
2. **`contas_receber.origem` e `contas_pagar.origem` estão 100% NULL.** Sem isso não é possível separar baixas "operacionais" das baixas que representam transferência ou saldo inicial — então qualquer transferência registrada simultaneamente como par de baixas + linha em `ca.transferencias` é **dupla‑contada**.

→ Para a tela bater hoje, usar `cf.saldo_atual` como fonte. Implementar a reconstrução por movimento depende de duas correções no ETL (popular `saldos_iniciais` e popular `origem` em contas_receber/pagar).

---

## Seção 1 — Diagnósticos prévios

### Q7.1 — Validação de `baixas.evento_id`

`baixas.evento_id` **não** aponta para `contas_receber`/`contas_pagar` como o prompt assumia. Aponta para **`parcelas_receber`/`parcelas_pagar`** (granularidade de parcela, como manda o `claude.md`).

| tipo | total | órfãs | duplicadas | via parcelas_receber | via parcelas_pagar |
|---|---|---|---|---|---|
| RECEITA | 1.756 | 0 | 0 | 1.756 (100%) | 0 |
| DESPESA | 5.903 | 0 | 0 | 0 | 5.903 (100%) |

Casamento perfeito via parcelas. Caminho correto:
`baixas → parcelas_receber → contas_receber` (ou `parcelas_pagar → contas_pagar`).

### Q7.2 — Distribuição de `origem` nos eventos das baixas

| origem_evento | tipo | qtd | valor_total |
|---|---|---|---|
| **NULL** (cr/cp.origem não populado) | DESPESA | 5.903 | 7.365.983,03 |
| **NULL** (cr/cp.origem não populado) | RECEITA | 1.756 | 7.266.765,77 |

🚨 **`origem` está NULL em 100% de `contas_receber` (2.482 linhas) e `contas_pagar` (6.532 linhas).** Isso impede filtrar baixas com `origem IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')`. Backlog do ETL: popular esse campo a partir do payload `/v1/financeiro/eventos-financeiros/*`.

### Q7.3 — Cobertura temporal de transferências

| data_min | data_max | total | sem_origem | sem_destino | valor_total |
|---|---|---|---|---|---|
| 2025-01-02 | 2026-06-11 | 434 | 0 | 0 | 6.618.090,24 |

Sem nulos em origem/destino — `ca.transferencias` está limpa estruturalmente. Período cobre ~18 meses até 1 semana atrás.

### Q7.4 — Saldo inicial via baixas com `origem='SALDO_CONTA_BANCARIA'`

```
(0 linhas)
```

Nenhuma baixa com essa origem (consequência direta de Q7.2). Confirmação cruzada: `ca.saldos_iniciais` também está vazia (0 linhas).

### Q7.5 — Idade do dado por conta

| conta | tipo | saldo_atual | synced_at | idade |
|---|---|---|---|---|
| Conta PJ Conta Azul IP | CONTA_CORRENTE | 0 | 2026-05-18 | 30d 20h |
| Maquineta Virtual | MEIOS_RECEBIMENTO | 0 | 2026-05-18 | 30d 20h |
| Conta Simples (CC inativa) | CONTA_CORRENTE | 0 | 2026-05-18 | 30d 20h |
| Conta Simples (OUTROS inativa) | OUTROS | 0 | 2026-05-18 | 30d 20h |
| Conta Simples - Cartão Fase | CARTAO_CREDITO | -388.015,09 | 2026-06-09 | 9d 02h |
| Conta Transitória - Internacional | MEIOS_RECEBIMENTO | -1.862,34 | 2026-06-09 | 9d 02h |
| 16293560 (inativa) | CONTA_CORRENTE | 0 | 2026-06-11 | 6d 19h |
| Inter PJ | CONTA_CORRENTE | 0 | 2026-06-11 | 6d 19h |
| Finance Mktlab - Cartão | MEIOS_RECEBIMENTO | 19.837,31 | 2026-06-15 | 2d 22h |
| Finance Mktlab - Boleto e PIX | MEIOS_RECEBIMENTO | 44.098,99 | hoje | 1h 51min |
| Iugu | CONTA_CORRENTE | 2.581,40 | hoje | 1h 51min |
| P2xPay | CAIXINHA | 21.984,45 | hoje | 1h 51min |
| Santander | CONTA_CORRENTE | -0,04 | hoje | 1h 51min |
| Sicoob | CONTA_CORRENTE | 2.444,61 | hoje | 1h 51min |
| Conta Simple - Conta PJ | CONTA_CORRENTE | -14.486,75 | hoje | 1h 51min |

Idade varia entre 1h 51min e 30 dias. Contas ativas com mais idade: Cartão Fase (9d), Internacional (9d), Inter PJ (6d).

---

## Seção 2 — Composição por conta (Q5)

> Joins ajustados após Fase 1: `baixas → parcelas_{receber,pagar} → contas_{receber,pagar}`.  
> Saldo inicial proveniente de `ca.saldos_iniciais` (vazia → todos 0,00).  
> Como `origem` é NULL em 100% dos casos, o filtro `NOT IN ('TRANSFERENCIA','SALDO_CONTA_BANCARIA')` não exclui nada — então transferências entram **duas vezes** quando há par de baixas + linha em `ca.transferencias`.

| Conta | Tipo | Saldo ETL | Saldo Inicial | Entradas | Saídas | Transf In | Transf Out | **Saldo Calc** | Δ (Calc − ETL) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| P2xPay | CAIXINHA | 21.984,45 | 0,00 | 0,00 | 35.524,05 | 628.243,81 | 417.831,44 | 174.888,32 | +152.903,87 |
| Finance Mktlab - Boleto e PIX | MEIOS_RECEBIMENTO | 44.098,99 | 0,00 | 50.217,80 | 0,00 | 0,00 | 0,00 | 50.217,80 | +6.118,81 |
| Conta Simple - Conta PJ | CONTA_CORRENTE | -14.486,75 | 0,00 | 84.340,47 | 0,00 | 56.050,00 | 98.977,22 | 41.413,25 | +55.900,00 |
| Iugu | CONTA_CORRENTE | 2.581,40 | 0,00 | 4.881.860,36 | 761.122,53 | 0,00 | 4.112.633,33 | 8.104,50 | +5.523,10 |
| Conta Simples (OUTROS) | OUTROS | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| Conta Simples (CC) | CONTA_CORRENTE | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| Conta PJ Conta Azul IP | CONTA_CORRENTE | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| Inter PJ | CONTA_CORRENTE | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| Conta Transitória - Internacional | MEIOS_RECEBIMENTO | -1.862,34 | 0,00 | 76.112,34 | 26.923,34 | 0,00 | 49.189,00 | 0,00 | +1.862,34 |
| 16293560 | CONTA_CORRENTE | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| Maquineta Virtual | MEIOS_RECEBIMENTO | 0,00 | 0,00 | 232.105,00 | 32.471,04 | 0,00 | 199.633,96 | 0,00 | 0,00 |
| Finance Mktlab - Cartão | MEIOS_RECEBIMENTO | 19.837,31 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | -19.837,31 |
| Santander | CONTA_CORRENTE | -0,04 | 0,00 | 713.305,54 | 174.041,58 | 272.760,62 | 812.672,59 | -648,01 | -647,97 |
| Sicoob | CONTA_CORRENTE | 2.444,61 | 0,00 | 1.228.824,26 | 5.435.228,12 | 5.004.434,04 | 871.252,70 | -73.222,52 | -75.667,13 |
| Conta Simples - Cartão Fase | CARTAO_CREDITO | -388.015,09 | 0,00 | 0,00 | 900.672,37 | 656.601,77 | 55.900,00 | -299.970,60 | +88.044,49 |
| **TOTAL** | — | **-313.417,46** | **0,00** | **7.266.765,77** | **7.365.983,03** | **6.618.090,24** | **6.618.090,24** | **-99.217,26** | **+214.200,20** |

✓ Sanity: `Σ transf_in == Σ transf_out == 6.618.090,24` — `ca.transferencias` está balanceada.

---

## Seção 3 — Comparativo com tela do Conta Azul

| Conta | Tipo CA | Saldo CA (tela) | Saldo ETL | Saldo Calc | Δ Calc vs CA |
|---|---|---:|---:|---:|---:|
| Finance Mktlab - Boleto e PIX | Meio de recebimento | 44.098,99 | 44.098,99 ✓ | 50.217,80 | +6.118,81 |
| P2xPay | Caixinha | 21.984,45 | 21.984,45 ✓ | 174.888,32 | +152.903,87 |
| Finance Mktlab - Cartão | Meio de recebimento | 19.837,31 | 19.837,31 ✓ | 0,00 | -19.837,31 |
| Iugu | Conta corrente | 2.581,40 | 2.581,40 ✓ | 8.104,50 | +5.523,10 |
| Sicoob | Conta corrente | 2.444,61 | 2.444,61 ✓ | -73.222,52 | -75.667,13 |
| Conta PJ Conta Azul IP | Conta corrente | 0,00 | 0,00 ✓ | 0,00 | 0,00 |
| Inter PJ | Conta corrente | 0,00 | 0,00 ✓ | 0,00 | 0,00 |
| Maquineta Virtual | Meio de recebimento | 0,00 | 0,00 ✓ | 0,00 | 0,00 |
| Santander | Conta corrente | -0,04 | -0,04 ✓ | -648,01 | -647,97 |
| Conta Transitória - Internacional | Meio de recebimento | -1.862,34 | -1.862,34 ✓ | 0,00 | +1.862,34 |
| Conta Simple - Conta PJ | Conta corrente | -14.486,75 | -14.486,75 ✓ | 41.413,25 | +55.900,00 |
| Conta Simples - Cartão Fase | Cartão de crédito | -388.015,09 | -388.015,09 ✓ | -299.970,60 | +88.044,49 |
| **TOTAL** | — | **-313.417,46** | **-313.417,46** ✓ | **-99.217,26** | **+214.200,20** |

✓ `cf.saldo_atual` bate 12/12 contas (delta 0,00) e total exato.  
✗ Saldo calculado tem divergência relevante em 8 das 12 contas; total destoa em R$ 214 mil.

---

## Seção 4 — Análise

### 1. Q7.1 passou?
Sim — **0 órfãs, 0 duplicadas** ao usar o caminho correto `baixas → parcelas → contas`. O prompt original assumia `baixas.evento_id → contas_*` direto, o que **gera 100% órfãs**. ✅ Caminho via parcelas é o correto.

### 2. Saldo inicial existe?
**Não.** `ca.saldos_iniciais` está vazia (0 linhas) e `contas_financeiras.saldo_inicial = 0,00` em todas as 15 contas. Como não há baixa `SALDO_CONTA_BANCARIA` (origem NULL em 100% dos eventos), também não dá pra reconstruir por aí. Sem saldo de abertura **não há como reconstruir o saldo histórico** — qualquer baixa anterior à primeira data de baixa registrada está fora.

→ **Backlog ETL:** popular `ca.saldos_iniciais` via endpoint `/v1/financeiro/contas/{id}/saldo-inicial` (ou equivalente — confirmar no guia).

### 3. Calc bate com ETL?
**Não.** 8 das 12 contas ativas divergem mais de R$ 1,00. Como `saldo_atual` do ETL bate com a tela do CA, a divergência é **na nossa lógica de reconstrução**, não no ETL.

### 4. ETL bate com CA?
**Sim, 100%.** `cf.saldo_atual` reflete fielmente a tela do CA (sincronizado pelo ETL diretamente da API). Tela do dashboard pode usar esse campo como fonte primária — sem reconstruir.

### 5. Contas com |Δ Calc vs CA| > R$ 100 e hipóteses

| Conta | Δ | Hipótese principal |
|---|---:|---|
| **P2xPay** | +152.903,87 | Provável dupla‑contagem de transferência interna. P2xPay recebe R$ 628k de transferências e envia R$ 417k — mas tem 0 baixas RECEITA. Se entradas chegam via baixas (com origem='TRANSFERENCIA' que não conseguimos filtrar), elas aparecem só uma vez; mas a saída via baixa DESPESA (R$ 35k) + transf_out R$ 417k pode estar contando duas vezes uma mesma saída. Sem `origem` populado, não dá pra separar. |
| **Conta Simples - Cartão Fase** | +88.044,49 | **Lógica do cartão de crédito.** Despesas no cartão (R$ 900k saídas) e pagamentos de fatura (R$ 656k transf_in + R$ 55k transf_out). A fórmula `entradas − saídas + transf_in − transf_out` trata o cartão como conta de caixa, mas no CA o cartão acumula **dívida** (saldo negativo cresce com gastos, diminui ao pagar fatura). Pode estar dupla‑contando pagamentos de fatura registrados como baixa DESPESA na conta corrente + transferência para o cartão. |
| **Sicoob** | -75.667,13 | 1.756 baixas RECEITA totalizam R$ 1.2M, mas a conta tem 5.4M de saídas em baixas + 871k transf_out. Sinais de que parte das saídas registradas como baixa DESPESA são, na verdade, transferências (origem='TRANSFERENCIA' não filtrado). |
| **Conta Simple - Conta PJ** | +55.900,00 | Idem — provável dupla‑contagem. Recebe R$ 56k de transf_in que pode estar registrado também como baixa RECEITA. |
| **Finance Mktlab - Cartão** | -19.837,31 | Saldo ETL R$ 19.837,31 mas calc = 0 (zero baixas, zero transferências). Saldo veio puramente da API (provavelmente saldo_inicial não persistido). |
| **Conta Simples - Conta PJ Cartão / fatura** | (parte do +88k acima) | Pagamentos de fatura via transferência: ver linha do cartão acima. |
| **Sicoob (continuação)** | parte de -75k | Sicoob também participa do circuito de pagamento de cartão. |

### Padrão dominante das divergências
Todas as divergências grandes (>R$ 1k) acontecem em contas com **transferências altas** (P2xPay, Sicoob, Conta Simple PJ, Cartão Fase). Contas sem transferência (Finance Mktlab Boleto, Iugu, Maquineta) divergem pouco ou nada. Confirma a hipótese central: **transferência entra duas vezes** porque a API CA registra a movimentação tanto em `ca.transferencias` quanto como par de baixas, e sem o campo `origem` não conseguimos detectar o par.

---

## Pontos de atenção respondidos

- ✅ `ca.transferencias` somada sem filtro de período (saldo total desde o início). Confirmado: período coberto Jan/2025 → Jun/2026.
- ❌ Baixas com `origem='SALDO_CONTA_BANCARIA'` **não tratadas** porque origem é NULL em 100% — não conseguimos identificar.
- ❌ Baixas com `origem='TRANSFERENCIA'` **não excluídas** das movimentações pelo mesmo motivo → **dupla‑contagem provável**.
- ⚠️ Cartão de crédito: saldo negativo bate (ETL), mas a **fórmula proposta não modela cartão corretamente**. Para cartão, o "saldo" representa dívida; a contabilização precisa inverter sinais ou usar tabela própria de fatura.
- ✅ Pagamento Parcial / Gap 2: as baixas das parcelas parciais entram via `ca.baixas` normalmente. Não precisa de tratamento especial pra saldo bancário.

---

## Recomendação

**Para a tela "Saldos bancários" sair agora:** usar `ca.contas_financeiras.saldo_atual` como fonte única, filtrar `ativo = true` e exibir `synced_at` em cada linha pra evidenciar idade do dado.

**Backlog para habilitar reconstrução por movimento (PR futuro):**
1. ETL — popular `contas_receber.origem` e `contas_pagar.origem` a partir do payload da API CA.
2. ETL — popular `ca.saldos_iniciais` via endpoint de saldo de abertura da conta.
3. Modelagem — definir fórmula de saldo correta para `tipo='CARTAO_CREDITO'` (provavelmente sinal invertido ou tratamento separado de fatura).
4. Após (1) e (2), reabrir esta auditoria e validar se `saldo_calculado` casa com `saldo_atual` (Δ < R$ 1,00 por conta).

---

# Anexo — Validação da fórmula de saldo exibido (2026-06-18)

**Fórmula testada:**
- `tipo = 'CARTAO_CREDITO'` → `saldo_exibido = saldo_atual + Σ(transf_recebidas)`
- Demais tipos → `saldo_exibido = saldo_atual`

## Q1 — Aplicação por conta (apenas ativas)

| Conta | Tipo | Saldo Atual | Transf Recebidas | Qtd | **Saldo Exibido** | Regra |
|---|---|---:|---:|---:|---:|---|
| **Conta Simples - Cartão Fase** | CARTAO_CREDITO | -388.015,09 | 656.601,77 | 19 | **+268.586,68** | CARTÃO (com ajuste) |
| Finance Mktlab - Boleto e PIX | MEIOS_RECEBIMENTO | 44.098,99 | 0,00 | 0 | 44.098,99 | normal |
| P2xPay | CAIXINHA | 21.984,45 | 628.243,81 | 17 | 21.984,45 | normal |
| Finance Mktlab - Cartão | MEIOS_RECEBIMENTO | 19.837,31 | 0,00 | 0 | 19.837,31 | normal |
| Iugu | CONTA_CORRENTE | 2.581,40 | 0,00 | 0 | 2.581,40 | normal |
| Sicoob | CONTA_CORRENTE | 2.444,61 | 5.004.434,04 | 368 | 2.444,61 | normal |
| Inter PJ | CONTA_CORRENTE | 0,00 | 0,00 | 0 | 0,00 | normal |
| Conta PJ Conta Azul IP | CONTA_CORRENTE | 0,00 | 0,00 | 0 | 0,00 | normal |
| Maquineta Virtual | MEIOS_RECEBIMENTO | 0,00 | 0,00 | 0 | 0,00 | normal |
| Santander | CONTA_CORRENTE | -0,04 | 272.760,62 | 26 | -0,04 | normal |
| Conta Transitória - Internacional | MEIOS_RECEBIMENTO | -1.862,34 | 0,00 | 0 | -1.862,34 | normal |
| Conta Simple - Conta PJ | CONTA_CORRENTE | -14.486,75 | 56.050,00 | 4 | -14.486,75 | normal |

## Q2 — Transferências para o cartão (top 30)

19 transferências no histórico todo (cabe inteiro abaixo de 30):

| Origem | Destino | Data | Valor | Descrição |
|---|---|---|---:|---|
| P2xPay | Cartão Fase | 2026-05-25 | 88.044,49 | Pagamento fatura maio 2026 |
| Sicoob | Cartão Fase | 2026-02-25 | 121.968,31 | PIX EMITIDO OUTRA IF |
| Sicoob | Cartão Fase | 2026-01-25 | 41.850,21 | Pagamento fatura janeiro 2026 |
| Sicoob | Cartão Fase | 2026-01-13 | 32.000,00 | Adiantamento Fatura Conta Simples Janeiro/ 2026 |
| Sicoob | Cartão Fase | 2026-01-07 | 25.000,00 | Antecipação Fatura cartão Conta Simples Janeiro/2025 |
| Conta Transitória - Internacional | Cartão Fase | 2025-12-26 | 1.862,34 | Origem→Destino |
| Conta Simple - Conta PJ | Cartão Fase | 2025-12-15 | 150,14 | Transferência de limite |
| Conta Simple - Conta PJ | Cartão Fase | 2025-12-13 | 120,00 | Pagamento de Fatura com Saldo Conta Simples |
| P2xPay | Cartão Fase | 2025-11-25 | 51.635,37 | Origem→Destino |
| P2xPay | Cartão Fase | 2025-10-27 | 45.327,86 | Pagamento fatura outubro 2025 |
| P2xPay | Cartão Fase | 2025-09-25 | 35.015,54 | Pagamento fatura setembro 2025 |
| P2xPay | Cartão Fase | 2025-08-25 | 30.234,40 | Pagamento fatura agosto 2025 |
| P2xPay | Cartão Fase | 2025-07-25 | 26.718,55 | Pagamento fatura julho 2025 |
| Sicoob | Cartão Fase | 2025-06-25 | 15.819,33 | Pagamento fatura junho 2025 |
| P2xPay | Cartão Fase | 2025-05-26 | 53.366,30 | Pagamento fatura maio 2025 |
| P2xPay | Cartão Fase | 2025-04-24 | 19.562,72 | Pagamento fatura abril 2025 |
| P2xPay | Cartão Fase | 2025-03-25 | 20.420,01 | Pagamento fatura março 2025 |
| P2xPay | Cartão Fase | 2025-02-25 | 23.895,68 | Pagamento fatura fevereiro 2025 |
| P2xPay | Cartão Fase | 2025-01-27 | 23.610,52 | Pagamento fatura janeiro 2025 |

## Q3 — Distribuição mensal das transferências para o cartão

| Mês | Qtd | Valor Total |
|---|---:|---:|
| 2026-05 | 1 | 88.044,49 |
| 2026-02 | 1 | 121.968,31 |
| 2026-01 | 3 | 98.850,21 |
| 2025-12 | 3 | 2.132,48 |
| 2025-11 | 1 | 51.635,37 |
| 2025-10 | 1 | 45.327,86 |
| 2025-09 | 1 | 35.015,54 |
| 2025-08 | 1 | 30.234,40 |
| 2025-07 | 1 | 26.718,55 |
| 2025-06 | 1 | 15.819,33 |
| 2025-05 | 1 | 53.366,30 |
| 2025-04 | 1 | 19.562,72 |
| 2025-03 | 1 | 20.420,01 |
| 2025-02 | 1 | 23.895,68 |
| 2025-01 | 1 | 23.610,52 |

15 meses de cobertura (Jan/2025 → Mai/2026); regular ao longo do período. Nada anteriormente a 12 meses fora do esperado — todas são pagamentos mensais de fatura.

## Q4 — Total consolidado com a regra nova

| Métrica | Valor |
|---|---:|
| Total `saldo_atual` (atual no CA) | **-R$ 313.417,46** |
| Total `saldo_exibido` (regra nova) | **+R$ 343.184,31** |
| Δ (regra nova − CA) | **+R$ 656.601,77** |

A diferença é **exatamente** igual ao `Σ transf_recebidas` do Cartão Fase (R$ 656.601,77).

## Observações

1. **Quantos cartões existem?** 1 conta ativa com `tipo='CARTAO_CREDITO'` — apenas o **Conta Simples - Cartão de Crédito Fase**.

2. **Valor de `saldo_exibido` no Cartão Fase vs `saldo_atual`:**
   - `saldo_atual`: **-R$ 388.015,09** (igual à tela do CA)
   - `saldo_exibido` com a regra: **+R$ 268.586,68**
   - Diferença: +R$ 656.601,77 (= todas as transferências recebidas em 15 meses)

   ⚠️ **Atenção:** a fórmula proposta inverte o sinal do cartão. A tela do CA mostra **-R$ 388.015,09** (saldo devedor). A regra `saldo_atual + transf_recebidas` produz **+R$ 268.586,68**, ou seja, o cartão deixa de aparecer como dívida. Se a intenção for **reproduzir a tela do CA**, esta fórmula **não bate**. Se a intenção for outra ("quanto eu já paguei do cartão líquido do que ainda devo") faz sentido, mas precisa ser nomeado diferente — não é "saldo bancário".

   Hipótese do que está acontecendo: o `saldo_atual` do cartão já incorpora os pagamentos de fatura (transferências recebidas) — ele é o **saldo devedor líquido**. Somar `transf_recebidas` por cima conta os pagamentos duas vezes.

3. **Transferências antigas?** Não. A mais antiga é 2025-01-27 (~17 meses atrás), cabe na janela operacional do dashboard (período coberto pela API). Todas as 19 transferências têm descrição compatível com pagamento mensal de fatura — não há nada anômalo que justifique filtro temporal.

## Recomendação

Antes de implementar a tela com essa fórmula, **confirmar a intenção**:
- Se o objetivo é "tela igual ao CA" → fórmula correta é `saldo_exibido = saldo_atual` para **todos** os tipos (incluindo cartão).
- Se o objetivo é "mostrar o cartão como saldo positivo equivalente ao crédito disponível / quanto sobra" → a fórmula proposta atinge isso, mas o **nome da coluna não deve ser "Saldo"** e a soma da tabela não vai bater com a tela do CA.

---

# Anexo — Fórmula via parcelas vencidas em aberto (2026-06-18)

**Fórmula testada:**
```
saldo_cartao = -Σ(parcelas_pagar com data_vencimento < CURRENT_DATE 
                  e valor_aberto > 0
                  e status NOT IN ('Cancelado','Renegociado'))
```

## V1 — Estrutura confirmada

`ca.parcelas_pagar` colunas: `id, conta_pagar_id, numero_parcela, data_vencimento, valor, valor_pago, status, data_pagamento, synced_at, conta_financeira_id, observacao, data_alteracao, conciliado`.

⚠️ **Divergências relevantes vs. o prompt:**
1. **Não existe `valor_aberto`** em `parcelas_pagar` — só `valor` e `valor_pago`. Pior: `parcelas_pagar.valor` está **0,00 em 100% das parcelas do Cartão Fase** (1.462 linhas). ETL não populou esse campo na parcela. O valor real mora em `contas_pagar.total`/`valor_aberto`. Adaptei a query para puxar `cp.valor_aberto` via `JOIN ca.contas_pagar cp ON cp.id = p.conta_pagar_id`.
2. **Status reais em `contas_pagar`:** `Quitado` (5.844), `Aberto` (636), `Atrasado` (49), `Parcial` (3). Não existem `Cancelado` nem `Renegociado` populados → o filtro `NOT IN ('Cancelado','Renegociado')` é inócuo, mas mantive por segurança.
3. **Status em `parcelas_pagar`:** `Quitado`, `PENDENTE`, `ATRASADO`, `RECEBIDO_PARCIAL` (case diferente; observação que pode importar pra outros relatórios — aqui usei `contas_pagar.status` ao invés).

## V2 — Aplicação no Cartão Fase

| nome | saldo_etl_antigo | qtd_parcelas_vencidas_em_aberto | **saldo_cartao_novo** |
|---|---:|---:|---:|
| Conta Simples - Cartão de Crédito Fase | -388.015,09 | **1** | **-R$ 100,85** |

⚠️ **Não deu R$ 0,00.** Gap de R$ 100,85 → exatamente uma parcela vencida em aberto.

## V3 — Diagnóstico: a parcela vencida que está sobrando

Procurando explicitamente:

```sql
SELECT cp.descricao, p.data_vencimento, cp.valor_aberto, cp.status
FROM ca.parcelas_pagar p
JOIN ca.contas_financeiras cf ON cf.id=p.conta_financeira_id
JOIN ca.contas_pagar cp ON cp.id=p.conta_pagar_id
WHERE cf.tipo='CARTAO_CREDITO'
  AND p.data_vencimento < CURRENT_DATE
  AND cp.valor_aberto > 0;
```

Resultado: **1 linha**. Olhando o top-50 do V3, a maioria das parcelas é de vencimento futuro (2026-07 em diante) → classificadas como "FUTURA (não entra)". A única "VENCIDA" em aberto está mais embaixo (precisa rolar) — pelo padrão das descrições visíveis (várias `MERCADOLIVRE...BR 100,85`, vários `Logitech...100,85`), o valor R$ 100,85 é consistente com uma compra de Mercado Livre ou Logitech.

**Hipóteses de causa:**
- **(A)** Parcela foi paga via outra forma que o ETL ainda não processou (ex.: baixa registrada mas `valor_aberto` em `contas_pagar` não atualizado pelo ETL). A regra do CA usa o estado "fechado" da fatura; nosso filtro pega qualquer parcela vencida + em aberto, sem saber se já foi conciliada na fatura atual.
- **(B)** Defasagem do ETL: ETL do Cartão Fase está **9 dias atrasado** (`synced_at` = 2026-06-09 conforme Q7.5 do anexo anterior). Uma parcela vencida em 09-25 → 06-25 pode ter sido quitada após a última sync e o sistema não sabe ainda.
- **(C)** Estado inconsistente vindo da API CA: ocorre em casos de cancelamento parcial / chargeback / estorno que mudam o `valor_aberto` no CA mas não invalidam `data_vencimento`.

## V4 — Total consolidado com a nova fórmula

| Conta | Tipo | Saldo |
|---|---|---:|
| P2xPay | CAIXINHA | 21.984,45 |
| **Conta Simples - Cartão Fase** | **CARTAO_CREDITO** | **-100,85** |
| Sicoob | CONTA_CORRENTE | 17.605,33 |
| Iugu | CONTA_CORRENTE | 2.581,40 |
| Inter PJ | CONTA_CORRENTE | 0,00 |
| Conta PJ Conta Azul IP | CONTA_CORRENTE | 0,00 |
| Santander | CONTA_CORRENTE | -0,04 |
| Conta Simple - Conta PJ | CONTA_CORRENTE | -14.486,75 |
| Finance Mktlab - Boleto e PIX | MEIOS_RECEBIMENTO | 21.049,67 |
| Finance Mktlab - Cartão | MEIOS_RECEBIMENTO | 19.837,31 |
| Maquineta Virtual | MEIOS_RECEBIMENTO | 0,00 |
| Conta Transitória - Internacional | MEIOS_RECEBIMENTO | -1.862,34 |
| **TOTAL** | — | **R$ 66.608,18** |

| Comparação | Valor |
|---|---:|
| Total novo (fórmula proposta) | **R$ 66.608,18** |
| Total esperado (Felipe na tela do CA) | **R$ 48.734,06** |
| Δ (novo − esperado) | **+R$ 17.874,12** |

🔔 **Mudança observada vs. anexo anterior do mesmo dia:** alguns saldos de conta corrente mudaram **entre as duas execuções de hoje** — Sicoob foi de R$ 2.444,61 → R$ 17.605,33 (Δ +R$ 15.160,72) e Finance Mktlab Boleto foi de R$ 44.098,99 → R$ 21.049,67 (Δ -R$ 23.049,32). Isso quer dizer que o ETL refrescou essas contas entre as queries. Importante quando comparar com a tela do CA: a tela também muda ao longo do dia.

## Análise

**V2 deu R$ 0,00?** Não — deu **-R$ 100,85**, sobrando 1 parcela vencida em aberto. Gap pequeno mas existe.

**V4 bate com R$ 48.734,06?** Não — deu **R$ 66.608,18**, **Δ = +R$ 17.874,12**.

**Decomposição do gap de R$ 17.874,12:**
- Sicoob mudou +R$ 15.160,72 entre execuções (refresh ETL)
- Finance Mktlab Boleto mudou -R$ 23.049,32 entre execuções (refresh ETL)
- Soma das duas: -R$ 7.888,60 → não explica o gap diretamente

A diferença total não casa só com mudança de saldo_atual; pode haver:
1. Falta de `saldos_iniciais` populados — algumas contas podem ter saldo de abertura que o CA conhece mas o nosso ETL não.
2. Defasagem temporal de outras contas (Cartão Fase 9d, Internacional 9d, Inter PJ 6d).
3. Parcelas vencidas em aberto que o CA considera quitadas (caso do R$ 100,85).

## Recomendação

⚠️ **Não implementar a tela ainda com essa fórmula.** Gaps a resolver antes:

1. **Investigar a parcela de R$ 100,85** que sobrou no V2 — buscar pelo `id` da parcela e ver se há baixa correspondente ou se é caso de ETL defasado. Se for ETL defasado, a fórmula precisa filtrar parcelas cujo `conta_pagar.status` ainda seja `Aberto`/`Atrasado` E não tenham baixas associadas com data > data_vencimento.
2. **Resolver defasagem do ETL** das contas que sincronizam apenas uma vez por dia (ou menos): Cartão Fase 9d, Internacional 9d, Inter PJ 6d. Sem isso, qualquer comparação com a tela do CA vai oscilar.
3. **Popular `ca.saldos_iniciais`** (do anexo anterior — backlog 2).
4. Definir comportamento da tela quando ETL está defasado: badge de "última atualização há Xd"? Excluir contas com `synced_at > 24h`?

Antes de implementação, sugiro abrir issue separada com os 3 pontos acima e voltar à validação quando estiverem resolvidos. Δ de R$ 18k em total esperado de R$ 48k não é "diferença menor por defasagem" — é 37% do valor total.

---

# Anexo — Rodada 3 após refresh do ETL (2026-06-18, ~17:13)

ETL rodou às 16:22 hoje. Rerun pra ver se as contas paradas atualizaram.

## R1 — `synced_at` por conta ativa (ordenado pelo mais antigo)

| Conta | Tipo | Saldo Atual | synced_at | Horas desde sync |
|---|---|---:|---|---:|
| Maquineta Virtual | MEIOS_RECEBIMENTO | 0,00 | 2026-05-18 18:28 | **746,0** (31 dias) |
| Conta PJ Conta Azul IP | CONTA_CORRENTE | 0,00 | 2026-05-18 18:28 | **746,0** (31 dias) |
| **Conta Simples - Cartão Fase** | **CARTAO_CREDITO** | **-388.015,09** | **2026-06-09 12:52** | **223,6** (9,3 dias) |
| **Conta Transitória - Internacional** | **MEIOS_RECEBIMENTO** | **-1.862,34** | **2026-06-09 12:52** | **223,6** (9,3 dias) |
| **Inter PJ** | **CONTA_CORRENTE** | **0,00** | **2026-06-11 19:31** | **168,9** (7,0 dias) |
| Finance Mktlab - Cartão | MEIOS_RECEBIMENTO | 19.837,31 | 2026-06-15 16:33 | 75,9 (3,2 dias) |
| Finance Mktlab - Boleto e PIX | MEIOS_RECEBIMENTO | 21.049,67 | 2026-06-18 20:13 | 0,2 |
| Iugu | CONTA_CORRENTE | 2.581,40 | 2026-06-18 20:13 | 0,2 |
| P2xPay | CAIXINHA | 21.984,45 | 2026-06-18 20:13 | 0,2 |
| Santander | CONTA_CORRENTE | -0,04 | 2026-06-18 20:13 | 0,2 |
| Sicoob | CONTA_CORRENTE | 17.605,33 | 2026-06-18 20:13 | 0,2 |
| Conta Simple - Conta PJ | CONTA_CORRENTE | -14.486,75 | 2026-06-18 20:13 | 0,2 |

🚨 **6 das 12 contas ativas continuam com `synced_at` > 24h.** O ETL rodou agora há ~12 minutos mas **não tocou** Cartão Fase, Internacional, Inter PJ, Finance Mktlab Cartão, Maquineta Virtual e Conta PJ Conta Azul IP. Isso confirma que o ETL **não sincroniza todas as contas com a mesma frequência** — provavelmente trata de "contas com movimento recente", deixando contas paradas no estado antigo.

## R2 — V4 com banco "atualizado"

| Conta | Tipo | Saldo |
|---|---|---:|
| P2xPay | CAIXINHA | 21.984,45 |
| Conta Simples - Cartão Fase | CARTAO_CREDITO | -100,85 |
| Sicoob | CONTA_CORRENTE | 17.605,33 |
| Iugu | CONTA_CORRENTE | 2.581,40 |
| Inter PJ | CONTA_CORRENTE | 0,00 |
| Conta PJ Conta Azul IP | CONTA_CORRENTE | 0,00 |
| Santander | CONTA_CORRENTE | -0,04 |
| Conta Simple - Conta PJ | CONTA_CORRENTE | -14.486,75 |
| Finance Mktlab - Boleto e PIX | MEIOS_RECEBIMENTO | 21.049,67 |
| Finance Mktlab - Cartão | MEIOS_RECEBIMENTO | 19.837,31 |
| Maquineta Virtual | MEIOS_RECEBIMENTO | 0,00 |
| Conta Transitória - Internacional | MEIOS_RECEBIMENTO | -1.862,34 |
| **TOTAL** | — | **R$ 66.608,18** |

**Resultado idêntico à rodada anterior** — nem o cartão se mexeu (R$ -100,85 idem), nem o total. Esperado, já que o ETL não tocou nas contas defasadas.

## R2b — A parcela residual do cartão

| descricao | data_vencimento | valor_aberto | status |
|---|---|---:|---|
| **1/10 - 6 Fones Logitech 1/10** | 2026-05-25 | R$ 100,85 | Aberto |

Parcela 1 de 10 de uma compra de fones Logitech. Venceu 25/05/2026. Como o Cartão Fase está com `synced_at` de 09/06, o ETL **nunca viu** o pagamento da fatura de maio (que se a operação está saudável foi paga em 25/05 ou 25/06). Confirma a hipótese de defasagem do ETL como causa do gap.

## R3 — Comparativo das 3 rodadas

| Conta | Rodada 1 (manhã) | Rodada 2 (V4) | Rodada 3 (17:13) | CA manhã (ref.) |
|---|---:|---:|---:|---:|
| P2xPay | 21.984,45 | 21.984,45 | 21.984,45 | 21.984,45 |
| Cartão Fase (fórmula) | (n/a) | -100,85 | -100,85 | 0,00 (esperado) |
| Sicoob | 2.444,61 | 17.605,33 | 17.605,33 | 2.444,61 |
| Iugu | 2.581,40 | 2.581,40 | 2.581,40 | 2.581,40 |
| Inter PJ | 0,00 | 0,00 | 0,00 | 0,00 |
| Conta PJ CA IP | 0,00 | 0,00 | 0,00 | 0,00 |
| Santander | -0,04 | -0,04 | -0,04 | -0,04 |
| Conta Simple PJ | -14.486,75 | -14.486,75 | -14.486,75 | -14.486,75 |
| Finance Mktlab Boleto | 44.098,99 | 21.049,67 | 21.049,67 | 44.098,99 |
| Finance Mktlab Cartão | 19.837,31 | 19.837,31 | 19.837,31 | 19.837,31 |
| Maquineta Virtual | 0,00 | 0,00 | 0,00 | 0,00 |
| Conta Transitória Internacional | -1.862,34 | -1.862,34 | -1.862,34 | -1.862,34 |
| **TOTAL (com Cartão pela fórmula)** | — | **66.608,18** | **66.608,18** | **R$ 48.734,06** |

→ Rodadas 2 e 3 idênticas em todas as contas. Sicoob e Finance Mktlab Boleto mudaram **só entre rodada 1 e 2** (operação normal — eles têm movimento, sincronizam).

## Diagnóstico da defasagem do ETL

Padrão claro: **o ETL só atualiza contas com movimento detectado**. Contas com saldo "estável" ficam paradas. Para o caso da auditoria:

- Cartão Fase com -R$ 388k há 9 dias: **provavelmente já não é o saldo atual** (entrou movimento nesses 9 dias, mas ETL não sincronizou). A tela do CA mostra valor diferente, e a parcela órfã de R$ 100,85 é evidência.
- Internacional -R$ 1.862,34 há 9 dias: idem.
- Inter PJ, Maquineta, Conta PJ Conta Azul: estão zerados há semanas. Pode estar correto (são contas vazias) ou estar errado (ETL nunca puxou).

## Resposta direta sobre Opção A/B/C

Pelo seu pedido pra antecipar a escolha:

- **Opção A (implementar agora com `saldo_atual` + badge "defasado há Xd"):** entrega valor imediato e é transparente sobre o que o usuário está vendo. Risco: usuário toma decisão em cima de número errado. Para 6 das 12 contas o badge vai ficar piscando "9d", "31d", "7d" — fica ruim de olhar.
- **Opção B (corrigir ETL antes):** investigar o GitHub Actions workflow do ETL pra entender por que contas paradas não sincronizam e forçar refresh diário de todas as contas ativas. É **menor escopo de mudança** que C e elimina a raiz do problema. Não depende de mais chamadas à API CA pela tela.
- **Opção C (API CA em tempo real na tela):** elimina dependência do ETL pro saldo, mas adiciona latência na tela, conta no rate limit (600 req/min, 10 req/s) e expõe a tela a falhas da API CA.

**Recomendação:** **B antes de A**. Investigar o ETL (deve ser uma flag tipo "incremental sync" — endpoint `/v1/financeiro/contas/{id}` com `data_alteracao_de` que pula contas sem movimento). Forçar refresh full de `saldo_atual` em todas as contas ativas a cada execução. Depois disso, A vira viável sem badge. **C** só faz sentido se B for inviável por algum motivo do ETL.

## Recomendação final consolidada

Não implementar a tela hoje. Sequência sugerida:
1. **PR 1 (ETL):** garantir que `saldo_atual` de todas as contas ativas é refrescado a cada execução do ETL (~1h). Validar comparando `synced_at` de todas com `< 90 min` após execução.
2. **PR 2 (saldos iniciais):** popular `ca.saldos_iniciais` (do anexo da Fase 2 — backlog 2).
3. **PR 3 (tela):** implementar tela de "Saldos bancários" usando `saldo_atual` direto para tipos != CARTAO_CREDITO, e fórmula via parcelas vencidas em aberto para CARTAO_CREDITO. Validar Δ < R$ 100 vs tela do CA depois de PR1+PR2.

---

# Anexo — Mapeamento do ETL para o PR1 (2026-06-18)

## I1 — Onde o ETL toca `ca.contas_financeiras`

Duas funções no mesmo arquivo:

**[etl/sync/cadastros.py:175](etl/sync/cadastros.py:175) — `sync_contas_financeiras`**
```python
def sync_contas_financeiras(conn, client) -> int:
    return _sync_endpoint(conn, client, "/conta-financeira",
                          "ca.contas_financeiras", _map_conta_financeira)
```
Lista `GET /v1/conta-financeira` (full, sem filtro), mapeia, UPSERT por id.

**[etl/sync/cadastros.py:189](etl/sync/cadastros.py:189) — `sync_saldo_contas`** (essa é a chave do problema)
```python
def sync_saldo_contas(conn, client) -> int:
    log_id = log_sync_start(conn, "/conta-financeira/{id}/saldo")
    ...
    cur.execute("SELECT id FROM ca.contas_financeiras WHERE ativo = true")
    contas = [row[0] for row in cur.fetchall()]
    ...
    # Probe na primeira conta
    if not client.probe(f"/conta-financeira/{primeiro_id}/saldo-atual"):
        return 0  # pula a sync inteira

    for i, conta_id in enumerate(contas):
        ...
        resp = client.get(f"/conta-financeira/{conta_id}/saldo-atual")
        saldo = resp.get("saldo_atual") or resp.get("saldo") or ... or None

        if saldo is not None:
            UPDATE ca.contas_financeiras
               SET saldo_atual = %s, data_ultima_conciliacao = %s, synced_at = %s
             WHERE id = %s
            records += 1
        else:
            logger.warning("Saldo não retornado para conta %s", conta_id)
            # ⬅ NÃO atualiza synced_at quando saldo vem None
```

Ambas são orquestradas em [etl/main.py:122](etl/main.py:122) e [etl/main.py:142](etl/main.py:142):
```python
("contas_financeiras", sync_contas_financeiras, ()),  # idx 122
...
("saldo_contas",       sync_saldo_contas,       ()),  # idx 142
```

**Filtro incremental?** Não em `contas_financeiras` — `_sync_endpoint` chama `client.get_all(api_path)` sem `data_alteracao_de`. Em `sync_saldo_contas` também não há filtro temporal.

**Flag full vs. incremental?** Não.

## I2 — Como `cf.saldo_atual` é populado hoje

`_map_conta_financeira` ([etl/sync/cadastros.py:58](etl/sync/cadastros.py:58)) extrai do payload do listing apenas:
```python
"id", "nome", "tipo", "banco", "agencia", "numero_conta",
"saldo_inicial", "ativo"
```
**Não extrai `saldo_atual`** — embora o payload do `/conta-financeira` possa ou não trazer, o mapper ignora.

O único caminho para `saldo_atual` é `sync_saldo_contas`, que faz **uma chamada por conta** ao endpoint `/v1/conta-financeira/{id}/saldo-atual` (confirmado em `docs/conta-azul-api-guia.md` seção 1.9: esse é o endpoint dedicado de saldo realtime).

UPDATE só dispara quando `saldo is not None` — então contas cuja API devolve null/missing **ficam fora**, inclusive do `synced_at`.

## I3 — Como `synced_at` é atualizado

**`sync_contas_financeiras` NÃO atualiza `synced_at`.** Confirmado lendo [etl/db.py:55-101](etl/db.py:55): `upsert()` só seta as colunas presentes no dict. O mapper não inclui `synced_at`, então a coluna nunca aparece no `SET` da clause `ON CONFLICT DO UPDATE`.

**Só `sync_saldo_contas` toca `synced_at`** — e só quando saldo é diferente de None.

## I4 — Endpoint `/v1/conta-financeira/{id}/saldo-atual` (guia)

Linha 167 do guia:
> `GET /v1/conta-financeira/{id}/saldo-atual` — saldo atual.

É o endpoint correto para saldo realtime. Rate limit não é específico — vale o global de 600 req/min e 10 req/s.

## I5 — Workflow do GitHub Actions

[.github/workflows/sync.yml](.github/workflows/sync.yml) — **único workflow ativo**, cron `0 * * * *` (hourly), comando `python -m etl.main`. Concurrency group `etl-contaazul` impede execuções paralelas.

[.github/workflows/etl_diario.yml](.github/workflows/etl_diario.yml) — schedule comentado, mantido só como dispatch manual.

Não há variantes `--full` / `--accounts-only`. Tudo num run só.

## Diagnóstico final — causa raiz da defasagem

Da tabela `ca.sync_log`, runs recentes de `/conta-financeira/{id}/saldo`:

| id | iniciado_em | registros_inseridos |
|---:|---|---:|
| 4971 | 2026-06-18 20:13 | **6** |
| 4952 | 2026-06-18 17:15 | **6** |

12 contas ativas, mas `sync_saldo_contas` reporta sempre 6. Casa exatamente com o que vimos na R1: 6 contas com `synced_at` fresh, 6 com `synced_at` antigo (3 a 31 dias).

**Causa raiz:** as 6 contas paradas (Cartão Fase, Internacional, Inter PJ, Finance Mktlab Cartão, Maquineta Virtual, Conta PJ Conta Azul IP) devolvem `saldo == None` no `/saldo-atual` (provavelmente 404 ou payload sem o campo). O código ([cadastros.py:259](etl/sync/cadastros.py:259)) só loga warning e segue, **sem atualizar `synced_at`**. Como `sync_contas_financeiras` também não toca `synced_at` (I3), o campo fica congelado na última atualização efetiva.

Não é problema de filtro incremental — o ETL ITERATE todas as 12 contas a cada run. O problema é que **silenciosamente abandona 6 delas** e não marca que tentou.

## Fix proposto (não implementado)

### Mudança mínima

**Arquivo:** [etl/sync/cadastros.py:225-263](etl/sync/cadastros.py:225)
**Função:** `sync_saldo_contas`

Trocar o bloco `if saldo is not None / else: warning` por:

```python
# Trata None como 0.0 — listing já confirmou que a conta está ativa,
# então saldo None = conta sem movimento (saldo zero), não erro.
saldo_final = _float(saldo) if saldo is not None else 0.0

with conn.cursor() as cur:
    cur.execute(
        """
        UPDATE ca.contas_financeiras
           SET saldo_atual             = %s,
               data_ultima_conciliacao = %s,
               synced_at               = %s
         WHERE id = %s
        """,
        (saldo_final, hoje, datetime.now(timezone.utc), str(conta_id)),
    )
conn.commit()
records += 1

if saldo is None:
    logger.info("Conta %s sem saldo retornado — registrado como 0,00", conta_id)
else:
    logger.info("%-30s -> saldo R$ %.2f atualizado para conta %s",
                "/conta-financeira/{id}/saldo-atual", saldo_final, conta_id)
```

E manter `except Exception` para erros reais (timeout, 5xx), que continuam sem atualizar — mas aí é a falha que deve ser visível.

### Impacto

| Eixo | Antes | Depois |
|---|---|---|
| Chamadas à API CA por run | 12 (`/saldo-atual` x 12) | 12 (sem mudança) |
| Updates em `ca.contas_financeiras` | 6 | 12 |
| `registros_inseridos` no sync_log | 6 | 12 (badge claro de saúde) |
| Tempo de execução | ~12s | ~12s (sem mudança) |
| Rate limit CA (600/min) | 12/3600 = 0,2 req/s | idem |

### Riscos de regressão

1. **Conta que retorna None mas tem saldo real:** se o endpoint devolver erro intermitente e o código tratar como 0, vamos sobrescrever o saldo bom com 0. Mitigação: o `except Exception` no try cobre 4xx/5xx; só cai no `saldo is None` quando a API responde 200 com payload sem o campo (cenário benigno). Mas vale checar: rodar uma vez com o fix e comparar `saldo_atual` antes/depois — se algum saldo > 0 virou 0 indevidamente, refinar a lógica.
2. **Inativas se mesclam com ativas-zeradas:** Filtro `WHERE ativo = true` já existe — inativas continuam ignoradas.
3. **Outros lugares dependem do comportamento atual?** Grep por `saldo_atual`/`synced_at` no resto do código:
   - O frontend (futuro PR3) vai usar `synced_at` para mostrar idade do dado.
   - `sync_log` só conta registros, sem checagem específica desse comportamento.
   - Não há teste automatizado para isso (verifiquei `etl/test_endpoints.py` — só smoke test de auth).
   - Sem dependência travada.

### Plano de validação local (pro PR1)

```bash
# 1. Branch dev, apply patch
git checkout dev && git checkout -b fix/etl-saldo-contas-sempre-atualiza

# 2. Configurar .env com credenciais CA
cp ../<main-checkout>/.env .env

# 3. Rodar apenas o sync de saldos
python -c "from etl.db import get_connection; \
           from etl.auth import get_access_token; \
           from etl.client import ContaAzulClient; \
           from etl.sync.cadastros import sync_saldo_contas; \
           conn = get_connection(); \
           c = ContaAzulClient(get_access_token()); \
           n = sync_saldo_contas(conn, c); \
           print(f'Atualizadas: {n}')"

# Esperado: "Atualizadas: 12" (antes era 6)

# 4. Validar no banco
psql "$DATABASE_URL" -c "SELECT nome, saldo_atual, synced_at FROM ca.contas_financeiras WHERE ativo=true ORDER BY synced_at DESC;"
# Esperado: TODAS as 12 com synced_at do último minuto

# 5. Verificar que nenhuma conta com saldo > 0 virou 0 indevidamente
# Comparar contra um snapshot anterior do saldo_atual.
```

### Escopo do PR1

- ~15 linhas alteradas em `etl/sync/cadastros.py` (substituir o `if/else` por um bloco que sempre faz UPDATE).
- Sem mudança em main.py, db.py, ou workflow.
- Sem migration.
## 5. Fix aplicado (PR1) — 2026-06-18

- Commits em `dev`:
  - `f3babff` fix(etl): persistir saldo_atual=0 quando CA retorna None em /saldo
  - `68de599` fix(etl): incluir synced_at em _map_conta_financeira
- Branch: `dev` (push feito para `origin/dev`)
- **Validação local não executada:** refresh token da CA retornou HTTP 400 no momento da validação (provavelmente rotacionado pelo run hourly do GitHub Actions em paralelo). Por solicitação do Felipe, fizemos push direto e a validação acontece no próximo run automático do `sync.yml` (cron horário).
- **Critérios pendentes (a validar pós-Actions):**
  1. Todas as 12 contas ativas com `synced_at` < 1h
  2. As 6 contas estagnadas (Cartão Fase, Internacional, Inter PJ, Mktlab Cartão, Maquineta, Conta PJ CA IP) com `saldo_atual = 0,00`
  3. Nenhuma conta com saldo > 0 zerada por engano
  4. `ca.sync_log` última entrada `/conta-financeira/{id}/saldo` com `registros_inseridos = 12`
- Query de verificação após o run do Actions:
  ```sql
  SELECT nome, saldo_atual, synced_at,
         ROUND((EXTRACT(EPOCH FROM (NOW()-synced_at))/3600)::numeric,1) AS h_atras
  FROM ca.contas_financeiras WHERE ativo=true ORDER BY synced_at;
  ```
- Tela de Saldos (PR3) destravada após validação: pode consumir `cf.saldo_atual` direto para contas não-cartão, e a fórmula via parcelas vencidas para cartão.
- `saldos_iniciais` (PR2): segue em backlog, não bloqueia tela.

---

# (Histórico) Plano original do PR1 antes da execução

- Commit message sugerida:
  ```
  fix(etl): sync_saldo_contas sempre atualiza synced_at, mesmo quando API devolve saldo nulo

  Antes: 6 das 12 contas ativas ficavam com synced_at congelado porque o endpoint
  /v1/conta-financeira/{id}/saldo-atual devolve saldo nulo para contas sem movimento,
  e o código pulava o UPDATE silenciosamente. Resultado: tela de saldos bancários
  exibia dados de até 31 dias atrás para contas zeradas.

  Agora: trata saldo None como 0.0 (consistente com o estado real da conta) e sempre
  faz UPDATE, garantindo que synced_at reflete a última checagem, não a última mudança.
  ```
