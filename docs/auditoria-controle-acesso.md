# Auditoria de Controle de Acesso — Mapa do Terreno

> **Tipo:** Auditoria / relatório de levantamento. **Não contém alterações de código nem proposta de refactor.** Descreve apenas o que existe hoje, para fundamentar a futura implementação de controle de acesso por tela, por usuário, com proteção server-side.
>
> **Data:** maio/2026 · **Branch auditada:** `dev` · **Stack:** Next.js 15 · NextAuth v5 (Auth.js) · Postgres/Neon (schema `ca`) · SWR.
>
> **Nota sobre docs:** o briefing pediu `docs/conta-azul-api-v1-competencia-caixa.md`, que **não existe** com esse nome. O guia financeiro do projeto é `docs/conta-azul-api-guia.md` (referenciado no `CLAUDE.md`) — foi esse que consultei.

---

## Sumário executivo (o achado central)

Hoje o gate é binário: **ou você está logado e na allowlist (vê tudo), ou não entra.** Não há noção de "tela X sim, tela Y não" por usuário. Pior para o objetivo pretendido: **o endpoint `/api/financeiro` despeja um array bruto, linha-a-linha (uma linha por baixa/parcela), com valor, categoria — inclusive FOLHA — e centro de custo de cada lançamento, e esse mesmo payload é a fonte única e compartilhada de 5 telas** (Visão Geral, DRE, Centros de Custo, Comparativo, Lançamentos — e ainda Metas via `allData`). Os filtros de categoria/CC/tipo/situação/conta são aplicados **no browser**, ou seja, **o dado sensível já desceu para o cliente antes de qualquer filtro**. Restringir uma tela ou uma categoria (folha) sem vazamento exige **agregação server-side** — não dá para fatiar só escondendo no front.

---

## 1. Camada de Auth / Allowlist atual

### 1.1 Componentes da camada

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Config base (provider + matcher) | `auth.config.ts` | Google provider, callback `authorized`, página `/login` |
| Instância NextAuth (callbacks) | `auth.ts` | `signIn`, `jwt`, `session`, allowlist no DB, lista de admins |
| Middleware (gate global) | `middleware.ts` | aplica NextAuth a quase todas as rotas + dev bypass |
| Dev bypass | `lib/auth-dev-bypass.ts` | injeta sessão fake em dev local |
| Provider client | `components/SessionProvider.tsx` + `app/layout.tsx` | injeta sessão (real/fake) no React |
| Guard de API admin | `lib/auth-guard.ts` | `isAdmin()` / `requireAdmin()` (403) |
| Tipos de sessão | `types/next-auth.d.ts` | adiciona `isAdmin` a `Session` e `JWT` |

### 1.2 Login, sessão e o que o middleware protege

| Item | Como funciona | Referência |
|---|---|---|
| Provider | Google OAuth (`GOOGLE_CLIENT_ID`/`SECRET`) | `auth.config.ts:6-9` |
| Página de login | `/login` custom | `auth.config.ts:11-13` |
| Estratégia de sessão | **JWT** (sem adapter de DB; default NextAuth) | `auth.ts:48-58` (callbacks jwt/session); secret em `:42` |
| Matcher do middleware | `['/((?!_next/static|_next/image|favicon.ico).*)']` — protege **tudo** menos estáticos | `middleware.ts:22-24` |
| Rotas públicas | `/login` e `/api/auth/*` liberadas **dentro** do callback, não no matcher | `auth.config.ts:17` |
| Decisão de bloqueio | `authorized`: se **não público e não logado → `false`** (redireciona p/ login) | `auth.config.ts:15-23` |

> **Ponto-chave:** o callback `authorized` (middleware/edge) só verifica **estar logado** — não verifica papel, não verifica permissão de tela, não re-checa a allowlist. Toda a granularidade fina hoje inexiste nesta camada.

### 1.3 Allowlist — onde mora a regra que barra quem não está cadastrado

