'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import type { Filters } from '@/lib/types'
import { isAggClientEnabled } from '@/lib/feature-aggregation'
import { aggFetcher, buildAggQuery, isForbidden } from '@/lib/agg-client'
import {
  aggCentrosCusto, aggDetalheCC,
  type CentrosCustoAgg, type CCDetalheResp,
} from '@/lib/aggregations/centrosCusto'
import { fR } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Search } from 'lucide-react'

import type { Lancamento } from '@/lib/types'

interface Props {
  data: Lancamento[]
  filters?: Filters
}

/**
 * Placeholder enquanto a resposta agregada não chegou. Zerado faz a tela cair
 * no mesmo estado que ela já mostra quando o período não tem lançamento —
 * transitório, e o `keepPreviousData` do SWR evita que reapareça a cada troca
 * de filtro.
 */
const RESUMO_VAZIO: CentrosCustoAgg = {
  centros: [],
  kpiGroups: [],
  graficos: { receitas: [], despesas: [], resultado: [] },
  totais: { receita: 0, despesa: 0, resultado: 0, quantidadeCC: 0 },
}

const DETALHE_VAZIO: CCDetalheResp = {
  cc: '', tipo: null, rows: [],
  totais: { rec: 0, desp: 0, resultado: 0 },
  dadosProtegidos: false,
}

