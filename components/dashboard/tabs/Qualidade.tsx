'use client'

import { useMemo } from 'react'
import type { Lancamento } from '@/lib/types'
import { fR, fDt } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { generateInsights } from '@/lib/insights'

interface Props {
  data: Lancamento[]
}

const TYPE_STYLES = {
  danger: { bg: 'var(--red-l)', border: '#EFA8A8', accent: 'var(--red)', label: 'Atenção' },
  warn: { bg: 'var(--amber-l)', border: 'var(--amber-m)', accent: 'var(--amber)', label: 'Aviso' },
  ok: { bg: 'var(--green-l)', border: '#9DD4B8', accent: 'var(--green)', label: 'OK' },
  info: { bg: 'var(--blue-l)', border: '#B8D3F2', accent: 'var(--blue)', label: 'Info' },
}

export function Qualidade({ data }: Props) {
  const op = useMemo(() => data.filter(r => !r.isTransfer), [data])

  const { rec, desp } = useMemo(() => {
    let r = 0, d = 0
    for (const row of op) {
      if (row.tipo === 'Receita') r += row.valor
      else d += row.valor
    }
    return { rec: r, desp: d }
  }, [op])

  const insights = useMemo(() => generateInsights(op, rec, desp), [op, rec, desp])

  const semCat = useMemo(() => op.filter(r => !r.cat1 || r.cat1 === '(em branco)'), [op])
  const semCC = useMemo(() => op.filter(r => !r.cc1 || r.cc1 === '(em branco)'), [op])
  const hoje = new Date()
  const atrasados = useMemo(
    () => op.filter(r => r.situacao?.toLowerCase().includes('atraso') && r.data && r.data < hoje),
    [op]
  )

  const totalAtrasado = atrasados.reduce((s, r) => s + r.valor, 0)

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        {[
          { label: 'Total', value: op.length.toLocaleString('pt-BR'), color: 'var(--blue)' },
          { label: 'Sem Categoria', value: semCat.length.toLocaleString('pt-BR'), color: semCat.length > 0 ? 'var(--amber)' : 'var(--green)' },
          { label: 'Sem CC', value: semCC.length.toLocaleString('pt-BR'), color: semCC.length > 0 ? 'var(--amber)' : 'var(--green)' },
          { label: 'Atrasados', value: atrasados.length.toLocaleString('pt-BR'), color: atrasados.length > 0 ? 'var(--red)' : 'var(--green)', sub: fR(totalAtrasado) },
        ].map(k => (
          <div key={k.label} className="rounded-lg p-4" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ink3)' }}>{k.label}</div>
            <div className="text-[20px] font-bold leading-none tracking-tight" style={{ color: k.color }}>{k.value}</div>
            {k.sub && <div className="mt-1 text-[10px]" style={{ color: 'var(--ink3)' }}>{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Insights grid */}
      <div>
        <h2 className="text-[13px] font-semibold mb-3" style={{ color: 'var(--ink)' }}>Insights Automáticos</h2>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {insights.map((ins, i) => {
            const style = TYPE_STYLES[ins.type]
            return (
              <div
                key={i}
                className="rounded-lg p-4"
                style={{
                  background: style.bg,
                  border: `1px solid ${style.border}`,
                }}
              >
                <div className="flex items-start gap-2">
                  <span className="text-[18px] leading-none flex-shrink-0 mt-0.5">{ins.icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[12px] font-semibold" style={{ color: style.accent }}>
                        {ins.title}
                      </span>
                      <span
                        className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase"
                        style={{ background: style.accent, color: '#fff' }}
                      >
                        {style.label}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink2)' }}>
                      {ins.body}
                    </p>
                    {ins.val && (
                      <div className="mt-1.5 text-[13px] font-bold" style={{ color: style.accent }}>
                        {ins.val}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Sem categoria */}
      {semCat.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Lançamentos sem Categoria ({semCat.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th className="py-1.5 pl-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Data</th>
                  <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Descrição</th>
                  <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Tipo</th>
                  <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {semCat.slice(0, 50).map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td className="py-2 pl-3 text-[11px]" style={{ color: 'var(--ink3)' }}>{fDt(r.data)}</td>
                    <td className="py-2 text-[11px]" style={{ color: 'var(--ink2)' }}>{r.desc}</td>
                    <td className="py-2 text-[11px]">
                      <span
                        className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold"
                        style={{
                          background: r.tipo === 'Receita' ? 'var(--green-l)' : 'var(--red-l)',
                          color: r.tipo === 'Receita' ? 'var(--green)' : 'var(--red)',
                        }}
                      >
                        {r.tipo}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right text-[11px] font-semibold" style={{ color: r.tipo === 'Receita' ? 'var(--green)' : 'var(--red)' }}>
                      {fR(r.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Sem CC */}
      {semCC.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Lançamentos sem Centro de Custo ({semCC.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th className="py-1.5 pl-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Data</th>
                  <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Descrição</th>
                  <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Categoria</th>
                  <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {semCC.slice(0, 50).map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td className="py-2 pl-3 text-[11px]" style={{ color: 'var(--ink3)' }}>{fDt(r.data)}</td>
                    <td className="py-2 text-[11px]" style={{ color: 'var(--ink2)' }}>{r.desc}</td>
                    <td className="py-2 text-[11px]" style={{ color: 'var(--ink3)' }}>{r.cat1 || '—'}</td>
                    <td className="py-2 pr-3 text-right text-[11px] font-semibold" style={{ color: r.tipo === 'Receita' ? 'var(--green)' : 'var(--red)' }}>
                      {fR(r.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Atrasados */}
      {atrasados.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Lançamentos Atrasados ({atrasados.length}) — {fR(totalAtrasado)}</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th className="py-1.5 pl-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Data</th>
                  <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Descrição</th>
                  <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Fornecedor</th>
                  <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Situação</th>
                  <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {atrasados.slice(0, 50).map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td className="py-2 pl-3 text-[11px]" style={{ color: 'var(--ink3)' }}>{fDt(r.data)}</td>
                    <td className="py-2 text-[11px]" style={{ color: 'var(--ink2)' }}>{r.desc}</td>
                    <td className="py-2 text-[11px]" style={{ color: 'var(--ink3)' }}>{r.fornecedor}</td>
                    <td className="py-2 text-[11px]">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold" style={{ background: 'var(--red-l)', color: 'var(--red)' }}>
                        {r.situacao}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right text-[11px] font-semibold" style={{ color: r.tipo === 'Receita' ? 'var(--green)' : 'var(--red)' }}>
                      {fR(r.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
