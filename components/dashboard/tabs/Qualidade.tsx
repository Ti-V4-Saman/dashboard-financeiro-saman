'use client'

import { useMemo } from 'react'
import useSWR from 'swr'
import type { Lancamento } from '@/lib/types'
import { fR, fDt } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { generateInsights } from '@/lib/insights'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Integridade {
  ultimo_sync: string | null
  baixas_total: number
  baixas_com_valor: number
  baixas_pct_valor: number | null
  composicao_divergentes: number
  rec_quitados: number
  rec_com_data: number
  rec_pct_data: number | null
  pag_quitados: number
  pag_com_data: number
  pag_pct_data: number | null
  orfas: number
  sem_categoria: number
  sem_cc: number
}

interface AtrasadosGlobal {
  receber_count: number
  receber_total: number
  pagar_count: number
  pagar_total: number
}

interface ConciliacaoRow {
  nome: string
  saldo_atual: number | null
  data_ultima_conciliacao: string | null
  dias_sem_conciliar: number | null
  itens_nao_conciliados: number
  total_itens: number
}

interface QualidadeData {
  integridade: Integridade
  atrasados_global: AtrasadosGlobal
  conciliacao: ConciliacaoRow[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then(r => r.json())

type Semaforo = 'verde' | 'amarelo' | 'vermelho' | 'cinza'

const SEM_COLORS: Record<Semaforo, { bg: string; border: string; text: string; dot: string }> = {
  verde:    { bg: 'var(--green-l)',  border: '#9DD4B8',        text: 'var(--green)', dot: 'var(--green)' },
  amarelo:  { bg: 'var(--amber-l)', border: 'var(--amber-m)', text: 'var(--amber)', dot: 'var(--amber)' },
  vermelho: { bg: 'var(--red-l)',   border: '#EFA8A8',         text: 'var(--red)',   dot: 'var(--red)'   },
  cinza:    { bg: 'var(--surf2)',   border: 'var(--line2)',    text: 'var(--ink3)', dot: 'var(--ink3)'  },
}

// Carta de semáforo ETL — fix: badge de letra + tamanho mínimo 11px
function EtlCard({
  letra, titulo, valor, sub, status, tooltip, emptyMsg,
}: {
  letra: string
  titulo: string
  valor?: string
  sub?: string
  status: Semaforo
  tooltip?: string
  emptyMsg?: string   // texto específico quando sem dado
}) {
  const c = SEM_COLORS[status]
  const isEmpty = status === 'cinza'
  return (
    <div
      style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: '14px 16px', position: 'relative' }}
      title={tooltip}
    >
      {/* Badge de letra no canto */}
      <span style={{ position: 'absolute', top: 10, right: 12, fontSize: 9, fontWeight: 700, background: c.dot, color: '#fff', borderRadius: 4, padding: '1px 5px', opacity: isEmpty ? 0.45 : 1 }}>
        {letra}
      </span>

      {/* Dot + Título */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, paddingRight: 24 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink3)', lineHeight: 1.2 }}>{titulo}</span>
      </div>

      {/* Valor ou mensagem de estado vazio */}
      {isEmpty ? (
        <div style={{ fontSize: 11, color: 'var(--ink3)', fontStyle: 'italic' }}>
          {emptyMsg ?? 'Aguardando sync'}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 18, fontWeight: 700, color: c.text, lineHeight: 1 }}>{valor}</div>
          {sub && <div style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 5 }}>{sub}</div>}
        </>
      )}
    </div>
  )
}

function pct(n: number): string { return (n * 100).toFixed(1) + '%' }

