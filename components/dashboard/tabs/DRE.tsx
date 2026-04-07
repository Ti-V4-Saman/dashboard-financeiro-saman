'use client'

import { useMemo, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import type { Lancamento } from '@/lib/types'
import { fR, gM, mLbl, getMonths } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'

interface Props {
  data: Lancamento[]
}

const DRE_ORDER = [
  '1 — Rec. Operacionais',
  '6.1 — Rec. Financeira',
  '2 — Deduções',
  '3 — Custos Operac.',
  '4 — Despesas',
  '5 — Depreciações',
  '6.2 — Desp. Financeira',
  '7 — Impostos s/ Lucro',
  'Outros',
]

const COLORS = ['#1B55A3', '#14703F', '#D41F1F', '#8B5B0D', '#384858', '#888480', '#B52C2C', '#45433D']

export function DRE({ data }: Props) {
  const [search, setSearch] = useState('')
  const [drillCat, setDrillCat] = useState<string | null>(null)

  const op = useMemo(() => data.filter(r => !r.isTransfer), [data])

  const dreGroups = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of op) {
      const g = gM(r.cat1)
      const sign = r.tipo === 'Receita' ? 1 : -1
      map.set(g, (map.get(g) || 0) + sign * r.valor)
    }
    return DRE_ORDER.filter(g => map.has(g)).map(g => ({
      grupo: g,
      valor: map.get(g)!,
    }))
  }, [op])

  // Subtotals
  const recTotal = dreGroups
    .filter(g => g.grupo.startsWith('1') || g.grupo.startsWith('6.1'))
    .reduce((s, g) => s + g.valor, 0)

  const deducoes = dreGroups
    .filter(g => g.grupo.startsWith('2'))
    .reduce((s, g) => s + g.valor, 0)

  const recLiq = recTotal + deducoes

  const custos = dreGroups
    .filter(g => g.grupo.startsWith('3') || g.grupo.startsWith('4') || g.grupo.startsWith('5'))
    .reduce((s, g) => s + g.valor, 0)

  const ebitda = recLiq + custos

  const desFin = dreGroups
    .filter(g => g.grupo.startsWith('6.2'))
    .reduce((s, g) => s + g.valor, 0)

  const imp = dreGroups
    .filter(g => g.grupo.startsWith('7'))
    .reduce((s, g) => s + g.valor, 0)

  const lucroLiq = ebitda + desFin + imp

  // Subcategories
  const subCats = useMemo(() => {
    const map = new Map<string, { grupo: string; valor: number; tipo: string }>()
    for (const r of op) {
      const cat = r.cat1 || 'Sem categoria'
      if (!map.has(cat)) {
        map.set(cat, { grupo: gM(cat), valor: 0, tipo: r.tipo })
      }
      const entry = map.get(cat)!
      entry.valor += r.tipo === 'Receita' ? r.valor : -r.valor
    }
    return Array.from(map.entries())
      .map(([nome, d]) => ({ nome, ...d }))
      .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor))
  }, [op])

  const filteredSubs = useMemo(() => {
    if (!search) return subCats
    const q = search.toLowerCase()
    return subCats.filter(
      s => s.nome.toLowerCase().includes(q) || s.grupo.toLowerCase().includes(q)
    )
  }, [subCats, search])

  // Drill-down data
  const drillData = useMemo(() => {
    if (!drillCat) return []
    const rows = op.filter(r => r.cat1 === drillCat)
    const months = getMonths(rows)
    return months.map(ym => {
      const monthRows = rows.filter(r => {
        if (!r.data) return false
        const m = `${r.data.getFullYear()}-${String(r.data.getMonth() + 1).padStart(2, '0')}`
        return m === ym
      })
      const total = monthRows.reduce(
        (s, r) => s + (r.tipo === 'Receita' ? r.valor : -r.valor),
        0
      )
      return { mes: mLbl(ym), total }
    })
  }, [drillCat, op])

  const drillRows = useMemo(() => {
    if (!drillCat) return []
    return op
      .filter(r => r.cat1 === drillCat)
      .sort((a, b) => (b.data?.getTime() || 0) - (a.data?.getTime() || 0))
  }, [drillCat, op])

  // Donut for costs
  const costDonut = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of op) {
      if (r.tipo !== 'Despesa') continue
      const g = gM(r.cat1)
      map.set(g, (map.get(g) || 0) + r.valor)
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [op])

  const recBruta = op.filter(r => r.tipo === 'Receita').reduce((s, r) => s + r.valor, 0)

  const renderRow = (label: string, valor: number, bold?: boolean, indent?: boolean) => (
    <tr key={label} style={{ borderBottom: '1px solid var(--line)' }}>
      <td
        className={`py-2 ${indent ? 'pl-6' : 'pl-3'} text-[11px]`}
        style={{ color: bold ? 'var(--ink)' : 'var(--ink2)', fontWeight: bold ? 600 : 400 }}
      >
        {label}
      </td>
      <td
        className="py-2 pr-3 text-right text-[11px] font-semibold"
        style={{ color: valor >= 0 ? 'var(--green)' : 'var(--red)' }}
      >
        {fR(valor)}
      </td>
      <td
        className="py-2 pr-3 text-right text-[11px]"
        style={{ color: 'var(--ink3)' }}
      >
        {recBruta > 0 ? `${((Math.abs(valor) / recBruta) * 100).toFixed(1)}%` : '—'}
      </td>
    </tr>
  )

  return (
    <div className="space-y-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: '5fr 4fr' }}>
        {/* DRE Table */}
        <Card>
          <CardHeader>
            <CardTitle>DRE — Demonstrativo de Resultado</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th className="py-1.5 pl-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Grupo</th>
                  <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Valor</th>
                  <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>% Rec.</th>
                </tr>
              </thead>
              <tbody>
                {dreGroups.map(g => renderRow(g.grupo, g.valor, false, true))}
                <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--surf2)' }}>
                  <td className="py-2 pl-3 text-[11px] font-semibold" style={{ color: 'var(--ink)' }}>Receita Bruta Total</td>
                  <td className="py-2 pr-3 text-right text-[11px] font-semibold" style={{ color: recTotal >= 0 ? 'var(--green)' : 'var(--red)' }}>{fR(recTotal)}</td>
                  <td className="py-2 pr-3 text-right text-[11px]" style={{ color: 'var(--ink3)' }}>100%</td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--surf2)' }}>
                  <td className="py-2 pl-3 text-[11px] font-semibold" style={{ color: 'var(--ink)' }}>Receita Líquida</td>
                  <td className="py-2 pr-3 text-right text-[11px] font-semibold" style={{ color: recLiq >= 0 ? 'var(--green)' : 'var(--red)' }}>{fR(recLiq)}</td>
                  <td className="py-2 pr-3 text-right text-[11px]" style={{ color: 'var(--ink3)' }}>{recBruta > 0 ? `${((recLiq / recBruta) * 100).toFixed(1)}%` : '—'}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--surf2)' }}>
                  <td className="py-2 pl-3 text-[11px] font-bold" style={{ color: 'var(--ink)' }}>EBITDA</td>
                  <td className="py-2 pr-3 text-right text-[11px] font-bold" style={{ color: ebitda >= 0 ? 'var(--green)' : 'var(--red)' }}>{fR(ebitda)}</td>
                  <td className="py-2 pr-3 text-right text-[11px]" style={{ color: 'var(--ink3)' }}>{recBruta > 0 ? `${((ebitda / recBruta) * 100).toFixed(1)}%` : '—'}</td>
                </tr>
                <tr style={{ background: 'var(--surf2)' }}>
                  <td className="py-2 pl-3 text-[11px] font-bold" style={{ color: 'var(--ink)' }}>Lucro Líquido</td>
                  <td className="py-2 pr-3 text-right text-[11px] font-bold" style={{ color: lucroLiq >= 0 ? 'var(--green)' : 'var(--red)' }}>{fR(lucroLiq)}</td>
                  <td className="py-2 pr-3 text-right text-[11px]" style={{ color: 'var(--ink3)' }}>{recBruta > 0 ? `${((lucroLiq / recBruta) * 100).toFixed(1)}%` : '—'}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Donut */}
        <Card>
          <CardHeader>
            <CardTitle>Distribuição de Custos</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={costDonut}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {costDonut.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number) => fR(v)}
                  contentStyle={{ border: '1px solid var(--line)', borderRadius: 6, background: 'var(--surface)', fontSize: 11 }}
                />
                <Legend layout="vertical" align="right" verticalAlign="middle" iconSize={8} wrapperStyle={{ fontSize: 10, color: 'var(--ink3)' }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Subcategories table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Subcategorias</CardTitle>
            <div className="relative w-48">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3" style={{ color: 'var(--ink3)' }} />
              <Input
                placeholder="Buscar..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-6"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <th className="py-1.5 pl-3 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Categoria</th>
                <th className="py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Grupo DRE</th>
                <th className="py-1.5 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink3)' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {filteredSubs.slice(0, 50).map(s => (
                <tr
                  key={s.nome}
                  style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                  className="hover:bg-[var(--surf2)] transition-colors"
                  onClick={() => setDrillCat(s.nome)}
                >
                  <td className="py-2 pl-3 text-[11px]" style={{ color: 'var(--ink2)' }}>{s.nome}</td>
                  <td className="py-2 text-[10px]" style={{ color: 'var(--ink3)' }}>{s.grupo}</td>
                  <td className="py-2 pr-3 text-right text-[11px] font-semibold" style={{ color: s.valor >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {fR(s.valor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Drill-down Dialog */}
      <Dialog open={!!drillCat} onOpenChange={open => !open && setDrillCat(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Drill-down: {drillCat}</DialogTitle>
          </DialogHeader>
          <div className="p-5 pt-3 space-y-4">
            {drillData.length > 0 && (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={drillData}>
                  <XAxis dataKey="mes" tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--ink3)' }} tickLine={false} axisLine={false} tickFormatter={v => `R$${Math.abs(v / 1000).toFixed(0)}K`} width={50} />
                  <Tooltip formatter={(v: number) => fR(v)} contentStyle={{ border: '1px solid var(--line)', borderRadius: 6, background: 'var(--surface)', fontSize: 11 }} />
                  <Bar dataKey="total" name="Valor" radius={[3, 3, 0, 0]}>
                    {drillData.map((d, i) => (
                      <Cell key={i} fill={d.total >= 0 ? 'var(--green)' : 'var(--red)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0" style={{ background: 'var(--surface)' }}>
                  <tr style={{ borderBottom: '1px solid var(--line)' }}>
                    <th className="py-1.5 pl-2 text-left text-[10px] font-semibold uppercase" style={{ color: 'var(--ink3)' }}>Data</th>
                    <th className="py-1.5 text-left text-[10px] font-semibold uppercase" style={{ color: 'var(--ink3)' }}>Descrição</th>
                    <th className="py-1.5 pr-2 text-right text-[10px] font-semibold uppercase" style={{ color: 'var(--ink3)' }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {drillRows.slice(0, 100).map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td className="py-1.5 pl-2 text-[11px]" style={{ color: 'var(--ink3)' }}>
                        {r.data ? `${String(r.data.getDate()).padStart(2,'0')}/${String(r.data.getMonth()+1).padStart(2,'0')}/${r.data.getFullYear()}` : '—'}
                      </td>
                      <td className="py-1.5 text-[11px]" style={{ color: 'var(--ink2)' }}>{r.desc}</td>
                      <td className="py-1.5 pr-2 text-right text-[11px] font-semibold" style={{ color: r.tipo === 'Receita' ? 'var(--green)' : 'var(--red)' }}>
                        {r.tipo === 'Receita' ? fR(r.valor) : `(${fR(r.valor)})`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