| Item | Valor | Referência |
|---|---|---|
| Função | `isAllowed(email)` chamada pelo callback `signIn` | `auth.ts:17-38`, chamada em `:46` |
| Banco / schema / tabela | **Neon Postgres**, schema **`ca`**, tabela **`ca.usuarios_dashboard`** | `auth.ts:3,25` (via `getPool()` de `@/lib/db`) |
| Query exata | `SELECT ativo FROM ca.usuarios_dashboard WHERE LOWER(email) = $1` | `auth.ts:25-28` |
| Amarração do email Google | `$1 = user.email.toLowerCase()` (lower no JS **e** `LOWER()` no SQL) | `auth.ts:19,27` |
| Regra de liberação | só passa se `rows.length > 0 && rows[0].ativo` (existe **e** `ativo=true`) | `auth.ts:31` |
| Falha de DB | catch silencioso → `return false` (**fail-closed**) | `auth.ts:32-37` |
| Colunas (inferidas) | `id`, `nome`, `email` (unique), `ativo` (bool), `criado_em` (timestamp) | tipo em `app/api/usuarios/route.ts:7-13` |

**Admins (papel privilegiado) — hardcoded em código, não no banco:**

| Fonte | Valor | Referência |
|---|---|---|
| `ADMIN_EMAIL` (env, lowercased) | variável de ambiente | `auth.ts:6` |
| Hardcoded | `giovani.maia@v4company.com`, `ti.bh@v4company.com`, `felipe@v4company.com` | `auth.ts:7-12` |
| Cálculo do flag | callback `jwt`: `token.isAdmin = MASTER_ADMINS.includes(email)` | `auth.ts:48-52` |
| Propagação p/ sessão | `session.user.isAdmin = !!token.isAdmin` | `auth.ts:53-58` |
| Curto-circuito | master admin **sempre** passa na allowlist, mesmo sem estar no banco | `auth.ts:21-22` |

> Não existe coluna `role`/`is_admin` no banco. "Admin" é **exclusivamente** a lista hardcoded. A aba Acesso controla `ativo` (allowlist), **não** privilégio admin.

### 1.4 DEV_AUTH_BYPASS (a flag que o CLAUDE.md deixou em aberto)

Flag confirmada: **`DEV_AUTH_BYPASS`** (server) + par público **`NEXT_PUBLIC_DEV_AUTH_BYPASS`** (client). Sempre com guard duplo `NODE_ENV === 'development' && ...`.

| Ponto de bypass | Efeito | Referência |
|---|---|---|
| Middleware | `NextResponse.next()` sem checar sessão | `middleware.ts:11-16` |
| Sessão fake | injeta `{email, name, isAdmin:true, +7d}` — **sempre admin** | `lib/auth-dev-bypass.ts:9-28` (`isAdmin:true` em `:24`) |
| Injeção no React | passa sessão fake ao `SessionProvider` | `app/layout.tsx:22,27` |
| Gate de admin no front | libera admin se `NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true'` | `DashboardLayout.tsx:44-46` |

### 1.5 Aba "Acesso" (🔐) — o que faz hoje

| Aspecto | Detalhe | Referência |
|---|---|---|
| Componente | `UsuariosTab` | `components/dashboard/tabs/Usuarios.tsx` |
| Gating no menu | `adminOnly: true`, filtrado por `!t.adminOnly || isAdmin` | `TabNav.tsx:20,24` |
| Gating no render | `activeTab === 'acesso' && isAdmin && <UsuariosTab/>` | `DashboardLayout.tsx:104` |
| Endpoint | `/api/usuarios` (CRUD completo) | `Usuarios.tsx:32` |
| Tabela gravada | `ca.usuarios_dashboard` | `app/api/usuarios/route.ts:22,41,59,76` |

**CRUD (`app/api/usuarios/route.ts`), todos com `if (!await isAdmin()) return 403`:**

| Método | Linhas | Ação | Campos | SQL |
|---|---|---|---|---|
| GET | `:16-29` | lista todos | id, nome, email, ativo, criado_em | `SELECT ... ORDER BY criado_em DESC` |
| POST | `:32-49` | adiciona/reativa | nome, email (lower+trim) | `INSERT ... ON CONFLICT(email) DO UPDATE SET ativo=TRUE` |
| PATCH | `:52-67` | bloqueia/libera | id, ativo | `UPDATE ... SET ativo=$1 WHERE id=$2` |
| DELETE | `:70-82` | remove | id | `DELETE ... WHERE id=$1` |