function horasAtras(dateStr: string | null): number | null {
  if (!dateStr) return null
  return (Date.now() - new Date(dateStr).getTime()) / 3_600_000
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const TYPE_STYLES = {
  danger: { bg: 'var(--red-l)',   border: '#EFA8A8',         accent: 'var(--red)',   label: 'Atenção' },
  warn:   { bg: 'var(--amber-l)', border: 'var(--amber-m)', accent: 'var(--amber)', label: 'Aviso'   },
  ok:     { bg: 'var(--green-l)', border: '#9DD4B8',         accent: 'var(--green)', label: 'OK'      },
  info:   { bg: 'var(--blue-l)',  border: '#B8D3F2',          accent: 'var(--blue)',  label: 'Info'    },
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface Props { data: Lancamento[] }

export function Qualidade({ data }: Props) {
  const { data: qData, isLoading: qLoading } = useSWR<QualidadeData>(
    '/api/qualidade', fetcher, { refreshInterval: 5 * 60 * 1000 },
  )

  const op = useMemo(() => data.filter(r => !r.isTransfer), [data])

  const { rec, desp } = useMemo(() => {
    let r = 0, d = 0
    for (const row of op) { if (row.tipo === 'Receita') r += row.valor; else d += row.valor }
    return { rec: r, desp: d }
  }, [op])

  const insights = useMemo(() => generateInsights(op, rec, desp), [op, rec, desp])

  const semCat = useMemo(() => op.filter(r => !r.cat1 || r.cat1 === '(em branco)'), [op])
  const semCC  = useMemo(() => op.filter(r => !r.cc1  || r.cc1  === '(em branco)'), [op])

  // Atrasados no período — inclui 'Atrasado' e 'Aberto' já vencidos
  const hoje = new Date()
  const atrasadosPeriodo = useMemo(
    () => op.filter(r =>
      r.data && r.data < hoje &&
      (r.situacao === 'Atrasado' || r.situacao === 'Aberto')
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [op],
  )
  const totalAtrasadoPeriodo = atrasadosPeriodo.reduce((s, r) => s + r.valor, 0)

  // Atrasados globais (da API)
  const atGlobal      = qData?.atrasados_global
  const atGlobalCount = (atGlobal?.receber_count ?? 0) + (atGlobal?.pagar_count ?? 0)
  const atGlobalTotal = (atGlobal?.receber_total  ?? 0) + (atGlobal?.pagar_total  ?? 0)

  // ── Semáforos ETL ────────────────────────────────────────────────────────────

  const ig = qData?.integridade

  const semSync: Semaforo = (() => {
    if (!ig?.ultimo_sync) return 'cinza'
    const h = horasAtras(ig.ultimo_sync) ?? Infinity
    return h < 2 ? 'verde' : h < 6 ? 'amarelo' : 'vermelho'
  })()

  const syncLabel = (() => {
    if (!ig?.ultimo_sync) return ''
    const h = horasAtras(ig.ultimo_sync) ?? 0
    if (h < 1) return `${Math.round(h * 60)} min atrás`
    if (h < 24) return `${h.toFixed(1)} h atrás`
    return `${Math.floor(h / 24)} d atrás`
  })()

  const semBaixasValor: Semaforo = ig?.baixas_pct_valor == null ? 'cinza'
    : ig.baixas_pct_valor >= 0.95 ? 'verde' : 'vermelho'

  const semComposicao: Semaforo = !ig ? 'cinza'
    : ig.composicao_divergentes === 0 ? 'verde' : 'vermelho'

  const semRecData: Semaforo = ig?.rec_pct_data == null ? 'cinza'
    : ig.rec_pct_data >= 0.95 ? 'verde' : 'vermelho'

  const semPagData: Semaforo = ig?.pag_pct_data == null ? 'cinza'
    : ig.pag_pct_data >= 0.95 ? 'verde' : 'vermelho'

  const semVinculo: Semaforo = !ig ? 'cinza' : ig.orfas === 0 ? 'verde' : 'amarelo'

  const semClassif: Semaforo = !ig ? 'cinza'
    : (ig.sem_categoria === 0 && ig.sem_cc === 0) ? 'verde' : 'amarelo'

  // ── Semáforos de conciliação ─────────────────────────────────────────────────

  const concRows = qData?.conciliacao ?? []

  function semConciliacao(row: ConciliacaoRow): Semaforo {
    if (row.data_ultima_conciliacao == null) return 'vermelho'
    const dias = row.dias_sem_conciliar ?? 999
    return dias <= 1 ? 'verde' : dias <= 7 ? 'amarelo' : 'vermelho'
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── 1. KPI Cards (todos fundo branco uniforme) ───────────────────────── */}
      <section>
        <h2 className="text-[13px] font-semibold mb-3" style={{ color: 'var(--ink)' }}>Visão Geral do Período</h2>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>

          {[
            { label: 'Total no Período',
              value: op.length.toLocaleString('pt-BR'),
              color: 'var(--blue)', sub: undefined },
            { label: 'Sem Categoria',
              value: semCat.length.toLocaleString('pt-BR'),
              color: semCat.length > 0 ? 'var(--amber)' : 'var(--green)', sub: undefined },
            { label: 'Sem CC (período)',
              value: semCC.length.toLocaleString('pt-BR'),
              color: semCC.length  > 0 ? 'var(--amber)' : 'var(--green)', sub: undefined },
          ].map(k => (
            <div key={k.label} className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ink3)' }}>{k.label}</div>
              <div className="text-[20px] font-bold leading-none" style={{ color: k.color }}>{k.value}</div>
            </div>
          ))}

          {/* Atrasados GLOBAIS — fundo branco uniforme, número colorido */}
          <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ink3)' }}>
              Atrasados — Global
            </div>
            <div className="text-[20px] font-bold leading-none" style={{ color: atGlobalCount > 0 ? 'var(--red)' : 'var(--green)' }}>
              {qLoading ? '...' : atGlobalCount.toLocaleString('pt-BR')}
            </div>
            {!qLoading && (
              <div className="mt-1.5 text-[10px]" style={{ color: 'var(--ink3)' }}>
                {atGlobalCount > 0 ? fR(atGlobalTotal) : 'Nenhum em aberto'}
              </div>
            )}
            {!qLoading && atGlobal && atGlobalCount > 0 && (
              <div className="text-[10px]" style={{ color: 'var(--ink3)' }}>
                {atGlobal.receber_count} a receber · {atGlobal.pagar_count} a pagar
              </div>
            )}
          </div>

          {/* Atrasados no período */}
          <div className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ink3)' }}>
              Atrasados — Período
            </div>
            <div className="text-[20px] font-bold leading-none" style={{ color: atrasadosPeriodo.length > 0 ? 'var(--amber)' : 'var(--green)' }}>
              {atrasadosPeriodo.length.toLocaleString('pt-BR')}
            </div>
            {totalAtrasadoPeriodo > 0 && (
              <div className="mt-1.5 text-[10px]" style={{ color: 'var(--ink3)' }}>{fR(totalAtrasadoPeriodo)}</div>
            )}
            {atrasadosPeriodo.length === 0 && (
              <div className="mt-1.5 text-[10px]" style={{ color: 'var(--ink3)' }}>Nenhum no período</div>
            )}
          </div>

        </div>
      </section>

      {/* ── 2. Insights do Período (subiu — mais acionável que ETL) ──────────── */}
      <section>
        <h2 className="text-[13px] font-semibold mb-1" style={{ color: 'var(--ink)' }}>Insights Automáticos</h2>
        <p className="text-[11px] mb-3" style={{ color: 'var(--ink3)' }}>Análise dos lançamentos do período selecionado</p>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {insights.map((ins, i) => {
            const s = TYPE_STYLES[ins.type]
            return (
              <div key={i} className="rounded-lg p-4" style={{ background: s.bg, border: `1px solid ${s.border}` }}>
                <div className="flex items-start gap-2">
                  <span className="text-[18px] leading-none flex-shrink-0 mt-0.5">{ins.icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[12px] font-semibold" style={{ color: s.accent }}>{ins.title}</span>
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase" style={{ background: s.accent, color: '#fff' }}>{s.label}</span>
                    </div>
                    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink2)' }}>{ins.body}</p>
                    {ins.val && <div className="mt-1.5 text-[13px] font-bold" style={{ color: s.accent }}>{ins.val}</div>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── 3. Integridade dos Dados (ETL) ───────────────────────────────────── */}
      <section>
        <h2 className="text-[13px] font-semibold mb-1" style={{ color: 'var(--ink)' }}>Integridade dos Dados — ETL</h2>
        <p className="text-[11px] mb-3" style={{ color: 'var(--ink3)' }}>Saúde do pipeline de sincronização com a ContaAzul</p>

        {/* Banner de aviso quando todos os cards estão sem dado */}
        {!qLoading && ig && !ig.ultimo_sync && (
          <div className="mb-3 rounded-lg px-4 py-3 text-[11px]" style={{ background: 'var(--surf2)', border: '1px solid var(--line2)', color: 'var(--ink3)' }}>
            ⏳ <strong>Pipeline ainda não sincronizou</strong> — execute o ETL uma vez para preencher os indicadores abaixo.
          </div>
        )}

        {qLoading ? (
          <div style={{ color: 'var(--ink3)', fontSize: 12, padding: '24px 0' }}>Verificando saúde do pipeline...</div>
        ) : (
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>

            <EtlCard
              letra="A" titulo="Última Sincronização"
              valor={syncLabel}
              sub={ig?.ultimo_sync ? new Date(ig.ultimo_sync).toLocaleString('pt-BR') : undefined}
              status={semSync}
              emptyMsg="Nunca sincronizado"
              tooltip="Verde < 2h · Amarelo 2–6h · Vermelho > 6h"
            />
            <EtlCard
              letra="B" titulo="Baixas com Valor"
              valor={ig?.baixas_pct_valor != null ? pct(ig.baixas_pct_valor) : undefined}
              sub={ig ? `${ig.baixas_com_valor.toLocaleString('pt-BR')} de ${ig.baixas_total.toLocaleString('pt-BR')}` : undefined}
              status={semBaixasValor}
              emptyMsg="0 baixas indexadas"
              tooltip="Verde ≥ 95% · Vermelho < 95% (mapper quebrado)"
            />
            <EtlCard
              letra="C" titulo="Composição Íntegra"
              valor={ig ? `${ig.composicao_divergentes} divergente${ig.composicao_divergentes !== 1 ? 's' : ''}` : undefined}
              status={semComposicao}
              emptyMsg="Sem baixas para verificar"
              tooltip="Verde = 0 divergentes · Vermelho > 0"
            />
            <EtlCard
              letra="D" titulo="Recebimentos c/ Data"
              valor={ig?.rec_pct_data != null ? pct(ig.rec_pct_data) : undefined}
              sub={ig ? `${ig.rec_com_data.toLocaleString('pt-BR')} de ${ig.rec_quitados.toLocaleString('pt-BR')} quitados` : undefined}
              status={semRecData}
              emptyMsg="0 quitados no banco"
              tooltip="Verde ≥ 95% com data_recebimento · Vermelho < 95%"
            />
            <EtlCard
              letra="E" titulo="Pagamentos c/ Data"
              valor={ig?.pag_pct_data != null ? pct(ig.pag_pct_data) : undefined}
              sub={ig ? `${ig.pag_com_data.toLocaleString('pt-BR')} de ${ig.pag_quitados.toLocaleString('pt-BR')} quitados` : undefined}
              status={semPagData}
              emptyMsg="0 quitados no banco"
              tooltip="Verde ≥ 95% com data_pagamento · Vermelho < 95%"
            />
            <EtlCard
              letra="F" titulo="Vínculo Venda"
              valor={ig ? `${ig.orfas} órfã${ig.orfas !== 1 ? 's' : ''}` : undefined}
              status={semVinculo}
              emptyMsg="Sem dados para verificar"
              tooltip="Verde = 0 · Amarelo > 0 (pós-proc. id_venda incompleto)"
            />
            <EtlCard
              letra="G" titulo="Classificação Contábil"
              valor={ig ? (ig.sem_categoria === 0 && ig.sem_cc === 0 ? 'Íntegro' : `${ig.sem_categoria} s/cat · ${ig.sem_cc} s/cc`) : undefined}
              sub="Base global — não filtrado"
              status={semClassif}
              emptyMsg="Sem dados no banco"
              tooltip="Verde = 0 sem cat. e 0 sem CC · Amarelo > 0"
            />

          </div>
        )}
      </section>

      {/* ── 4. Monitor de Conciliação ─────────────────────────────────────────── */}
      {!qLoading && (concRows.length > 0 || qData?.conciliacao !== undefined) && (
        <section>
          <h2 className="text-[13px] font-semibold mb-1" style={{ color: 'var(--ink)' }}>Monitor de Conciliação Bancária</h2>
          <p className="text-[11px] mb-3" style={{ color: 'var(--ink3)' }}>Apenas contas com conciliação obrigatória ativada</p>

          {concRows.length === 0 ? (
            <div className="rounded-lg px-4 py-5 text-center" style={{ background: 'var(--surf2)', border: '1px solid var(--line2)' }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>🏦</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)', marginBottom: 4 }}>
                Configuração pendente
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink3)' }}>
                A coluna <code style={{ background: 'var(--surf3)', padding: '1px 4px', borderRadius: 3 }}>requer_conciliacao</code> será ativada após o próximo deploy do ETL.
              </div>
            </div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: 'var(--surf2)', borderBottom: '2px solid var(--line2)' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'center',  fontSize: 10, fontWeight: 600, color: 'var(--ink3)', width: 40 }}>Status</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left',   fontSize: 10, fontWeight: 600, color: 'var(--ink3)', borderLeft: '1px solid var(--line)' }}>Conta</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right',  fontSize: 10, fontWeight: 600, color: 'var(--ink3)', borderLeft: '1px solid var(--line)' }}>Saldo Atual</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right',  fontSize: 10, fontWeight: 600, color: 'var(--ink3)', borderLeft: '1px solid var(--line)' }}>Últ. Conciliação</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right',  fontSize: 10, fontWeight: 600, color: 'var(--ink3)', borderLeft: '1px solid var(--line)' }}>Dias s/ Conciliar</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right',  fontSize: 10, fontWeight: 600, color: 'var(--ink3)', borderLeft: '1px solid var(--line)' }}>Não Conciliados</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right',  fontSize: 10, fontWeight: 600, color: 'var(--ink3)', borderLeft: '1px solid var(--line)' }}>Total Itens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {concRows.map((row, i) => {
                      const sem = semConciliacao(row)
                      const c   = SEM_COLORS[sem]
                      const todosSemRec = row.total_itens > 0 && row.itens_nao_conciliados === row.total_itens
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid var(--line)' }} className="hover:bg-[var(--surf2)] transition-colors">
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <div style={{ width: 9, height: 9, borderRadius: '50%', background: c.dot, margin: '0 auto' }} title={sem} />
                          </td>
                          <td style={{ padding: '10px 16px', fontWeight: 600, color: 'var(--ink)', borderLeft: '1px solid var(--line)' }}>{row.nome}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', borderLeft: '1px solid var(--line)', color: 'var(--ink2)' }}>
                            {row.saldo_atual != null ? fR(row.saldo_atual) : '—'}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', borderLeft: '1px solid var(--line)', color: 'var(--ink3)' }}>
                            {row.data_ultima_conciliacao
                              ? new Date(row.data_ultima_conciliacao).toLocaleDateString('pt-BR')
                              : <span style={{ color: 'var(--red)', fontWeight: 600 }}>Nunca</span>}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', borderLeft: '1px solid var(--line)', fontWeight: 700, color: c.text }}>
                            {row.dias_sem_conciliar != null ? `${row.dias_sem_conciliar} d` : '—'}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', borderLeft: '1px solid var(--line)', color: row.itens_nao_conciliados > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>
                            {todosSemRec
                              ? <span title="Aguardando 1º sync com id_reconciliacao">🔄 {row.itens_nao_conciliados}</span>
                              : row.itens_nao_conciliados.toLocaleString('pt-BR')}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', borderLeft: '1px solid var(--line)', color: 'var(--ink3)' }}>
                            {row.total_itens.toLocaleString('pt-BR')}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {/* ── 5. Sem Categoria ─────────────────────────────────────────────────── */}
      {semCat.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Sem Categoria no Período ({semCat.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 90 }} />
                  <col />
                  <col style={{ width: 88 }} />
                  <col style={{ width: 120 }} />
                </colgroup>
                <thead>
                  <tr style={{ background: 'var(--surf2)', borderBottom: '2px solid var(--line2)' }}>
                    {[
                      { label: 'Data',      align: 'left'  },
                      { label: 'Descrição', align: 'left'  },
                      { label: 'Tipo',      align: 'left'  },
                      { label: 'Valor',     align: 'right' },
                    ].map(h => (
                      <th key={h.label} style={{ padding: '9px 14px', textAlign: h.align as any, fontSize: 10, fontWeight: 600, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {semCat.slice(0, 50).map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--line)' }} className="hover:bg-[var(--surf2)] transition-colors">
                      <td style={{ padding: '9px 14px', color: 'var(--ink3)', whiteSpace: 'nowrap' }}>{fDt(r.data)}</td>
                      <td style={{ padding: '9px 14px', color: 'var(--ink2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.desc}</td>
                      <td style={{ padding: '9px 14px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: r.tipo === 'Receita' ? 'var(--green-l)' : 'var(--red-l)', color: r.tipo === 'Receita' ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap' }}>{r.tipo}</span>
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 600, color: r.tipo === 'Receita' ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap' }}>{fR(r.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 6. Sem CC ────────────────────────────────────────────────────────── */}
      {semCC.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Sem Centro de Custo no Período ({semCC.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed', minWidth: 700 }}>
                <colgroup>
                  <col style={{ width: 90 }} />
                  <col />
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '22%' }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 120 }} />
                </colgroup>
                <thead>
                  <tr style={{ background: 'var(--surf2)', borderBottom: '2px solid var(--line2)' }}>
                    {[
                      { label: 'Data',       align: 'left'  },
                      { label: 'Descrição',  align: 'left'  },
                      { label: 'Fornecedor', align: 'left'  },
                      { label: 'Categoria',  align: 'left'  },
                      { label: 'Situação',   align: 'left'  },
                      { label: 'Valor',      align: 'right' },
                    ].map(h => (
                      <th key={h.label} style={{ padding: '9px 14px', textAlign: h.align as any, fontSize: 10, fontWeight: 600, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {semCC.slice(0, 50).map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--line)' }} className="hover:bg-[var(--surf2)] transition-colors">
                      <td style={{ padding: '9px 14px', color: 'var(--ink3)', whiteSpace: 'nowrap' }}>{fDt(r.data)}</td>
                      <td style={{ padding: '9px 14px', color: 'var(--ink2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.desc}</td>
                      <td style={{ padding: '9px 14px', color: 'var(--ink3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.fornecedor || '—'}</td>
                      <td style={{ padding: '9px 14px', color: 'var(--ink3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.cat1}>{r.cat1 || '—'}</td>
                      <td style={{ padding: '9px 14px' }}>
                        {r.situacao
                          ? <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', background: r.situacao === 'Atrasado' ? 'var(--red-l)' : r.situacao === 'Quitado' ? 'var(--green-l)' : 'var(--surf2)', color: r.situacao === 'Atrasado' ? 'var(--red)' : r.situacao === 'Quitado' ? 'var(--green)' : 'var(--ink3)' }}>{r.situacao}</span>
                          : <span style={{ color: 'var(--ink3)' }}>—</span>}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 600, color: r.tipo === 'Receita' ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap' }}>{fR(r.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 7. Atrasados no Período ───────────────────────────────────────────── */}
      {atrasadosPeriodo.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Atrasados no Período ({atrasadosPeriodo.length}) — {fR(totalAtrasadoPeriodo)}
              {!qLoading && (
                <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--ink3)', marginLeft: 8 }}>
                  Total global: {atGlobalCount} contas ({fR(atGlobalTotal)})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed', minWidth: 620 }}>
                <colgroup>
                  <col style={{ width: 90 }} />
                  <col />
                  <col style={{ width: '35%' }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 120 }} />
                </colgroup>
                <thead>
                  <tr style={{ background: 'var(--surf2)', borderBottom: '2px solid var(--line2)' }}>
                    {[
                      { label: 'Data',        align: 'left'  },
                      { label: 'Descrição',   align: 'left'  },
                      { label: 'Fornecedor',  align: 'left'  },
                      { label: 'Situação',    align: 'left'  },
                      { label: 'Valor',       align: 'right' },
                    ].map(h => (
                      <th key={h.label} style={{ padding: '9px 14px', textAlign: h.align as any, fontSize: 10, fontWeight: 600, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {atrasadosPeriodo.slice(0, 50).map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--line)' }} className="hover:bg-[var(--surf2)] transition-colors">
                      <td style={{ padding: '9px 14px', color: 'var(--ink3)', whiteSpace: 'nowrap' }}>{fDt(r.data)}</td>
                      <td style={{ padding: '9px 14px', color: 'var(--ink2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.desc}</td>
                      <td style={{ padding: '9px 14px', color: 'var(--ink3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.fornecedor}>{r.fornecedor || '—'}</td>
                      <td style={{ padding: '9px 14px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', background: 'var(--red-l)', color: 'var(--red)' }}>{r.situacao}</span>
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 600, color: r.tipo === 'Receita' ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap' }}>{fR(r.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  )
}