export function CentrosCusto({ data, filters }: Props) {
  const aggOn = isAggClientEnabled()
  const regime = filters?.regime ?? 'competencia'
  const [search, setSearch] = useState('')

  // Modal de conferência por CC
  const [ccSel, setCcSel] = useState<string | null>(null)
  const [tipoSel, setTipoSel] = useState<'Receita' | 'Despesa' | undefined>(undefined)
  const [open, setOpen] = useState(false)

  const filtros = useMemo(() => ({
    categoria: filters?.categoria ?? [],
    cc:        filters?.cc ?? [],
    tipo:      filters?.tipo ?? '',
    situacao:  filters?.situacao ?? [],
    conta:     filters?.conta ?? [],
  }), [filters?.categoria, filters?.cc, filters?.tipo, filters?.situacao, filters?.conta])

  // ── RESUMO: os dois caminhos chamam a MESMA função ───────────────────────
  // Com a flag ON ela roda no servidor; com OFF, aqui no browser sobre o array
  // que o DashboardLayout já passa por prop. Uma implementação só.
  const urlResumo = useMemo(
    () => (aggOn && filters ? `/api/agg/centros-custo?${buildAggQuery(filters)}` : null),
    [aggOn, filters],
  )
  const { data: resumoAgg, error: erroResumo } =
    useSWR<CentrosCustoAgg>(urlResumo, aggFetcher, { keepPreviousData: true })

  const resumoLocal = useMemo(
    () => (aggOn ? null : aggCentrosCusto(data, filtros, regime)),
    [aggOn, data, filtros, regime],
  )
  const resumo: CentrosCustoAgg = aggOn ? (resumoAgg ?? RESUMO_VAZIO) : resumoLocal!

  const ccList     = resumo.centros
  const kpiGroups  = resumo.kpiGroups
  const recByCC    = resumo.graficos.receitas
  const despByCC   = resumo.graficos.despesas
  const resultByCC = resumo.graficos.resultado

  // ── DETALHE: só ao abrir o modal ─────────────────────────────────────────
  // Com a flag ON a requisição só existe quando há um CC selecionado — nada é
  // buscado antecipadamente. Um erro aqui fica dentro do Sheet e não derruba a
  // tela: o resumo já está renderizado e não depende desta chamada.
  const urlDetalhe = useMemo(() => {
    if (!aggOn || !filters || !ccSel || !open) return null
    const extra: Record<string, string> = { ccSel }
    if (tipoSel) extra.tipoSel = tipoSel
    return `/api/agg/centros-custo/detalhe?${buildAggQuery(filters, extra)}`
  }, [aggOn, filters, ccSel, tipoSel, open])

  const { data: detalheAgg, error: erroDetalhe } =
    useSWR<CCDetalheResp>(urlDetalhe, aggFetcher, { keepPreviousData: false })

  const detalheLocal = useMemo(
    () => (aggOn || !ccSel
      ? null
      // `podeVerFolhaDetalhada: true` aqui é correto e não é um furo: com a flag
      // OFF o array já chegou de /api/financeiro MASCARADO na origem para quem
      // não tem a permissão. Mascarar de novo seria no-op; passar `false` é que
      // esconderia dado de quem tem direito a ver.
      : aggDetalheCC(data, filtros, regime, ccSel, tipoSel ?? null, true)),
    [aggOn, ccSel, data, filtros, regime, tipoSel],
  )

  const detalhe: CCDetalheResp = aggOn
    ? (detalheAgg ?? DETALHE_VAZIO)
    : (detalheLocal ?? DETALHE_VAZIO)

  const linhas = detalhe.rows
  const totaisModal = detalhe.totais
  const carregandoDetalhe = aggOn && !!ccSel && open && !detalheAgg && !erroDetalhe

  const abrir = (nome?: string, tipo?: 'Receita' | 'Despesa') => {
    if (!nome) return
    // TODO gate: se !admin && !temAcesso('lancamentos') → mensagem "sem permissão, contate o admin"
    setCcSel(nome)
    setTipoSel(tipo)
    setOpen(true)
  }

  // Altura dinâmica para gráficos horizontais
  const hBarHeight = (n: number) => Math.max(200, n * 28)

  const filteredCC = useMemo(() => {
    const list = search
      ? ccList.filter(c => c.nome.toLowerCase().includes(search.toLowerCase()))
      : ccList
    return [...list].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [ccList, search])

  // ── Erro do RESUMO ────────────────────────────────────────────────────────
  // Só no caminho agregado: com a flag OFF não há requisição para falhar.
  // `jsonFetcher` lança em !ok, então cair no RESUMO_VAZIO em erro seria
  // exibir uma tela zerada como se o período não tivesse dado — o oposto do
  // que o usuário precisa saber. Mesmo tratamento que a tela de BUs já usa:
  // 403 tem texto próprio, o resto propaga a mensagem.
  if (aggOn && erroResumo) {
    if (isForbidden(erroResumo)) {
      return (
        <div className="text-[12px]" style={{ color: 'var(--ink3)', padding: '32px 0', textAlign: 'center' }}>
          Você não tem permissão para visualizar os Centros de Custo.
        </div>
      )
    }
    return (
      <div className="text-[12px]" style={{ color: 'var(--red)' }}>
        Erro ao carregar Centros de Custo: {String(erroResumo)}
      </div>
    )
  }

  const fmtShort = (v: number) => {
    if (Math.abs(v) >= 1_000_000) return `R$${(v / 1_000_000).toFixed(1)}M`
    if (Math.abs(v) >= 1_000) return `R$${(v / 1_000).toFixed(0)}K`
    return fR(v)
  }

  const barTooltip = {
    contentStyle: {
      border: '1px solid var(--line)',
      borderRadius: 6,
      background: 'var(--surface)',
      fontSize: 11,
    },
  }

  return (
    <div className="space-y-4">
      {/* KPIs — 5 grupos fixos */}
      <div className="grid grid-cols-5 gap-2.5">
        {kpiGroups.map(g => (
          <div
            key={g.label}
            className="rounded-lg p-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider truncate" style={{ color: 'var(--ink3)' }}>
                {g.label}
              </div>
              {g.count > 1 && (
                <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none" style={{ background: 'var(--surf2)', color: 'var(--ink3)' }}>
                  {g.count}
                </span>
              )}
            </div>
            <div className="text-[16px] font-bold leading-none tracking-tight" style={{ color: g.resultado >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {fR(g.resultado)}
            </div>
            <div className="mt-1 text-[10px]" style={{ color: 'var(--ink3)' }}>
              Rec: {fR(g.rec)} · Desp: {fR(g.desp)}
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
        <Card>
          <CardHeader><CardTitle>Receitas por CC</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={hBarHeight(recByCC.length)}>
              <BarChart data={recByCC} layout="vertical" margin={{ left: 0, right: 16 }}>
                <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} tickFormatter={fmtShort} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} width={150} />
                <Tooltip formatter={(v: number) => fR(v)} {...barTooltip} />
                <Bar
                  dataKey="value"
                  name="Receita"
                  fill="var(--green)"
                  radius={[0, 3, 3, 0]}
                  maxBarSize={16}
                  cursor="pointer"
                  onClick={(d: { payload?: { name?: string }; name?: string }) =>
                    abrir(d?.payload?.name ?? d?.name, 'Receita')
                  }
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Despesas por CC</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={hBarHeight(despByCC.length)}>
              <BarChart data={despByCC} layout="vertical" margin={{ left: 0, right: 16 }}>
                <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} tickFormatter={fmtShort} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} width={150} />
                <Tooltip formatter={(v: number) => fR(v)} {...barTooltip} />
                <Bar
                  dataKey="value"
                  name="Despesa"
                  fill="var(--red)"
                  radius={[0, 3, 3, 0]}
                  maxBarSize={16}
                  cursor="pointer"
                  onClick={(d: { payload?: { name?: string }; name?: string }) =>
                    abrir(d?.payload?.name ?? d?.name, 'Despesa')
                  }
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Resultado por CC — horizontal para legibilidade */}
      <Card>
        <CardHeader><CardTitle>Resultado por CC</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={hBarHeight(resultByCC.length)}>
            <BarChart data={resultByCC} layout="vertical" margin={{ left: 0, right: 60 }}>
              <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} tickFormatter={fmtShort} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} width={150} />
              <Tooltip formatter={(v: number) => fR(v)} {...barTooltip} />
              <Bar
                dataKey="value"
                name="Resultado"
                radius={[0, 3, 3, 0]}
                maxBarSize={16}
                cursor="pointer"
                onClick={(d: { payload?: { name?: string }; name?: string }) =>
                  abrir(d?.payload?.name ?? d?.name)
                }
                label={{ position: 'right', fontSize: 9, fill: 'var(--ink3)', formatter: fmtShort }}
              >
                {resultByCC.map((d, i) => (
                  <Cell key={i} fill={d.value >= 0 ? 'var(--green)' : 'var(--red)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Tabela detalhada */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Detalhamento por CC</CardTitle>
            <div className="relative w-48">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3" style={{ color: 'var(--ink3)' }} />
              <Input placeholder="Buscar CC..." value={search} onChange={e => setSearch(e.target.value)} className="pl-6" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <th className="py-1.5 pl-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Centro de Custo</th>
                <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Receita</th>
                <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Despesa</th>
                <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {filteredCC.map(c => (
                <tr
                  key={c.nome}
                  onClick={() => abrir(c.nome)}
                  style={{ borderBottom: '1px solid var(--line)' }}
                  className="hover:bg-[var(--surf2)] transition-colors cursor-pointer"
                >
                  <td className="py-2 pl-3 text-[11px]" style={{ color: 'var(--ink2)' }}>{c.nome}</td>
                  <td className="py-2 pr-3 text-right text-[11px] font-semibold" style={{ color: 'var(--green)' }}>{fR(c.rec)}</td>
                  <td className="py-2 pr-3 text-right text-[11px] font-semibold" style={{ color: 'var(--red)' }}>{fR(c.desp)}</td>
                  <td className="py-2 pr-3 text-right text-[11px] font-bold" style={{ color: c.resultado >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {fR(c.resultado)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Modal deslizante de conferência por CC */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-[60vw] sm:max-w-[60vw] overflow-y-auto"
        >
          <SheetHeader>
            <div className="flex items-center gap-2 flex-wrap">
              <SheetTitle className="text-[14px]">{ccSel}</SheetTitle>
              {tipoSel && (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none"
                  style={{
                    background: tipoSel === 'Receita' ? 'var(--green-l, #e7f7ef)' : 'var(--red-l, #fde9ec)',
                    color: tipoSel === 'Receita' ? 'var(--green)' : 'var(--red)',
                  }}
                >
                  {tipoSel}
                </span>
              )}
              {!carregandoDetalhe && !erroDetalhe && (
                <span className="text-[10px]" style={{ color: 'var(--ink3)' }}>
                  {linhas.length} lançamento{linhas.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            {detalhe.dadosProtegidos && (
              <div className="mt-1 text-[11px]" style={{ color: 'var(--ink3)' }}>
                Alguns dados foram protegidos conforme sua permissão.
              </div>
            )}
            <div className="mt-2 flex gap-4 text-[11px]" style={{ color: 'var(--ink3)' }}>
              <span>Rec: <strong style={{ color: 'var(--green)' }}>{fR(totaisModal.rec)}</strong></span>
              <span>Desp: <strong style={{ color: 'var(--red)' }}>{fR(totaisModal.desp)}</strong></span>
              <span>
                Resultado:{' '}
                <strong style={{ color: totaisModal.resultado >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {fR(totaisModal.resultado)}
                </strong>
              </span>
            </div>
          </SheetHeader>

          {/* Erro e carregamento vivem DENTRO do Sheet: o resumo já está na
              tela e não depende desta chamada, então falhar aqui não pode
              derrubar nada. Só existe no caminho agregado. */}
          {erroDetalhe ? (
            <div className="mt-6 text-[11px]" style={{ color: isForbidden(erroDetalhe) ? 'var(--ink3)' : 'var(--red)' }}>
              {isForbidden(erroDetalhe)
                ? 'Você não tem permissão para ver o detalhe deste centro de custo.'
                : `Não foi possível carregar o detalhe: ${String(erroDetalhe)}`}
            </div>
          ) : carregandoDetalhe ? (
            <div className="mt-6 text-[11px]" style={{ color: 'var(--ink3)' }}>Carregando lançamentos…</div>
          ) : (
          <div className="mt-4">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  {/* TODO 1ª coluna "Código Lançamento" após expor o campo no SELECT da API + tipo Lancamento */}
                  <th className="py-1.5 pl-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Descrição</th>
                  <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Fornecedor ou Cliente</th>
                  <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Categoria</th>
                  <th
                    className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: 'var(--ink3)', width: 110 }}
                  >
                    Valor
                  </th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td className="py-2 pl-3 text-[11px]" style={{ color: 'var(--ink2)' }}>{l.desc}</td>
                    <td className="py-2 text-[11px]" style={{ color: 'var(--ink2)' }}>{l.contraparte}</td>
                    <td className="py-2 text-[11px]" style={{ color: 'var(--ink3)' }}>{l.categoria}</td>
                    <td
                      className="py-2 pr-3 text-right text-[11px] font-semibold tabular-nums whitespace-nowrap"
                      style={{ color: l.tipo === 'Receita' ? 'var(--green)' : 'var(--red)', width: 110 }}
                    >
                      {fR(l.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--line)' }}>
                  <td colSpan={3} className="py-2 pl-3 text-[11px] font-semibold" style={{ color: 'var(--ink3)' }}>
                    Total {tipoSel ?? 'líquido'}
                  </td>
                  <td
                    className="py-2 pr-3 text-right text-[11px] font-bold tabular-nums whitespace-nowrap"
                    style={{
                      color:
                        tipoSel === 'Receita'
                          ? 'var(--green)'
                          : tipoSel === 'Despesa'
                          ? 'var(--red)'
                          : totaisModal.resultado >= 0
                          ? 'var(--green)'
                          : 'var(--red)',
                      width: 110,
                    }}
                  >
                    {fR(
                      tipoSel === 'Receita'
                        ? totaisModal.rec
                        : tipoSel === 'Despesa'
                        ? totaisModal.desp
                        : totaisModal.resultado
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