Gating backend: `route.ts:17,33,53,71`. O `isAdmin()` vem de `lib/auth-guard.ts:10-13`.

> **Limitação relevante para o projeto:** a allowlist só é re-checada **no login**. Como a sessão é **JWT**, bloquear/excluir um usuário na aba Acesso **não invalida o token já emitido** — vale só no próximo login (o próprio rodapé do componente admite isso, `Usuarios.tsx:289`). Qualquer controle de acesso por tela baseado só no JWT herdará essa latência.

---

## 2. Mapa Aba → Dado

| Aba | Componente | Fonte de dados | Endpoint(s) | Campos principais |
|---|---|---|---|---|
| **Visão Geral** | `tabs/VisaoGeral.tsx` | **Híbrido**: prop `data` + fetch próprio | `/api/financeiro` (prop) + `/api/visao-geral-extras` (`:179`) | da prop: `valor`, `tipo`, `situacao`, `isTransfer`, `cat1`, `cc1`, `data`; do extras: `saldos`, `insights`, `blocos` |
| ↳ Saldos Bancários | `SaldosBancarios.tsx` | `extras.saldos` | `/api/visao-geral-extras` | `contas[].{saldo,nome,banco}`, `consolidado` |
| ↳ Blocos Resumo | `BlocosResumo.tsx` | `extras.blocos` | `/api/visao-geral-extras` | `contratos.{receitaRecorrente,ticketMedio,…}`, `notas.{valorFaturado,…}` |
| ↳ Drill Contratos | `ContratosDrillSheet.tsx` | SWR lazy | `/api/contratos-drill` (`:59`) | `contratos[].{id,nome}` |
| ↳ Resumo Trimestral | `widgets/ResumoTrimestralWidget.tsx` | **SWR próprios** (ignora a prop) | `/api/financeiro?...regime=competencia` (M-1..M+2, `:601`) + `/api/metas` (`:575`) | `valor`, `cat1`, `tipo`, `situacao`; metas |
| **DRE** | `tabs/DRE.tsx` | **prop `data`** | `/api/financeiro` (compartilhado) | `valorDRE` (≠ `valor`), `cat1`, `tipo`, `data_ym`, `situacao` |
| **Centros de Custo** | `tabs/CentrosCusto.tsx` | **prop `data`** | `/api/financeiro` (compartilhado) | `valor`, `_ccList[].nome`, `tipo`, `situacao` |
| **Comparativo** | `tabs/Comparativo.tsx` | **props `data` + `allData`** | `/api/financeiro` (compartilhado) | `valor`, `data`, `cat1`, `tipo` |
| **Qualidade & Insights** | `tabs/Qualidade.tsx` | **Híbrido**: prop `data` + SWR próprio | `/api/financeiro` (prop) + `/api/qualidade` (`:130`) | da prop: `valor`, `cat1`, `cc1`, `fornecedor`; do endpoint: `integridade`, `atrasados_global`, `conciliacao[]` |
| **Lançamentos** | `tabs/Lancamentos.tsx` | **prop `data`** | `/api/financeiro` (compartilhado) | `desc`, `fornecedor`, `cat1`, `cc1`, `valor`, `conta`, `forma`, `origem` |
| **Metas** | `tabs/Metas.tsx` | **Híbrido**: prop `allData` + SWR próprio | `/api/metas` + `/api/metas/bulk` + `allData` (`/api/financeiro`) | metas: `valor_planejado`, `categoria_nivel_*`, `centro_de_custo`; realizado: `valor`, `cat1`, `cc1` |
| **Notas Fiscais** | `tabs/NotasFiscais.tsx` | **fetch próprio** (não usa useFinanceiro) | `/api/notas-fiscais` (`:155`) | `rows[].{cliente,valor,numero,status_raw}`, `summary` |
| **Acesso** | `tabs/Usuarios.tsx` | **SWR próprio** | `/api/usuarios` | `usuarios[].{id,nome,email,ativo}` |

### 2.1 Resposta explícita: compartilham o `/api/financeiro` único?

**Sim — 5 telas vivem do mesmo array bruto distribuído via prop** (`DashboardLayout.tsx:96-102`):

