'use client'

import { useState, useMemo } from 'react'
import useSWR from 'swr'
import type { Lancamento, Filters, Meta } from '@/lib/types'
import { fR } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type RowKind = 'l1' | 'l2' | 'l3' | 'subtotal' | 'ebitda' | 'resultado'

interface MetaRow {
  id: string
  kind: RowKind
  label: string
  l1Key?: string
  l2Key?: string
  planSigned: number
  realSigned: number
  planAbs?: number
  realAbs?: number
  pctExec?: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function numPrefix(s: string): number {
  const m = s.match(/^([\d.]+)/)
  return m ? parseFloat(m[1]) : 999
}

function fPct(ratio: number): string {
  return (ratio * 100).toFixed(1).replace('.', ',') + '%'
}

function fPctOfFat(val: number, fat: number): string {
  if (!fat) return '—'
  return ((val / fat) * 100).toFixed(1).replace('.', ',') + '%'
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

function getRealizadoRaw(m: Meta, allData: Lancamento[]): number {
  const [y, mo] = m.mes_referencia.split('-').map(Number)
  
  return allData
    .filter(r => {
      if (!r.data || r.isTransfer) return false
      if (r.situacao !== 'Quitado') return false
      if (r.tipo !== m.tipo_lancamento) return false
      if (r.data.getFullYear() !== y || r.data.getMonth() + 1 !== mo) return false
      
      if (m.tipo === 'centro_de_custo') {
        return (r.cc1 || '').toLowerCase() === (m.centro_de_custo || '').toLowerCase()
      } else {
        const cat3 = m.categoria_nivel_3 || m.categoria
        return (r.cat1 || '').toLowerCase() === (cat3 || '').toLowerCase()
      }
    })
    .reduce((s, r) => s + r.valor, 0)
}

// ─── Visual config ─────────────────────────────────────────────────────────────

const ROW_STYLE: Record<RowKind, { bg: string; fg: string; fw: number; fs: number; py: number }> = {
  l1:        { bg: 'var(--surf2)',   fg: 'var(--ink)',  fw: 700, fs: 12, py: 10 },
  l2:        { bg: 'var(--surface)', fg: 'var(--ink2)', fw: 600, fs: 11, py: 9  },
  l3:        { bg: 'var(--surface)', fg: 'var(--ink)',  fw: 400, fs: 11, py: 8  },
  subtotal:  { bg: 'var(--surf2)',   fg: 'var(--ink)',  fw: 700, fs: 12, py: 10 },
  ebitda:    { bg: '#fef9ec',        fg: '#92400e',     fw: 700, fs: 12, py: 11 },
  resultado: { bg: '#f0fdf4',        fg: '#166534',     fw: 700, fs: 12, py: 11 },
}

const INDENT: Record<RowKind, number> = {
  l1: 12, l2: 28, l3: 44, subtotal: 12, ebitda: 12, resultado: 12,
}

function StatusBadge({ ratio }: { ratio: number }) {
  if (ratio >= 1) return <span style={{ background: 'var(--red-l)', color: 'var(--red)', padding: '2px 9px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>Estourado</span>
  if (ratio >= 0.75) return <span style={{ background: 'var(--amber-l)', color: 'var(--amber)', padding: '2px 9px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>Atenção</span>
  return <span style={{ background: 'var(--green-l)', color: 'var(--green)', padding: '2px 9px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>Ok</span>
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface MetasTabProps {
  allData: Lancamento[]
  filters: Filters
}

export function MetasTab({ allData, filters }: MetasTabProps) {
  const { data: metas = [], isLoading, mutate } = useSWR<Meta[]>('/api/metas', fetcher, {
    refreshInterval: 5 * 60 * 1000,
  })

  const [view, setView] = useState<'dash' | 'manage'>('dash')
  const [editing, setEditing] = useState<Partial<Meta> | null>(null)
  const [saving, setSaving] = useState(false)

  const [c1, setC1] = useState<Set<string>>(new Set())
  const [c2, setC2] = useState<Set<string>>(new Set())
  const [cardFilter, setCardFilter] = useState<'all' | 'ok' | 'atencao' | 'estourado'>('all')

  const toggleCard = (id: 'all' | 'ok' | 'atencao' | 'estourado') =>
    setCardFilter(prev => prev === id ? 'all' : id)

  const toggleL1 = (l1: string) =>
    setC1(prev => { const n = new Set(prev); n.has(l1) ? n.delete(l1) : n.add(l1); return n })
  const toggleL2 = (l2: string) =>
    setC2(prev => { const n = new Set(prev); n.has(l2) ? n.delete(l2) : n.add(l2); return n })

  const fromMonth = filters.dateFrom.slice(0, 7)
  const toMonth   = filters.dateTo.slice(0, 7)

  // ─── Actions ────────────────────────────────────────────────────────────────

  const saveMeta = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing) return
    setSaving(true)
    try {
      const payload = {
        ...editing,
        id: editing.id || `meta-${Date.now()}`,
        tipo: editing.tipo || 'categoria',
        mes_referencia: editing.mes_referencia || new Date().toISOString().slice(0, 7),
        valor_planejado: Number(editing.valor_planejado || 0),
        tipo_lancamento: editing.tipo_lancamento || 'Despesa',
      }
      await fetch('/api/metas', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      mutate()
      setEditing(null)
    } catch (err) {
      alert('Erro ao salvar meta')
    } finally {
      setSaving(false)
    }
  }

  const deleteMeta = async (id: string) => {
    if (!confirm('Excluir esta meta?')) return
    try {
      await fetch(`/api/metas?id=${id}`, { method: 'DELETE' })
      mutate()
    } catch (err) {
      alert('Erro ao excluir')
    }
  }

  // ─── Data Processing ────────────────────────────────────────────────────────

  const faturamento = useMemo(() => {
    const from = new Date(filters.dateFrom)
    const to   = new Date(filters.dateTo + 'T23:59:59')
    return allData
      .filter(r => r.data && r.tipo === 'Receita' && r.situacao === 'Quitado' && !r.isTransfer && r.data >= from && r.data <= to)
      .reduce((s, r) => s + r.valor, 0)
  }, [allData, filters])

  const metasNoPeriodo = useMemo(
    () => metas.filter(m => m.mes_referencia >= fromMonth && m.mes_referencia <= toMonth),
    [metas, fromMonth, toMonth],
  )

  const enriched = useMemo(
    () =>
      metasNoPeriodo.map(m => {
        const sign    = m.tipo_lancamento === 'Receita' ? 1 : -1
        const realRaw = getRealizadoRaw(m, allData)
        return {
          ...m,
          planSigned: sign * m.valor_planejado,
          realSigned: sign * realRaw,
          planAbs:    m.valor_planejado,
          realAbs:    realRaw,
          pctExec:    m.valor_planejado > 0 ? realRaw / m.valor_planejado : 0,
        }
      }),
    [metasNoPeriodo, allData],
  )

  const catHierMap = useMemo(() => {
    const m = new Map<string, { catSup: string; catSup1: string }>()
    for (const r of allData) {
      if (r.cat1 && !m.has(r.cat1))
        m.set(r.cat1, { catSup: r.catSup || r.catSup1 || r.cat1, catSup1: r.catSup1 || r.cat1 })
    }
    return m
  }, [allData])

  const hier = useMemo(() => {
    const map = new Map<string, Map<string, Map<string, { planSigned: number; realSigned: number; planAbs: number; realAbs: number }>>>()
    for (const m of enriched) {
      const l3 = m.categoria_nivel_3 || m.categoria || '(sem categoria)'
      const lookup = catHierMap.get(l3)
      const l1 = m.categoria_nivel_1 || (lookup?.catSup1 || l3)
      const l2 = m.categoria_nivel_2 || (lookup?.catSup  || l1)

      if (!map.has(l1)) map.set(l1, new Map())
      if (!map.get(l1)!.has(l2)) map.get(l1)!.set(l2, new Map())
      if (!map.get(l1)!.get(l2)!.has(l3))
        map.get(l1)!.get(l2)!.set(l3, { planSigned: 0, realSigned: 0, planAbs: 0, realAbs: 0 })

      const agg = map.get(l1)!.get(l2)!.get(l3)!
      agg.planSigned += m.planSigned
      agg.realSigned += m.realSigned
      agg.planAbs    += m.planAbs
      agg.realAbs    += m.realAbs
    }

    return [...map.entries()]
      .sort(([a], [b]) => numPrefix(a) - numPrefix(b))
      .map(([l1, l2map]) => {
        const l2list = [...l2map.entries()]
          .sort(([a], [b]) => numPrefix(a) - numPrefix(b))
          .map(([l2, l3map]) => {
            const l3list = [...l3map.entries()]
              .sort(([a], [b]) => numPrefix(a) - numPrefix(b))
              .map(([l3, agg]) => ({
                l3, ...agg,
                pctExec: agg.planAbs > 0 ? agg.realAbs / agg.planAbs : 0,
              }))
            return {
              l2,
              planSigned: l3list.reduce((s, x) => s + x.planSigned, 0),
              realSigned: l3list.reduce((s, x) => s + x.realSigned, 0),
              children:   l3list,
            }
          })
        return {
          l1,
          planSigned: l2list.reduce((s, x) => s + x.planSigned, 0),
          realSigned: l2list.reduce((s, x) => s + x.realSigned, 0),
          children:   l2list,
        }
      })
  }, [enriched, catHierMap])

  const groupSum = (key: 'planSigned' | 'realSigned', maxPfx: number) =>
    hier.filter(h => numPrefix(h.l1) <= maxPfx).reduce((s, h) => s + h[key], 0)

  const summary = useMemo(() => {
    const l3all = hier.flatMap(h => h.children.flatMap(l2 => l2.children))
    return {
      cadastradas: metasNoPeriodo.length,
      ok:          l3all.filter(r => r.pctExec < 0.75).length,
      atencao:     l3all.filter(r => r.pctExec >= 0.75 && r.pctExec < 1).length,
      estouradas:  l3all.filter(r => r.pctExec >= 1).length,
    }
  }, [hier, metasNoPeriodo])

  const tableRows = useMemo(() => {
    const fatLiqPlan    = groupSum('planSigned', 2.99)
    const fatLiqReal    = groupSum('realSigned', 2.99)
    const lucroBrutoPlan = groupSum('planSigned', 3.99)
    const lucroBrutoReal = groupSum('realSigned', 3.99)
    const ebitdaPlan    = groupSum('planSigned', 4.99)
    const ebitdaReal    = groupSum('realSigned', 4.99)
    const resLiqPlan    = groupSum('planSigned', 99)
    const resLiqReal    = groupSum('realSigned', 99)

    const passesFilter = (pctExec: number) => {
      if (cardFilter === 'all') return true
      if (cardFilter === 'ok') return pctExec < 0.75
      if (cardFilter === 'atencao') return pctExec >= 0.75 && pctExec < 1
      return pctExec >= 1
    }

    const rows: MetaRow[] = []
    for (let i = 0; i < hier.length; i++) {
      const { l1, planSigned, realSigned, children: l2s } = hier[i]
      const prefix = numPrefix(l1)
      const l1HasMatch = cardFilter === 'all' || l2s.some(l2 => l2.children.some(l3 => passesFilter(l3.pctExec)))
      if (!l1HasMatch) {
        const nextPfx = i + 1 < hier.length ? numPrefix(hier[i + 1].l1) : Infinity
        if (prefix <= 2 && nextPfx > 2) rows.push({ id: '__fatLiq__', kind: 'subtotal', label: '(=) Faturamento Líquido', planSigned: groupSum('planSigned', 2.99), realSigned: groupSum('realSigned', 2.99) })
        if (prefix <= 3 && nextPfx > 3) rows.push({ id: '__lucroBruto__', kind: 'subtotal', label: '(=) Lucro Bruto', planSigned: groupSum('planSigned', 3.99), realSigned: groupSum('realSigned', 3.99) })
        if (prefix <= 4 && nextPfx > 4) rows.push({ id: '__ebitda__', kind: 'ebitda', label: '(=) EBITDA', planSigned: groupSum('planSigned', 4.99), realSigned: groupSum('realSigned', 4.99) })
        if (i === hier.length - 1) rows.push({ id: '__resLiq__', kind: 'resultado', label: '(=) Resultado Líquido', planSigned: groupSum('planSigned', 99), realSigned: groupSum('realSigned', 99) })
        continue
      }
      rows.push({ id: `l1::${l1}`, kind: 'l1', label: l1, l1Key: l1, planSigned, realSigned })
      if (!c1.has(l1)) {
        for (const { l2, planSigned: p2, realSigned: r2, children: l3s } of l2s) {
          if (cardFilter !== 'all' && !l3s.some(l3 => passesFilter(l3.pctExec))) continue
          rows.push({ id: `l2::${l2}`, kind: 'l2', label: l2, l1Key: l1, l2Key: l2, planSigned: p2, realSigned: r2 })
          if (!c2.has(l2)) {
            for (const { l3, planSigned: p3, realSigned: r3, planAbs, realAbs, pctExec } of l3s) {
              if (!passesFilter(pctExec)) continue
              rows.push({ id: `l3::${l1}::${l2}::${l3}`, kind: 'l3', label: l3, l1Key: l1, l2Key: l2, planSigned: p3, realSigned: r3, planAbs, realAbs, pctExec })
            }
          }
        }
      }
      const nextPfx = i + 1 < hier.length ? numPrefix(hier[i + 1].l1) : Infinity
      if (prefix <= 2 && nextPfx > 2) rows.push({ id: '__fatLiq__', kind: 'subtotal', label: '(=) Faturamento Líquido', planSigned: fatLiqPlan, realSigned: fatLiqReal })
      if (prefix <= 3 && nextPfx > 3) rows.push({ id: '__lucroBruto__', kind: 'subtotal', label: '(=) Lucro Bruto', planSigned: lucroBrutoPlan, realSigned: lucroBrutoReal })
      if (prefix <= 4 && nextPfx > 4) rows.push({ id: '__ebitda__', kind: 'ebitda', label: '(=) EBITDA', planSigned: ebitdaPlan, realSigned: ebitdaReal })
      if (i === hier.length - 1) rows.push({ id: '__resLiq__', kind: 'resultado', label: '(=) Resultado Líquido', planSigned: resLiqPlan, realSigned: resLiqReal })
    }
    return rows
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hier, c1, c2, cardFilter])

  const renderDashboard = () => (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        {[
          { id: 'all' as const, label: 'Metas cadastradas', value: summary.cadastradas, color: 'var(--blue)' },
          { id: 'ok' as const, label: 'Dentro da meta', value: summary.ok, color: 'var(--green)' },
          { id: 'atencao' as const, label: 'Em atenção', value: summary.atencao, color: 'var(--amber)' },
          { id: 'estourado' as const, label: 'Estouradas', value: summary.estouradas, color: 'var(--red)' },
        ].map(card => {
          const active = cardFilter === card.id
          return (
            <div key={card.id} onClick={() => toggleCard(card.id)} style={{ background: 'var(--surface)', border: active ? `2px solid ${card.color}` : '1px solid var(--line)', borderRadius: 10, padding: active ? '15px 19px' : '16px 20px', cursor: 'pointer', boxShadow: active ? `0 0 0 3px ${card.color}22` : 'none' }}>
              <div style={{ fontSize: 11, color: active ? card.color : 'var(--ink3)', marginBottom: 6, fontWeight: active ? 600 : 400 }}>{card.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: card.color }}>{card.value}</div>
            </div>
          )
        })}
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: 780, width: '100%' }}>
            <thead>
              <tr style={{ background: 'var(--surf2)', borderBottom: '2px solid var(--line2)' }}>
                <th style={{ position: 'sticky', left: 0, zIndex: 3, background: 'var(--surf2)', padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--ink3)', minWidth: 260, borderRight: '2px solid var(--line)' }}>Descrição</th>
                {['Meta R$', 'Meta %', 'Realizado R$', 'Real %', '% Exec', 'Status'].map(col => (
                  <th key={col} style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--ink3)', borderLeft: '1px solid var(--line)' }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map(row => {
                const s = ROW_STYLE[row.kind]
                const isL3 = row.kind === 'l3'
                const collapsed = row.kind === 'l1' ? c1.has(row.l1Key!) : row.kind === 'l2' ? c2.has(row.l2Key!) : false
                const arrow = (row.kind === 'l1' || row.kind === 'l2') ? (collapsed ? '▸ ' : '▾ ') : ''

                return (
                  <tr key={row.id} style={{ background: s.bg, borderBottom: '1px solid var(--line)', borderTop: (row.kind !== 'l1' && row.kind !== 'l2' && row.kind !== 'l3') ? '2px solid var(--line2)' : undefined }}>
                    <td onClick={() => { if (row.kind === 'l1') toggleL1(row.l1Key!); if (row.kind === 'l2') toggleL2(row.l2Key!); }} style={{ position: 'sticky', left: 0, zIndex: 2, background: s.bg, color: s.fg, fontWeight: s.fw, fontSize: s.fs, padding: `${s.py}px 16px ${s.py}px ${INDENT[row.kind]}px`, cursor: arrow ? 'pointer' : 'default', borderRight: '2px solid var(--line)' }}>{arrow}{row.label}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: s.fs, fontWeight: isL3 ? 400 : s.fw, color: row.planSigned >= 0 ? 'var(--green)' : 'var(--red)', borderLeft: '1px solid var(--line)' }}>{fR(row.planSigned)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 10, color: 'var(--ink3)' }}>{isL3 ? fPctOfFat(row.planSigned, faturamento) : '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: s.fs, fontWeight: isL3 ? 400 : s.fw, color: row.realSigned >= 0 ? 'var(--green)' : 'var(--red)', borderLeft: '1px solid var(--line)' }}>{fR(row.realSigned)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 10, color: 'var(--ink3)' }}>{isL3 ? fPctOfFat(row.realSigned, faturamento) : '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', borderLeft: '1px solid var(--line)' }}>
                      {isL3 && row.pctExec !== undefined ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                          <div style={{ width: 60, height: 5, background: 'var(--surf3)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(row.pctExec, 1) * 100}%`, height: '100%', background: row.pctExec >= 1 ? 'var(--red)' : row.pctExec >= 0.75 ? 'var(--amber-m)' : 'var(--green)' }} />
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 600 }}>{fPct(row.pctExec)}</span>
                        </div>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', borderLeft: '1px solid var(--line)' }}>
                      {isL3 && row.pctExec !== undefined && <StatusBadge ratio={row.pctExec} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )

  const renderManage = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{editing?.id ? 'Editar Meta' : 'Nova Meta'}</h3>
        <form onSubmit={saveMeta} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink3)', marginBottom: 4 }}>Mês de Referência</label>
            <input type="month" value={editing?.mes_referencia || ''} onChange={e => setEditing({...editing, mes_referencia: e.target.value})} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--line2)', fontSize: 12 }} required />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink3)', marginBottom: 4 }}>Tipo Lançamento</label>
            <select value={editing?.tipo_lancamento || 'Despesa'} onChange={e => setEditing({...editing, tipo_lancamento: e.target.value as any})} style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--line2)', fontSize: 12 }}>
              <option value="Receita">Receita</option>
              <option value="Despesa">Despesa</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink3)', marginBottom: 4 }}>Categoria (ContaAzul)</label>
            <input type="text" value={editing?.categoria || ''} onChange={e => setEditing({...editing, categoria: e.target.value, categoria_nivel_3: e.target.value})} placeholder="Ex: 2.1.03 ISS" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--line2)', fontSize: 12 }} required />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink3)', marginBottom: 4 }}>Valor Planejado</label>
            <input type="number" step="0.01" value={editing?.valor_planejado || ''} onChange={e => setEditing({...editing, valor_planejado: Number(e.target.value)})} placeholder="0.00" style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--line2)', fontSize: 12 }} required />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="submit" disabled={saving} style={{ background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>{saving ? 'Salvando...' : 'Salvar Meta'}</button>
            <button type="button" onClick={() => setEditing(null)} style={{ background: 'var(--surf2)', color: 'var(--ink2)', border: '1px solid var(--line2)', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
          </div>
        </form>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: 'var(--surf2)', borderBottom: '1px solid var(--line2)' }}>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Mês</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Tipo</th>
              <th style={{ padding: '12px 16px', textAlign: 'left' }}>Categoria</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Valor</th>
              <th style={{ padding: '12px 16px', textAlign: 'center' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {metas.map(m => (
              <tr key={m.id} style={{ borderBottom: '1px solid var(--line)' }}>
                <td style={{ padding: '10px 16px' }}>{m.mes_referencia}</td>
                <td style={{ padding: '10px 16px' }}><span style={{ color: m.tipo_lancamento === 'Receita' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{m.tipo_lancamento}</span></td>
                <td style={{ padding: '10px 16px' }}>{m.categoria}</td>
                <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600 }}>{fR(m.valor_planejado)}</td>
                <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                    <button onClick={() => { setEditing(m); window.scrollTo({ top: 0, behavior: 'smooth' }); }} style={{ background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Editar</button>
                    <button onClick={() => deleteMeta(m.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Excluir</button>
                  </div>
                </td>
              </tr>
            ))}
            {metas.length === 0 && <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: 'var(--ink3)' }}>Nenhuma meta cadastrada.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{view === 'dash' ? 'Metas vs Realizado' : 'Gerenciador de Metas'}</h2>
          <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 3 }}>{view === 'dash' ? `Faturamento do período: ${fR(faturamento)}` : 'Adicione ou edite metas cadastradas no banco de dados'}</p>
        </div>
        <button onClick={() => setView(view === 'dash' ? 'manage' : 'dash')} style={{ background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 6, padding: '6px 12px', fontSize: 11, fontWeight: 600, color: 'var(--ink2)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          {view === 'dash' ? '⚙ Gerenciar Metas' : '📊 Voltar ao Dashboard'}
        </button>
      </div>
      {isLoading && metas.length === 0 ? <div style={{ color: 'var(--ink3)', fontSize: 12, padding: '32px 0', textAlign: 'center' }}>Carregando metas...</div> : (view === 'dash' ? renderDashboard() : renderManage())}
    </div>
  )
}
