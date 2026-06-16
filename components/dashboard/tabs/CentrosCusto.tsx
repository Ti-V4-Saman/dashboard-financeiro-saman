'use client'

import { useMemo, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import type { Lancamento, Filters } from '@/lib/types'
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

interface Props {
  data: Lancamento[]
  filters?: Filters
}

// Caixa = o que movimentou ou deveria movimentar no mês: Quitado (por data_pagamento)
// + Aberto/Atrasado (por data_vencimento — o backend já posiciona `data` por situação).
// Parcial fica de fora por ora (split valor pago x aberto — backlog).
function filtraOperacional(data: Lancamento[], regime: string): Lancamento[] {
  const isCaixa = regime === 'caixa'
  return data.filter(r => {
    if (r.isTransfer) return false
    if (r.situacao === 'Cancelado' || r.situacao === 'Renegociado') return false
    if (isCaixa && r.situacao === 'Parcial') return false
    return true
  })
}

interface CCDetalheRow {
  desc: string
  contraparte: string
  categoria: string
  tipo: 'Receita' | 'Despesa'
  valor: number
}

// Reusa filtraOperacional → a soma do modal fecha com a barra por construção.
function detalhePorCC(
  data: Lancamento[],
  regime: string,
  ccNome: string,
  tipoFiltro?: 'Receita' | 'Despesa'
): CCDetalheRow[] {
  return filtraOperacional(data, regime)
    .filter(r =>
      r._ccList.some(c => c.nome && c.nome !== '(em branco)' && c.nome === ccNome)
    )
    .filter(r => !tipoFiltro || r.tipo === tipoFiltro)
    .map(r => ({
      desc: r.desc,
      contraparte: r.fornecedor,
      categoria: r.cat1,
      tipo: r.tipo,
      valor: r.valor,
    }))
    .sort((a, b) => b.valor - a.valor)
}

export function CentrosCusto({ data, filters }: Props) {
  const [search, setSearch] = useState('')

  // Modal de conferência por CC
  const [ccSel, setCcSel] = useState<string | null>(null)
  const [tipoSel, setTipoSel] = useState<'Receita' | 'Despesa' | undefined>(undefined)
  const [open, setOpen] = useState(false)

  const op = useMemo(
    () => filtraOperacional(data, filters?.regime ?? 'competencia'),
    [data, filters?.regime]
  )

  const linhas = useMemo(
    () =>
      ccSel
        ? detalhePorCC(data, filters?.regime ?? 'competencia', ccSel, tipoSel)
        : [],
    [ccSel, tipoSel, data, filters?.regime]
  )

  const totaisModal = useMemo(() => {
    let rec = 0
    let desp = 0
    for (const l of linhas) {
      if (l.tipo === 'Receita') rec += l.valor
      else desp += l.valor
    }
    return { rec, desp, resultado: rec - desp }
  }, [linhas])

  const abrir = (nome?: string, tipo?: 'Receita' | 'Despesa') => {
    if (!nome) return
    // TODO gate: se !admin && !temAcesso('lancamentos') → mensagem "sem permissão, contate o admin"
    setCcSel(nome)
    setTipoSel(tipo)
    setOpen(true)
  }

  // Aggregate by CC
  const ccMap = useMemo(() => {
    const map = new Map<string, { rec: number; desp: number }>()
    for (const r of op) {
      for (const c of r._ccList) {
        if (!c.nome || c.nome === '(em branco)') continue
        if (!map.has(c.nome)) map.set(c.nome, { rec: 0, desp: 0 })
        const entry = map.get(c.nome)!
        if (r.tipo === 'Receita') entry.rec += r.valor
        else entry.desp += r.valor
      }
    }
    return map
  }, [op])

  const ccList = useMemo(
    () =>
      Array.from(ccMap.entries())
        .map(([nome, { rec, desp }]) => ({
          nome,
          rec,
          desp,
          resultado: rec - desp,
        }))
        .sort((a, b) => b.desp - a.desp),
    [ccMap]
  )

  // 5 grupos fixos de KPI
  const kpiGroups = useMemo(() => {
    const sum = (ccs: typeof ccList) =>
      ccs.reduce((acc, c) => ({ rec: acc.rec + c.rec, desp: acc.desp + c.desp }), { rec: 0, desp: 0 })

    const groups: { label: string; match: (n: string) => boolean }[] = [
      { label: 'Administrativo',       match: n => n.toLowerCase().startsWith('administrativo') },
      { label: 'Operação',             match: n => n.toLowerCase().startsWith('operação') || n.toLowerCase().startsWith('operacao') },
      { label: 'People & Performance', match: n => n.toLowerCase().includes('people') },
      { label: 'Aquisição e Expansão', match: n => n.toLowerCase().includes('venda') || n.toLowerCase().includes('monetização') || n.toLowerCase().includes('monetizacao') },
      { label: 'Tecnologia',           match: n => n.toLowerCase().startsWith('tecnologia') },
    ]

    return groups.map(g => {
      const ccs = ccList.filter(c => g.match(c.nome))
      const { rec, desp } = sum(ccs)
      return { label: g.label, rec, desp, resultado: rec - desp, count: ccs.length }
    }).filter(g => g.count > 0)
  }, [ccList])

  const recByCC = useMemo(
    () =>
      [...ccList]
        .sort((a, b) => b.rec - a.rec)
        .filter(c => c.rec > 0)
        .slice(0, 15)
        .map(c => ({ name: c.nome, value: c.rec })),
    [ccList]
  )

  const despByCC = useMemo(
    () =>
      [...ccList]
        .sort((a, b) => b.desp - a.desp)
        .slice(0, 15)
        .map(c => ({ name: c.nome, value: c.desp })),
    [ccList]
  )

  const resultByCC = useMemo(
    () =>
      [...ccList]
        .sort((a, b) => b.resultado - a.resultado)
        .slice(0, 15)
        .map(c => ({ name: c.nome, value: c.resultado })),
    [ccList]
  )

  // Altura dinâmica para gráficos horizontais
  const hBarHeight = (n: number) => Math.max(200, n * 28)

  const filteredCC = useMemo(() => {
    const list = search
      ? ccList.filter(c => c.nome.toLowerCase().includes(search.toLowerCase()))
      : ccList
    return [...list].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [ccList, search])

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
          className="w-full overflow-y-auto sm:!max-w-none sm:w-1/2"
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
              <span className="text-[10px]" style={{ color: 'var(--ink3)' }}>
                {linhas.length} lançamento{linhas.length === 1 ? '' : 's'}
              </span>
            </div>
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
        </SheetContent>
      </Sheet>
    </div>
  )
}