| Compartilham `/api/financeiro` (prop) | Têm endpoint próprio dedicado | Híbridas (prop + endpoint próprio) |
|---|---|---|
| DRE, Centros de Custo, Comparativo, Lançamentos (+ Metas via `allData`) | Qualidade (`/api/qualidade`), Metas (`/api/metas`), Notas Fiscais (`/api/notas-fiscais`), Acesso (`/api/usuarios`) | Visão Geral (`/api/financeiro` + `/api/visao-geral-extras` + drill/resumo) |

**Notas Fiscais já é o precedente do modelo "endpoint por aba"**: recebe só `filters` e faz fetch próprio (`NotasFiscais.tsx:148-163`), ignorando `filteredData`.

---

## 3. Acoplamento de Dados Sensíveis

### 3.1 Campos sensíveis e onde trafegam

| Campo sensível | Endpoint(s) (arquivo:linha) | Observação |
|---|---|---|
| **Valores DRE linha-a-linha** (`valor`, `valorDRE`) | `/api/financeiro` (`route.ts:108-109`) | bruto, por baixa/parcela |
| **Faturamento consolidado** | `visao-geral-extras` (`:282,310`); `notas-fiscais` (`:203,374-396`); `financeiro` (somado no client) | — |
| **Margem** | calculada **client-side** (`lib/types.ts:80`) a partir de `/api/financeiro` | não há endpoint server-side de margem |
| **Remuneração / FOLHA** (categoria salários) | `/api/financeiro` — trafega como **linhas comuns** com `cat1`/`valor` (`:118,108`) | **sem supressão server-side** |
| **Valor por categoria / centro de custo** | `/api/financeiro` (`cat1`,`cc1`,`categorias[]`,`_ccList[]`, `:118-119,228-229`); `/api/metas` (`SELECT *`) | — |
| **Saldos bancários** | `visao-geral-extras` (`:94,327,334`); `qualidade` (`:106,117`) | saldo por conta |
| **Ticket médio** | `visao-geral-extras` (`:156-162,337`) | — |
| **Burn diário** | `visao-geral-extras` (`:171-173,338`) | — |
| **PII** (cliente/fornecedor/usuário) | `financeiro` (`:106`); `notas-fiscais` (`:138,177,204`); `contratos-drill` (`:63`); `usuarios` (`:22`) | nomes/e-mails |

### 3.2 Granularidade do `/api/financeiro` (o ponto mais crítico)

`/api/financeiro` retorna `{ lancamentos: Lancamento[], contas: string[] }` (`route.ts:233`). **NÃO é agregado** — é o dataset cru:

- **Regime caixa:** uma linha por **baixa** (`ca.baixas`) + linha por parcela em aberto (`route.ts:58-96`).
- **Regime competência:** uma linha por **conta_receber/conta_pagar** (`route.ts:131-162`).

Cada `Lancamento` (tipo em `lib/types.ts:15-38`) carrega `valor`, `valorDRE`, `cat1`, `cc1`, `categorias[]`, `_ccList[]`, `fornecedor` **por linha**. O hook só converte `data` para `Date`; nenhuma supressão (`useFinanceiro.ts:201-210`).

### 3.3 Onde duas+ abas compartilham a MESMA fonte crua

**Acoplamento A — `/api/financeiro` como fonte única de 5–7 telas.**
O array vira `allData` (`useFinanceiro.ts:201`) e desce para DRE, Centros de Custo, Comparativo, Lançamentos (`filteredData`) e Metas/Comparativo (`allData`) no mesmo render (`DashboardLayout.tsx:96-102`). Também alimenta as opções da FilterBar (`FilterBar.tsx:783-806`) e o `total` do TopBar (`DashboardLayout.tsx:50`).
→ **Impede fatiar permissão por tela**: as quatro telas leem exatamente o mesmo payload bruto. Não dá para liberar "DRE consolidada" e negar "Lançamentos linha-a-linha" enquanto a fonte for o mesmo array no browser.

**Acoplamento B — `ca.baixas` + `ca.contas_receber/pagar` relidas por 4 endpoints.**
As mesmas tabelas-base, com a mesma lógica de regime e os mesmos filtros (`status NOT IN ('Cancelado','Renegociado')`, exclusão de `TRANSFERENCIA`/`SALDO_CONTA_BANCARIA`), são consultadas por:

| Endpoint | Linhas |
|---|---|
| `/api/financeiro` | `58-96, 132-161` |
| `/api/visao-geral-extras` | `114-145, 227-275` |
| `/api/notas-fiscais` | `94-193` |
| `/api/qualidade` | `12-73` |

→ Qualquer um desses endpoints, **sozinho**, já entrega valor financeiro consolidado (saldo, faturamento, atrasados) a qualquer usuário logado. Proteger uma tela sem proteger todos os endpoints que tocam a mesma base crua = vazamento pela porta lateral.

---

## 4. Estado e Distribuição (`useFinanceiro` / filtros)

### 4.1 Fluxo

```
app/page.tsx (server, Suspense)
  └─ DashboardRoot.tsx (client)   ← useFinanceiro() instanciado UMA vez (:12)
       └─ DashboardLayout.tsx     ← recebe todo o retorno via {...fin}
            ├─ FilterBar.tsx       ← edita filters / setFilters
            └─ tabs/*              ← recebem filteredData + filters por prop
```
Fonte única de dados **e** de estado de filtros: o hook `useFinanceiro`. Tudo desce por **prop drilling** (sem Context).

### 4.2 `useFinanceiro()`

| Aspecto | Detalhe | Referência |
|---|---|---|
| Fetch | `useSWR('/api/financeiro?de&ate&regime')` | `useFinanceiro.ts:174` (`buildApiUrl` `:30-37`) |
| Opções | `refreshInterval: 15min`, `keepPreviousData`, debounce 300ms na key | `:171-179` |
| `allData` | `raw.lancamentos` com `data`→`Date` | `:201-210` |
| `filteredData` | `allData` filtrado **client-side** | `:215-231` |
| Retorno | `{allData, filteredData, filters, setFilters, clearAll, isLoading, isRefetching, refresh, listaContas}` | `:236-246` |

### 4.3 FilterBar global

Estado dos filtros mantido em **`useState<Filters>` dentro de `useFinanceiro`** (`:159`), não na FilterBar; inicializado da URL (`readFiltersFromUrl`, `:57-82`).

| Filtro | Campo | Aplicado onde | Referência |
|---|---|---|---|
| Regime (Comp./Caixa) | `regime` | **Server** (query param) | `useFinanceiro.ts:34` → `route.ts:41` |
| Período | `dateFrom`/`dateTo` | **Server** (`de`/`ate`) | `:32-33` → `route.ts:62-63,…` |
| Categoria | `categoria` | **Client** | `:218-221` |
| Centro de custo | `cc` | **Client** | `:222-225` |
| Tipo | `tipo` | **Client** | `:226` |
| Situação | `situacao` | **Client** | `:227` |
| Conta | `conta` | **Client** | `:228` |

Setter espelha os filtros na URL (`router.replace`, `:185-187`) para deep-link. As opções dos multi-selects derivam de `allData` (`FilterBar.tsx:783-806`). **As abas recebem `filteredData` já filtrado**, não os `filters` para refazer fetch (exceto Notas Fiscais).

> Resumo: **período e regime** disparam novo fetch (mudam a SWR key); os outros **cinco filtros só re-filtram em memória** — o dataset inteiro já está no browser.

### 4.4 O que mudaria se cada aba tivesse endpoint próprio (descrição, não proposta)

| Mudança | Impacto |
|---|---|
| `useFinanceiro` deixa de ser fonte de dados | vira store de filtros + sync de URL; sai o `useSWR` de `/api/financeiro`, somem `allData`/`filteredData` |
| `filteredData` desaparece | os 5 filtros client-side viram **query params server-side** (`buildUrlParams` `:39-55` já serializa todos — falta o backend consumir) |
| Cada aba faz seu próprio fetch | assinatura muda de `({data, filters})` para `({filters})` (padrão `NotasFiscais.tsx:148-163`) |
| FilterBar perde a fonte das opções | precisaria de endpoint de "facetas" (categorias/CCs/situações/contas distintas) — hoje vêm de `allData` (`FilterBar.tsx:783-806`) |
| Comparativo/Metas perdem `allData` | usam série fora do período (`DashboardLayout.tsx:99,102`); precisariam de endpoint com range próprio |
| TopBar perde `total` | `total={allData.length}` (`DashboardLayout.tsx:50`) precisaria de endpoint de contagem |

---

## 5. Classificação de Fatiabilidade

| Aba | Classe | Justificativa (arquivo:linha) |
|---|---|---|
| **Notas Fiscais** | **FÁCIL** | Já tem endpoint isolado e não toca o array compartilhado: fetch próprio em `NotasFiscais.tsx:148-163` → `/api/notas-fiscais`. Proteger o route não afeta nenhuma outra aba. |
| **Acesso** | **FÁCIL** (já protegida) | Endpoint dedicado `/api/usuarios`, admin-guard server-side em todos os métodos (`usuarios/route.ts:17,33,52,71`) e gating de UI (`DashboardLayout.tsx:104`). Modelo de referência. |
| **Qualidade & Insights** | **FÁCIL (parcial)** | Os dados próprios da tela vêm de `/api/qualidade` (`Qualidade.tsx:130`), isolável. **Ressalva:** ela também recebe a prop `data` do `/api/financeiro` para insights do período (`DashboardLayout.tsx:100`) — essa dependência precisaria sair para a tela ficar 100% isolada. |
| **Metas** | **FÁCIL (parcial)** | CRUD próprio `/api/metas` já admin-guard (`metas/route.ts:20,66`). **Ressalva:** o "realizado" usa `allData` do `/api/financeiro` (`DashboardLayout.tsx:102`) — esse pedaço é acoplado. |
| **Visão Geral** | **ACOPLADA** | Híbrida: parte vem de `/api/visao-geral-extras` (isolável) mas o gráfico/insights consome a prop `data` do `/api/financeiro` (`VisaoGeral.tsx` via `DashboardLayout.tsx:96`), e o `ResumoTrimestralWidget` faz **2ª chamada** a `/api/financeiro` (`ResumoTrimestralWidget.tsx:600-609`). |
| **DRE** | **ACOPLADA** | 100% prop `data` do `/api/financeiro` (`DashboardLayout.tsx:97`); usa `valorDRE` por linha (`DRE.tsx:206`). Mesmo array bruto de CC/Lançamentos/Comparativo. |
| **Centros de Custo** | **ACOPLADA** | 100% prop `data` (`DashboardLayout.tsx:98`); lê `_ccList[].nome`/`valor` por linha do array compartilhado. |
| **Comparativo** | **ACOPLADA** | props `data` **+ `allData`** (`DashboardLayout.tsx:99`) — depende do array histórico inteiro do `/api/financeiro`. |
| **Lançamentos** | **ACOPLADA** | 100% prop `data` (`DashboardLayout.tsx:101`); é literalmente a visão linha-a-linha do array bruto. |

> **Linha divisória:** as ACOPLADAS (DRE, CC, Comparativo, Lançamentos, e o miolo da Visão Geral) compartilham o **mesmo array bruto** de `/api/financeiro` (`useFinanceiro.ts:201` → `DashboardLayout.tsx:96-102`). Cortar permissão entre elas **sem agregação server-side é impossível** — todas recebem os mesmos valores/categorias/CCs no browser. As FÁCEIS já têm (ou quase têm) fonte própria.

---

## 6. Riscos de Produção

### 6.1 Mudanças futuras que tocariam o `/api/financeiro` (alimenta o dash inteiro)

| Risco | Detalhe | Referência |
|---|---|---|
| Endpoint é SPOF de dados | qualquer mudança de shape/filtro no `route.ts` reflete em DRE, CC, Comparativo, Lançamentos, Visão Geral e Metas simultaneamente | `useFinanceiro.ts:174` → `DashboardLayout.tsx:96-102` |
| Agregar server-side muda o contrato | trocar `lancamentos[]` cru por totais agregados quebra a filtragem client-side e as opções da FilterBar | `useFinanceiro.ts:215-231`, `FilterBar.tsx:783-806` |
| 2ª chamada paralela | `ResumoTrimestralWidget` bate de novo em `/api/financeiro` com range próprio — qualquer permissão precisa cobrir as duas chamadas | `ResumoTrimestralWidget.tsx:600-609` |

### 6.2 Pontos onde esquecer a checagem = vazamento

| Ponto | Por quê | Referência |
|---|---|---|
| Todos os GETs financeiros | hoje só exigem **login** (middleware), sem papel/escopo. `/api/financeiro`, `/api/visao-geral-extras`, `/api/qualidade`, `/api/notas-fiscais`, `/api/contratos-drill` retornam dado financeiro a **qualquer** usuário logado | `middleware.ts:23`; nenhum route re-valida sessão/escopo |
| Filtro client-side ≠ proteção | esconder categoria FOLHA no front não adianta: a linha já desceu no payload | `useFinanceiro.ts:214-231`, `route.ts:108-118` |
| Acoplamento B (base crua) | proteger só a tela DRE e esquecer `/api/visao-geral-extras` ou `/api/qualidade` vaza os mesmos números por outro endpoint | §3.3 |
| `/api/metas` GET | escrita é admin-guard, mas **GET não é** — expõe metas por categoria/CC a qualquer logado | `metas/route.ts:10` (sem guard no GET) |
| Latência do JWT | revogar acesso na aba Acesso só vale no próximo login (sessão JWT não é invalidada) | `auth.ts:48-58`, `Usuarios.tsx:289` |
| `NEXT_PUBLIC_DEV_AUTH_BYPASS` | se vazar `'true'` no build de produção, libera admin no **front**; o backend não honra essa flag, mas a UI mostraria telas indevidas | `DashboardLayout.tsx:44-46` |

### 6.3 O que dá para fazer atrás de feature flag / sem afetar quem já usa

| Oportunidade | Por quê é seguro | Referência |
|---|---|---|
| Precedente já existe | Notas Fiscais e Acesso já operam no modelo "endpoint próprio protegido" — migrar as demais segue um padrão validado, sem inventar arquitetura | `NotasFiscais.tsx:148-163`, `usuarios/route.ts` |
| Infra de serialização de filtros pronta | `buildUrlParams` já serializa os 7 filtros na URL — backend consumi-los é aditivo | `useFinanceiro.ts:39-55` |
| Coluna de permissão na allowlist | `ca.usuarios_dashboard` já é a tabela-âncora por email; adicionar permissões por tela ali não muda o fluxo de login existente | `auth.ts:25-31`, `usuarios/route.ts` |
| Gating de UI desacoplável | `TabNav` já filtra por `adminOnly`/`isAdmin` (`TabNav.tsx:24`) — estender para permissões por tela é incremental e não quebra quem é admin |
| Telas FÁCEIS primeiro | dá para proteger Notas Fiscais/Qualidade/Metas server-side sem tocar o `/api/financeiro` compartilhado, reduzindo blast radius | §5 |

---

## Apêndice — Arquivos-chave referenciados

| Área | Arquivos |
|---|---|
| Auth | `auth.ts`, `auth.config.ts`, `middleware.ts`, `lib/auth-dev-bypass.ts`, `lib/auth-guard.ts`, `types/next-auth.d.ts`, `components/SessionProvider.tsx`, `app/layout.tsx` |
| Estado/Distribuição | `hooks/useFinanceiro.ts`, `components/dashboard/DashboardRoot.tsx`, `components/dashboard/DashboardLayout.tsx`, `components/dashboard/FilterBar.tsx` |
| Endpoints | `app/api/financeiro/route.ts`, `app/api/visao-geral-extras/route.ts`, `app/api/qualidade/route.ts`, `app/api/notas-fiscais/route.ts`, `app/api/contratos-drill/route.ts`, `app/api/metas/route.ts`, `app/api/metas/bulk/route.ts`, `app/api/usuarios/route.ts` |
| Telas | `components/dashboard/tabs/{VisaoGeral,DRE,CentrosCusto,Comparativo,Qualidade,Lancamentos,Metas,NotasFiscais,Usuarios}.tsx`, `components/dashboard/widgets/ResumoTrimestralWidget.tsx`, `components/dashboard/{SaldosBancarios,BlocosResumo,ContratosDrillSheet,TabNav}.tsx` |
| Tipos | `lib/types.ts` |

> **Reafirmação:** este documento é levantamento. Nenhuma proposta de refactor foi feita e **nenhum arquivo de código foi criado, alterado ou removido** nesta tarefa.
