'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import useSWR from 'swr'
import type { Lancamento, Filters, Meta } from '@/lib/types'
import { fR, parseCatHier, getL2Label } from '@/lib/utils'
import { DRE_LEAVES, NON_DRE_ROWS, KPI_ROWS, ALL_CATEGORY_LEAVES } from '@/lib/categoryTree'
import { MetaReplicateModal } from '@/components/dashboard/metas/MetaReplicateModal'
import { MetaBulkEditModal, type BulkUpdate } from '@/components/dashboard/metas/MetaBulkEditModal'
import { MetaImportModal } from '@/components/dashboard/metas/MetaImportModal'

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
  pctExec?: number | null
  hasMeta?: boolean
  tipoLancamento?: 'Receita' | 'Despesa'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function numPrefix(s: string): number {
  const m = s.match(/^([\d.]+)/)
  return m ? parseFloat(m[1]) : 999
}

function isReceita(l1: string): boolean {
  return l1.startsWith('1') || l1.startsWith('6.1')
}

function fPct(ratio: number): string {
  return (ratio * 100).toFixed(1).replace('.', ',') + '%'
}

function fPctOfFat(val: number, fat: number): string {
  if (!fat) return '—'
  return ((val / fat) * 100).toFixed(1).replace('.', ',') + '%'
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

/** Filtro de "realizado" sensível ao regime contábil.
 *  Caixa  → só Quitado (pagamentos efetivos / baixas)
 *  Competência → todos os status válidos exceto Cancelado/Renegociado */
function isRealizado(situacao: string, isCaixa: boolean): boolean {
  if (isCaixa) return situacao === 'Quitado'
  return situacao !== 'Cancelado' && situacao !== 'Renegociado'
}

function getRealizadoRaw(m: Meta, allData: Lancamento[], isCaixa: boolean): number {
  const [y, mo] = m.mes_referencia.split('-').map(Number)
  return allData
    .filter(r => {
      if (!r.data || r.isTransfer) return false
      if (!isRealizado(r.situacao, isCaixa)) return false
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

function StatusBadge({ ratio, tipoLancamento = 'Despesa' }: { ratio: number; tipoLancamento?: 'Receita' | 'Despesa' }) {
  if (tipoLancamento === 'Receita') {
    if (ratio >= 1)    return <span style={{ background: 'var(--green-l)', color: 'var(--green)', padding: '2px 9px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>Meta Batida</span>
    if (ratio >= 0.75) return <span style={{ background: 'var(--amber-l)', color: 'var(--amber)', padding: '2px 9px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>Atenção</span>
    return             <span style={{ background: 'var(--red-l)',   color: 'var(--red)',   padding: '2px 9px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>Crítico</span>
  }
  if (ratio >= 1)    return <span style={{ background: 'var(--red-l)',   color: 'var(--red)',   padding: '2px 9px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>Estourado</span>
  if (ratio >= 0.75) return <span style={{ background: 'var(--amber-l)', color: 'var(--amber)', padding: '2px 9px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>Atenção</span>
  return             <span style={{ background: 'var(--green-l)', color: 'var(--green)', padding: '2px 9px', borderRadius: 4, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>Ok</span>
}

function SemMetaBadge() {
  return <span style={{ background: 'var(--surf2)', color: 'var(--ink3)', padding: '2px 9px', borderRadius: 4, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', border: '1px dashed var(--line2)' }}>Sem meta</span>
}

// Agrupar leaves da árvore estática para o <select> do formulário
const FORM_GROUPS = (() => {
  const groups: { label: string; leaves: typeof ALL_CATEGORY_LEAVES }[] = []
  const map = new Map<string, typeof ALL_CATEGORY_LEAVES>()

  for (const leaf of ALL_CATEGORY_LEAVES) {
    let groupKey: string
    if (leaf.isKpi) {
      groupKey = '📊 KPIs'
    } else if (leaf.isNonDre) {
      groupKey = '📋 Não-DRE / Caixa'
    } else {
      const { l1 } = parseCatHier(leaf.fullName)
      groupKey = l1
    }
    if (!map.has(groupKey)) {
      map.set(groupKey, [])
      groups.push({ label: groupKey, leaves: map.get(groupKey)! })
    }
    map.get(groupKey)!.push(leaf)
  }
  return groups
})()

// ─── Main Component ───────────────────────────────────────────────────────────

interface MetasTabProps {
  allData: Lancamento[]
  filters: Filters
  /** Só admins podem gerenciar (criar/editar/excluir) metas — a API impõe 403. */
  isAdmin?: boolean
}

export function MetasTab({ allData, filters, isAdmin = false }: MetasTabProps) {
  const { data: metas = [], isLoading, mutate } = useSWR<Meta[]>('/api/metas', fetcher, {
    refreshInterval: 5 * 60 * 1000,
  })

  const [view, setView] = useState<'dash' | 'manage'>('dash')
  const [editing, setEditing] = useState<Partial<Meta> & { tipo_valor?: 'reais' | 'percentual' } | null>(null)
  const [saving, setSaving] = useState(false)

  // ── Estado do Gerenciador ──────────────────────────────────────────────────
  const [searchManage, setSearchManage]   = useState('')
  const [debSearch, setDebSearch]         = useState('')
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set())
  const [showReplicateFor, setShowReplicateFor] = useState<Meta | null>(null)
  const [showBulk, setShowBulk]           = useState(false)
  const [showImport, setShowImport]       = useState(false)
  const searchDebRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (searchDebRef.current) clearTimeout(searchDebRef.current)
    searchDebRef.current = setTimeout(() => setDebSearch(searchManage), 200)
    return () => {
      if (searchDebRef.current) clearTimeout(searchDebRef.current)
    }
  }, [searchManage])

  // Sanfona — set de EXPANDIDOS (vazio = tudo fechado por padrão)
  const [exp1, setExp1] = useState<Set<string>>(new Set())
  const [exp2, setExp2] = useState<Set<string>>(new Set())
  const [cardFilter, setCardFilter] = useState<'all' | 'ok' | 'atencao' | 'estourado' | 'sem_meta'>('all')

  const toggleCard = (id: 'all' | 'ok' | 'atencao' | 'estourado' | 'sem_meta') =>
    setCardFilter(prev => prev === id ? 'all' : id)

  const toggleL1 = (l1: string) =>
    setExp1(prev => { const n = new Set(prev); n.has(l1) ? n.delete(l1) : n.add(l1); return n })
  const toggleL2 = (l2: string) =>
    setExp2(prev => { const n = new Set(prev); n.has(l2) ? n.delete(l2) : n.add(l2); return n })

  const fromMonth = filters.dateFrom.slice(0, 7)
  const toMonth   = filters.dateTo.slice(0, 7)

  // ─── Actions ────────────────────────────────────────────────────────────────

  const saveMeta = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing) return
    setSaving(true)
    try {
      const cat = editing.categoria || ''
      const { l1, l2 } = parseCatHier(cat)
      const payload = {
        ...editing,
        id: editing.id || `meta-${Date.now()}`,
        tipo: editing.tipo || 'categoria',
        mes_referencia: editing.mes_referencia || new Date().toISOString().slice(0, 7),
        valor_planejado: Number(editing.valor_planejado || 0),
        tipo_lancamento: editing.tipo_lancamento || 'Despesa',
        categoria_nivel_1: editing.categoria_nivel_1 || l1,
        categoria_nivel_2: editing.categoria_nivel_2 || l2,
        categoria_nivel_3: editing.categoria_nivel_3 || cat,
        observacao: editing.observacao || (editing.tipo_valor === 'percentual' ? `tipo_valor:percentual` : ''),
      }
      // Não persistir tipo_valor — é apenas estado local de UI
      delete (payload as any).tipo_valor
      await fetch('/api/metas', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      mutate()
      setEditing(null)
      // Abre modal de replicar SE for criação nova (não edição) com valor > 0
      const eraNovo = !editing.id
      if (eraNovo && payload.valor_planejado > 0) {
        setShowReplicateFor(payload as Meta)
      }
    } catch {
      alert('Erro ao salvar meta')
    } finally {
      setSaving(false)
    }
  }

  // ── Bulk handlers ──────────────────────────────────────────────────────────

  const replicarMeta = async (base: Meta, meses: string[], _sobrescrever: boolean) => {
    if (meses.length === 0) return
    try {
      const novas = meses.map(mes => ({
        ...base,
        id: crypto.randomUUID(),
        mes_referencia: mes,
        criado_em: new Date().toISOString(),
      }))
      const res = await fetch('/api/metas/bulk', {
        method: 'POST',
        body: JSON.stringify({ metas: novas }),
      })
      if (!res.ok) throw new Error('bulk failed')
      await mutate()
    } catch {
      alert('Erro ao replicar metas')
    }
  }

  const aplicarBulkEdit = async (updates: BulkUpdate) => {
    const ids = Array.from(selectedIds)
    const alvo = metas.filter(m => ids.includes(m.id))
    const atualizados = alvo.map(m => {
      const next = { ...m }
      if (updates.valor_planejado != null) next.valor_planejado = updates.valor_planejado
      if (updates.tipo_lancamento)         next.tipo_lancamento = updates.tipo_lancamento
      if (updates.mes_referencia)          next.mes_referencia  = updates.mes_referencia
      if (updates.tipo_valor) {
        // tipo_valor é gravado na observacao
        const sufixo = 'tipo_valor:percentual'
        const obsLimpa = (next.observacao || '').replace(sufixo, '').trim()
        next.observacao = updates.tipo_valor === 'percentual'
          ? (obsLimpa ? `${obsLimpa} ${sufixo}` : sufixo)
          : obsLimpa
      }
      return next
    })
    try {
      const res = await fetch('/api/metas/bulk', {
        method: 'POST',
        body: JSON.stringify({ metas: atualizados }),
      })
      if (!res.ok) throw new Error('bulk update failed')
      await mutate()
      setSelectedIds(new Set())
    } catch {
      alert('Erro ao atualizar metas em massa')
    }
  }

  const excluirSelecionadas = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`Excluir ${selectedIds.size} meta(s) selecionada(s)?`)) return
    try {
      const ids = Array.from(selectedIds).join(',')
      await fetch(`/api/metas/bulk?ids=${ids}`, { method: 'DELETE' })
      await mutate()
      setSelectedIds(new Set())
    } catch {
      alert('Erro ao excluir')
    }
  }

  const importarMetas = async (novas: Omit<Meta, 'criado_em'>[]) => {
    try {
      const res = await fetch('/api/metas/bulk', {
        method: 'POST',
        body: JSON.stringify({ metas: novas }),
      })
      if (!res.ok) throw new Error('import failed')
      const data = await res.json()
      await mutate()
      alert(`Importação concluída: ${data.inserted} criadas, ${data.updated} atualizadas${data.errors?.length ? `, ${data.errors.length} com erro` : ''}.`)
    } catch {
      alert('Erro na importação')
    }
  }

  const deleteMeta = async (id: string) => {
    if (!confirm('Excluir esta meta?')) return
    try {
      await fetch(`/api/metas?id=${id}`, { method: 'DELETE' })
      mutate()
    } catch {
      alert('Erro ao excluir')
    }
  }

  // ─── Data Processing ────────────────────────────────────────────────────────

  const isCaixa = (filters.regime ?? 'competencia') === 'caixa'

  const faturamento = useMemo(() => {
    const from = new Date(filters.dateFrom)
    const to   = new Date(filters.dateTo + 'T23:59:59')
    return allData
      .filter(r => r.data && r.tipo === 'Receita' && isRealizado(r.situacao, isCaixa) && !r.isTransfer && r.data >= from && r.data <= to)
      .reduce((s, r) => s + r.valor, 0)
  }, [allData, filters, isCaixa])

  const metasNoPeriodo = useMemo(
    () => metas.filter(m => m.mes_referencia >= fromMonth && m.mes_referencia <= toMonth),
    [metas, fromMonth, toMonth],
  )

  // ── Busca textual no Gerenciador (filtra em todas as colunas) ──────────────
  const metasFiltradas = useMemo(() => {
    if (!debSearch.trim()) return metas
    const q = debSearch.toLowerCase().trim()
    return metas.filter(m =>
      (m.mes_referencia || '').toLowerCase().includes(q) ||
      (m.categoria      || '').toLowerCase().includes(q) ||
      (m.tipo_lancamento|| '').toLowerCase().includes(q) ||
      (m.observacao     || '').toLowerCase().includes(q) ||
      String(m.valor_planejado || '').includes(q) ||
      fR(m.valor_planejado).toLowerCase().includes(q),
    )
  }, [metas, debSearch])

  const enriched = useMemo(
    () =>
      metasNoPeriodo.map(m => {
        const sign    = m.tipo_lancamento === 'Receita' ? 1 : -1
        const realRaw = getRealizadoRaw(m, allData, isCaixa)
        return {
          ...m,
          planSigned: sign * m.valor_planejado,
          realSigned: sign * realRaw,
          planAbs:    m.valor_planejado,
          realAbs:    realRaw,
          pctExec:    m.valor_planejado > 0 ? realRaw / m.valor_planejado : 0,
        }
      }),
    [metasNoPeriodo, allData, isCaixa],
  )

  // Valores realizados por cat1 (todos os lançamentos quitados do período)
  const realByL3 = useMemo(() => {
    const from = new Date(filters.dateFrom)
    const to   = new Date(filters.dateTo + 'T23:59:59')
    const map  = new Map<string, number>()
    for (const r of allData) {
      if (!r.data || r.isTransfer || !isRealizado(r.situacao, isCaixa)) continue
      if (r.data < from || r.data > to) continue
      if (!r.cat1) continue
      const sign = r.tipo === 'Receita' ? 1 : -1
      map.set(r.cat1, (map.get(r.cat1) ?? 0) + sign * r.valor)
    }
    return map
  }, [allData, filters, isCaixa])

  // Valores planejados por cat3 (metas enriquecidas)
  const planByL3 = useMemo(() => {
    const map = new Map<string, { planSigned: number; planAbs: number }>()
    for (const m of enriched) {
      const l3 = m.categoria_nivel_3 || m.categoria || '(sem categoria)'
      if (!map.has(l3)) map.set(l3, { planSigned: 0, planAbs: 0 })
      map.get(l3)!.planSigned += m.planSigned
      map.get(l3)!.planAbs   += (m.planAbs ?? 0)
    }
    return map
  }, [enriched])

  // ─── Hierarquia DRE (sempre com todas as linhas da árvore estática) ──────────

  const hier = useMemo(() => {
    // Nomes a excluir do DRE (linhas não-DRE e KPI ficam em seções separadas)
    const excludeFromDre = new Set([
      ...NON_DRE_ROWS.map(r => r.fullName),
      ...KPI_ROWS.map(r => r.fullName),
    ])

    // União: árvore estática + dados reais + metas cadastradas (só DRE)
    const allL3 = new Set<string>([
      ...DRE_LEAVES.map(l => l.fullName),
      ...[...realByL3.keys()].filter(k => !excludeFromDre.has(k)),
      ...[...planByL3.keys()].filter(k => !excludeFromDre.has(k)),
    ])

    // Monta l1 → l2 → l3
    const l1Map = new Map<string, Map<string, Map<string, {
      planSigned: number; realSigned: number; planAbs: number; realAbs: number; hasMeta: boolean
    }>>>()

    for (const l3 of allL3) {
      const { l1, l2 } = parseCatHier(l3)
      const realSigned = realByL3.get(l3) ?? 0
      const plan       = planByL3.get(l3) ?? { planSigned: 0, planAbs: 0 }
      const hasMeta    = planByL3.has(l3)

      if (!l1Map.has(l1)) l1Map.set(l1, new Map())
      if (!l1Map.get(l1)!.has(l2)) l1Map.get(l1)!.set(l2, new Map())
      l1Map.get(l1)!.get(l2)!.set(l3, {
        planSigned: plan.planSigned,
        realSigned,
        planAbs:   plan.planAbs,
        realAbs:   Math.abs(realSigned),
        hasMeta,
      })
    }

    return [...l1Map.entries()]
      .sort(([a], [b]) => numPrefix(a) - numPrefix(b))
      .map(([l1, l2map]) => {
        const l2list = [...l2map.entries()]
          .sort(([a], [b]) => numPrefix(a) - numPrefix(b))
          .map(([l2, l3map]) => {
            const l3list = [...l3map.entries()]
              .sort(([a], [b]) => numPrefix(a) - numPrefix(b))
              .map(([l3, agg]) => ({
                l3, ...agg,
                pctExec: agg.planAbs > 0 ? agg.realAbs / agg.planAbs : (agg.hasMeta ? 0 : null),
              }))
            return {
              l2: getL2Label(l2),
              l2Key: l2,
              planSigned: l3list.reduce((s, x) => s + x.planSigned, 0),
              realSigned: l3list.reduce((s, x) => s + x.realSigned, 0),
              planAbs:    l3list.reduce((s, x) => s + x.planAbs,    0),
              realAbs:    l3list.reduce((s, x) => s + x.realAbs,    0),
              children:   l3list,
            }
          })
        return {
          l1,
          planSigned: l2list.reduce((s, x) => s + x.planSigned, 0),
          realSigned: l2list.reduce((s, x) => s + x.realSigned, 0),
          planAbs:    l2list.reduce((s, x) => s + x.planAbs,    0),
          realAbs:    l2list.reduce((s, x) => s + x.realAbs,    0),
          children:   l2list,
        }
      })
  }, [realByL3, planByL3])

  // ─── Seção Não-DRE ───────────────────────────────────────────────────────────

  const nonDreData = useMemo(() =>
    NON_DRE_ROWS.map(row => {
      const sign     = row.tipo === 'Receita' ? 1 : -1
      const realSgn  = realByL3.get(row.fullName) ?? 0
      const plan     = planByL3.get(row.fullName) ?? { planSigned: 0, planAbs: 0 }
      const hasMeta  = planByL3.has(row.fullName)
      const planAbs  = plan.planAbs
      const realAbs  = Math.abs(realSgn)
      return {
        ...row,
        planSigned: plan.planSigned,
        realSigned: realSgn,
        planAbs,
        realAbs,
        hasMeta,
        pctExec: planAbs > 0 ? realAbs / planAbs : (hasMeta ? 0 : null),
      }
    }),
  [realByL3, planByL3])

  // ─── Seção KPI ───────────────────────────────────────────────────────────────

  const kpiData = useMemo(() =>
    KPI_ROWS.map(row => {
      const plan    = planByL3.get(row.fullName) ?? { planSigned: 0, planAbs: 0 }
      const hasMeta = planByL3.has(row.fullName)
      return { ...row, plan, hasMeta }
    }),
  [planByL3])

  // ─── Resumo KPIs (cards) ─────────────────────────────────────────────────────

  const groupSum = (key: 'planSigned' | 'realSigned', maxPfx: number) =>
    hier.filter(h => numPrefix(h.l1) <= maxPfx).reduce((s, h) => s + h[key], 0)

  const summary = useMemo(() => {
    let ok = 0, atencao = 0, estouradas = 0, semMeta = 0
    for (const h of hier) {
      const rec = isReceita(h.l1)
      for (const l2 of h.children) {
        for (const l3 of l2.children) {
          if (!l3.hasMeta)              { semMeta++;    continue }
          if (l3.pctExec === null)       continue
          if (rec) {
            if (l3.pctExec >= 1)         ok++
            else if (l3.pctExec >= 0.75) atencao++
            else                         estouradas++
          } else {
            if (l3.pctExec >= 1)         estouradas++
            else if (l3.pctExec >= 0.75) atencao++
            else                         ok++
          }
        }
      }
    }
    return { cadastradas: metasNoPeriodo.length, ok, atencao, estouradas, semMeta }
  }, [hier, metasNoPeriodo])

  // ─── Linhas da tabela DRE ────────────────────────────────────────────────────

  const tableRows = useMemo(() => {
    const fatLiqPlan    = groupSum('planSigned', 2.99)
    const fatLiqReal    = groupSum('realSigned', 2.99)
    const lucroBrutoPlan = groupSum('planSigned', 3.99)
    const lucroBrutoReal = groupSum('realSigned', 3.99)
    const ebitdaPlan    = groupSum('planSigned', 4.99)
    const ebitdaReal    = groupSum('realSigned', 4.99)
    const resLiqPlan    = groupSum('planSigned', 99)
    const resLiqReal    = groupSum('realSigned', 99)

    const passesFilter = (pctExec: number | null, hasMeta: boolean, rec: boolean) => {
      if (cardFilter === 'all')         return true
      if (cardFilter === 'sem_meta')    return !hasMeta
      if (!hasMeta || pctExec === null) return false
      if (rec) {
        if (cardFilter === 'ok')        return pctExec >= 1
        if (cardFilter === 'atencao')   return pctExec >= 0.75 && pctExec < 1
        if (cardFilter === 'estourado') return pctExec < 0.75
        return false
      }
      if (cardFilter === 'ok')          return pctExec < 0.75
      if (cardFilter === 'atencao')     return pctExec >= 0.75 && pctExec < 1
      return pctExec >= 1
    }

    const rows: MetaRow[] = []
    for (let i = 0; i < hier.length; i++) {
      const { l1, planSigned, realSigned, children: l2s } = hier[i]
      const prefix = numPrefix(l1)
      const l1HasMatch = cardFilter === 'all' || l2s.some(l2 => l2.children.some(l3 => passesFilter(l3.pctExec, l3.hasMeta, isReceita(l1))))
      if (!l1HasMatch) {
        const nextPfx = i + 1 < hier.length ? numPrefix(hier[i + 1].l1) : Infinity
        if (prefix <= 2 && nextPfx > 2) rows.push({ id: '__fatLiq__', kind: 'subtotal', label: '(=) Faturamento Líquido', planSigned: groupSum('planSigned', 2.99), realSigned: groupSum('realSigned', 2.99) })
        if (prefix <= 3 && nextPfx > 3) rows.push({ id: '__lucroBruto__', kind: 'subtotal', label: '(=) Lucro Bruto', planSigned: groupSum('planSigned', 3.99), realSigned: groupSum('realSigned', 3.99) })
        if (prefix <= 4 && nextPfx > 4) rows.push({ id: '__ebitda__', kind: 'ebitda', label: '(=) EBITDA', planSigned: groupSum('planSigned', 4.99), realSigned: groupSum('realSigned', 4.99) })
        if (prefix <= 5 && nextPfx > 5) rows.push({ id: '__ebit__', kind: 'subtotal', label: '(=) Lucro Operacional (EBIT)', planSigned: groupSum('planSigned', 5.99), realSigned: groupSum('realSigned', 5.99) })
        if (i === hier.length - 1) rows.push({ id: '__resLiq__', kind: 'resultado', label: '(=) Lucro Líquido', planSigned: resLiqPlan, realSigned: resLiqReal })
        continue
      }
      const l1PlanAbs = l2s.reduce((s, l2) => s + l2.children.reduce((ss, l3) => ss + (l3.planAbs ?? 0), 0), 0)
      const l1RealAbs = l2s.reduce((s, l2) => s + l2.children.reduce((ss, l3) => ss + (l3.realAbs ?? 0), 0), 0)
      rows.push({ id: `l1::${l1}`, kind: 'l1', label: l1, l1Key: l1, planSigned, realSigned, planAbs: l1PlanAbs, realAbs: l1RealAbs, pctExec: l1PlanAbs > 0 ? l1RealAbs / l1PlanAbs : 0, tipoLancamento: isReceita(l1) ? 'Receita' : 'Despesa' })
      if (exp1.has(l1)) {
        for (const { l2, l2Key, planSigned: p2, realSigned: r2, planAbs: l2PlanAbs, realAbs: l2RealAbs, children: l3s } of l2s) {
          if (cardFilter !== 'all' && !l3s.some(l3 => passesFilter(l3.pctExec, l3.hasMeta, isReceita(l1)))) continue
          rows.push({ id: `l2::${l2Key}`, kind: 'l2', label: l2, l1Key: l1, l2Key, planSigned: p2, realSigned: r2, planAbs: l2PlanAbs, realAbs: l2RealAbs, pctExec: l2PlanAbs > 0 ? l2RealAbs / l2PlanAbs : null, tipoLancamento: isReceita(l1) ? 'Receita' : 'Despesa' })
          if (exp2.has(l2Key)) {
            for (const { l3, planSigned: p3, realSigned: r3, planAbs, realAbs, pctExec, hasMeta } of l3s) {
              if (!passesFilter(pctExec, hasMeta, isReceita(l1))) continue
              rows.push({ id: `l3::${l1}::${l2Key}::${l3}`, kind: 'l3', label: l3, l1Key: l1, l2Key, planSigned: p3, realSigned: r3, planAbs, realAbs, pctExec, hasMeta, tipoLancamento: isReceita(l1) ? 'Receita' : 'Despesa' })
            }
          }
        }
      }
      const nextPfx = i + 1 < hier.length ? numPrefix(hier[i + 1].l1) : Infinity
      if (prefix <= 2 && nextPfx > 2) rows.push({ id: '__fatLiq__', kind: 'subtotal', label: '(=) Faturamento Líquido', planSigned: fatLiqPlan, realSigned: fatLiqReal })
      if (prefix <= 3 && nextPfx > 3) rows.push({ id: '__lucroBruto__', kind: 'subtotal', label: '(=) Lucro Bruto', planSigned: lucroBrutoPlan, realSigned: lucroBrutoReal })
      if (prefix <= 4 && nextPfx > 4) rows.push({ id: '__ebitda__', kind: 'ebitda', label: '(=) EBITDA', planSigned: ebitdaPlan, realSigned: ebitdaReal })
      if (prefix <= 5 && nextPfx > 5) rows.push({ id: '__ebit__', kind: 'subtotal', label: '(=) Lucro Operacional (EBIT)', planSigned: groupSum('planSigned', 5.99), realSigned: groupSum('realSigned', 5.99) })
      if (i === hier.length - 1) rows.push({ id: '__resLiq__', kind: 'resultado', label: '(=) Lucro Líquido', planSigned: resLiqPlan, realSigned: resLiqReal })
    }
    return rows
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hier, exp1, exp2, cardFilter])

  // ─── Render helpers ──────────────────────────────────────────────────────────

  const TABLE_COLS = [
    { label: 'Orçado R$',    key: 'orcado' },
    { label: '% Fat.',       key: 'pct_orcado' },
    { label: 'Realizado R$', key: 'realizado' },
    { label: '% Fat.',       key: 'pct_real' },
    { label: 'Δ R$',         key: 'delta' },
    { label: '% Exec',       key: 'exec' },
    { label: 'Status',       key: 'status' },
  ]

  const renderTableHeader = () => (
    <tr style={{ background: 'var(--surf2)', borderBottom: '2px solid var(--line2)' }}>
      <th style={{ position: 'sticky', left: 0, zIndex: 3, background: 'var(--surf2)', padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--ink3)', minWidth: 280, borderRight: '2px solid var(--line)' }}>Descrição</th>
      {TABLE_COLS.map(col => (
        <th key={col.key} style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--ink3)', borderLeft: '1px solid var(--line)' }}>{col.label}</th>
      ))}
    </tr>
  )

  const renderMetaRow = (row: MetaRow) => {
    const s = ROW_STYLE[row.kind]
    const isL3 = row.kind === 'l3'
    const canToggle = row.kind === 'l1' || row.kind === 'l2'
    const isExpanded = row.kind === 'l1' ? exp1.has(row.l1Key!) : row.kind === 'l2' ? exp2.has(row.l2Key!) : false
    const arrow = canToggle ? (isExpanded ? '▾ ' : '▸ ') : ''
    const delta = (row.realSigned ?? 0) - (row.planSigned ?? 0)
    const showExec = row.pctExec !== undefined && row.pctExec !== null

    return (
      <tr key={row.id} style={{ background: s.bg, borderBottom: '1px solid var(--line)', borderTop: (row.kind !== 'l1' && row.kind !== 'l2' && row.kind !== 'l3') ? '2px solid var(--line2)' : undefined }}>
        <td onClick={() => { if (row.kind === 'l1') toggleL1(row.l1Key!); if (row.kind === 'l2') toggleL2(row.l2Key!); }} style={{ position: 'sticky', left: 0, zIndex: 2, background: s.bg, color: s.fg, fontWeight: s.fw, fontSize: s.fs, padding: `${s.py}px 16px ${s.py}px ${INDENT[row.kind]}px`, cursor: canToggle ? 'pointer' : 'default', userSelect: 'none', borderRight: '2px solid var(--line)' }}>{arrow}{row.label}</td>
        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: s.fs, fontWeight: s.fw, color: row.planSigned >= 0 ? 'var(--green)' : 'var(--red)', borderLeft: '1px solid var(--line)' }}>{row.planSigned ? fR(row.planSigned) : <span style={{ color: 'var(--ink3)' }}>—</span>}</td>
        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 10, color: 'var(--ink3)' }}>{faturamento > 0 && row.planSigned ? fPctOfFat(row.planSigned, faturamento) : '—'}</td>
        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: s.fs, fontWeight: s.fw, color: row.realSigned >= 0 ? 'var(--green)' : 'var(--red)', borderLeft: '1px solid var(--line)' }}>{row.realSigned ? fR(row.realSigned) : <span style={{ color: 'var(--ink3)' }}>—</span>}</td>
        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 10, color: 'var(--ink3)' }}>{faturamento > 0 && row.realSigned ? fPctOfFat(row.realSigned, faturamento) : '—'}</td>
        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: s.fs, fontWeight: isL3 ? 400 : s.fw, borderLeft: '1px solid var(--line)', whiteSpace: 'nowrap', color: delta >= 0 ? 'var(--green)' : 'var(--red)' }}>
          {(row.planSigned || row.realSigned) ? (delta >= 0 ? '+' : '') + fR(delta) : <span style={{ color: 'var(--ink3)' }}>—</span>}
        </td>
        <td style={{ padding: '8px 12px', textAlign: 'right', borderLeft: '1px solid var(--line)' }}>
          {showExec ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
              <div style={{ width: 60, height: 5, background: 'var(--surf3)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(row.pctExec!, 1) * 100}%`, height: '100%', background: row.tipoLancamento === 'Receita'
                    ? (row.pctExec! >= 1 ? 'var(--green)' : row.pctExec! >= 0.75 ? 'var(--amber-m)' : 'var(--red)')
                    : (row.pctExec! >= 1 ? 'var(--red)'   : row.pctExec! >= 0.75 ? 'var(--amber-m)' : 'var(--green)') }} />
              </div>
              <span style={{ fontSize: 10, fontWeight: 600 }}>{fPct(row.pctExec!)}</span>
            </div>
          ) : isL3 ? <span style={{ fontSize: 10, color: 'var(--ink3)' }}>—</span> : '—'}
        </td>
        <td style={{ padding: '8px 12px', textAlign: 'center', borderLeft: '1px solid var(--line)' }}>
          {isL3 && (showExec ? <StatusBadge ratio={row.pctExec!} tipoLancamento={row.tipoLancamento} /> : row.hasMeta === false ? <SemMetaBadge /> : null)}
        </td>
      </tr>
    )
  }

  // ─── Render Sections ─────────────────────────────────────────────────────────

  const renderDashboard = () => (
    <>
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12 }}>
        {[
          { id: 'all' as const,      label: 'Metas cadastradas', value: summary.cadastradas, color: 'var(--blue)' },
          { id: 'ok' as const,       label: 'Dentro da meta',    value: summary.ok,          color: 'var(--green)' },
          { id: 'atencao' as const,  label: 'Em atenção',        value: summary.atencao,     color: 'var(--amber)' },
          { id: 'estourado' as const, label: 'Críticas', value: summary.estouradas, color: 'var(--red)', tooltip: 'Despesas: acima do orçamento  •  Receitas: abaixo de 75% da meta' },
          { id: 'sem_meta' as const, label: 'Sem meta',          value: summary.semMeta,     color: 'var(--ink3)' },
        ].map(card => {
          const active = cardFilter === card.id
          return (
            <div key={card.id} onClick={() => toggleCard(card.id)} title={'tooltip' in card ? card.tooltip : undefined} style={{ background: 'var(--surface)', border: active ? `2px solid ${card.color}` : '1px solid var(--line)', borderRadius: 10, padding: active ? '15px 19px' : '16px 20px', cursor: 'pointer', boxShadow: active ? `0 0 0 3px ${card.color}22` : 'none' }}>
              <div style={{ fontSize: 11, color: active ? card.color : 'var(--ink3)', marginBottom: 6, fontWeight: active ? 600 : 400 }}>{card.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: card.color }}>{card.value}</div>
            </div>
          )
        })}
      </div>

      {/* Tabela DRE */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: 820, width: '100%' }}>
            <thead>{renderTableHeader()}</thead>
            <tbody>{tableRows.map(row => renderMetaRow(row))}</tbody>
          </table>
        </div>
      </div>

      {/* Seção Não-DRE */}
      {(nonDreData.some(r => r.hasMeta || r.realSigned !== 0)) && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', background: 'var(--surf2)', borderBottom: '1px solid var(--line2)', fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>
            📋 Movimentos Não-DRE (Caixa / Balanço)
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: 820, width: '100%' }}>
              <thead>{renderTableHeader()}</thead>
              <tbody>
                {nonDreData
                  .filter(r => cardFilter === 'all' || r.hasMeta || r.realSigned !== 0)
                  .map(row => {
                    const delta = row.realSigned - row.planSigned
                    const showExec = row.pctExec !== null
                    return (
                      <tr key={row.fullName} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ position: 'sticky', left: 0, zIndex: 2, background: 'var(--surface)', color: 'var(--ink)', fontSize: 11, padding: '8px 16px 8px 28px', borderRight: '2px solid var(--line)' }}>{row.fullName}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: row.planSigned >= 0 ? 'var(--green)' : 'var(--red)', borderLeft: '1px solid var(--line)' }}>{row.planSigned ? fR(row.planSigned) : <span style={{ color: 'var(--ink3)' }}>—</span>}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 10, color: 'var(--ink3)' }}>—</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: row.realSigned >= 0 ? 'var(--green)' : 'var(--red)', borderLeft: '1px solid var(--line)' }}>{row.realSigned ? fR(row.realSigned) : <span style={{ color: 'var(--ink3)' }}>—</span>}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 10, color: 'var(--ink3)' }}>—</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, borderLeft: '1px solid var(--line)', color: delta >= 0 ? 'var(--green)' : 'var(--red)', whiteSpace: 'nowrap' }}>{(row.planSigned || row.realSigned) ? (delta >= 0 ? '+' : '') + fR(delta) : '—'}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', borderLeft: '1px solid var(--line)' }}>
                          {showExec ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                              <div style={{ width: 60, height: 5, background: 'var(--surf3)', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ width: `${Math.min(row.pctExec!, 1) * 100}%`, height: '100%', background: row.tipo === 'Receita'
                                    ? (row.pctExec! >= 1 ? 'var(--green)' : row.pctExec! >= 0.75 ? 'var(--amber-m)' : 'var(--red)')
                                    : (row.pctExec! >= 1 ? 'var(--red)'   : row.pctExec! >= 0.75 ? 'var(--amber-m)' : 'var(--green)') }} />
                              </div>
                              <span style={{ fontSize: 10, fontWeight: 600 }}>{fPct(row.pctExec!)}</span>
                            </div>
                          ) : '—'}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', borderLeft: '1px solid var(--line)' }}>
                          {showExec ? <StatusBadge ratio={row.pctExec!} tipoLancamento={row.tipo} /> : <SemMetaBadge />}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Seção KPI */}
      {kpiData.some(r => r.hasMeta) && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', background: 'var(--surf2)', borderBottom: '1px solid var(--line2)', fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>
            📊 KPIs & Indicadores (metas cadastradas)
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: 820, width: '100%' }}>
              <thead>
                <tr style={{ background: 'var(--surf2)', borderBottom: '2px solid var(--line2)' }}>
                  <th style={{ position: 'sticky', left: 0, zIndex: 3, background: 'var(--surf2)', padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--ink3)', minWidth: 280, borderRight: '2px solid var(--line)' }}>KPI</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--ink3)', borderLeft: '1px solid var(--line)' }}>Meta Orçada</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--ink3)', borderLeft: '1px solid var(--line)' }}>Observação</th>
                </tr>
              </thead>
              <tbody>
                {kpiData.filter(r => r.hasMeta).map(row => (
                  <tr key={row.fullName} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ position: 'sticky', left: 0, zIndex: 2, background: 'var(--surface)', color: 'var(--ink)', fontSize: 11, padding: '8px 16px 8px 28px', borderRight: '2px solid var(--line)' }}>{row.fullName}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--blue)', borderLeft: '1px solid var(--line)' }}>
                      {row.plan.planAbs.toFixed(2).replace('.', ',')}{row.fullName.startsWith('%') ? '%' : row.fullName.startsWith('$') ? ' R$' : ''}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 10, color: 'var(--ink3)', borderLeft: '1px solid var(--line)' }}>Computado automaticamente</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )

  const renderManage = () => {
    const tipoValor = editing?.tipo_valor || 'reais'

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Formulário */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{editing?.id ? 'Editar Meta' : 'Nova Meta'}</h3>
          <form onSubmit={saveMeta} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>

            {/* Mês */}
            <div>
              <label style={labelStyle}>Mês de Referência</label>
              <input type="month" value={editing?.mes_referencia || ''} onChange={e => setEditing({ ...editing, mes_referencia: e.target.value })} style={inputStyle} required />
            </div>

            {/* Categoria (select agrupado) */}
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>Categoria</label>
              <select
                value={editing?.categoria || ''}
                onChange={e => {
                  const val = e.target.value
                  const leaf = ALL_CATEGORY_LEAVES.find(l => l.fullName === val)
                  if (!leaf) return
                  const { l1, l2 } = parseCatHier(leaf.fullName)
                  setEditing({
                    ...editing,
                    categoria: leaf.fullName,
                    categoria_nivel_3: leaf.fullName,
                    categoria_nivel_1: l1,
                    categoria_nivel_2: l2,
                    tipo_lancamento: leaf.tipo,
                  })
                }}
                style={{ ...inputStyle, cursor: 'pointer' }}
                required
              >
                <option value="">Selecione uma categoria...</option>
                {FORM_GROUPS.map(group => (
                  <optgroup key={group.label} label={group.label}>
                    {group.leaves.map(leaf => (
                      <option key={leaf.fullName} value={leaf.fullName}>{leaf.fullName}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Tipo Lançamento (auto-preenchido, mas editável) */}
            <div>
              <label style={labelStyle}>Tipo Lançamento</label>
              <select value={editing?.tipo_lancamento || 'Despesa'} onChange={e => setEditing({ ...editing, tipo_lancamento: e.target.value as any })} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="Receita">Receita</option>
                <option value="Despesa">Despesa</option>
              </select>
            </div>

            {/* Tipo do Valor (R$ ou %) */}
            <div>
              <label style={labelStyle}>Tipo de Meta</label>
              <div style={{ display: 'flex', gap: 0, borderRadius: 6, border: '1px solid var(--line2)', overflow: 'hidden' }}>
                {(['reais', 'percentual'] as const).map(tv => (
                  <button
                    key={tv}
                    type="button"
                    onClick={() => setEditing({ ...editing, tipo_valor: tv })}
                    style={{ flex: 1, padding: '8px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: tipoValor === tv ? 'var(--brand)' : 'var(--surf2)', color: tipoValor === tv ? '#fff' : 'var(--ink2)', transition: 'all 0.15s' }}
                  >
                    {tv === 'reais' ? 'R$ Valor' : '% Percentual'}
                  </button>
                ))}
              </div>
            </div>

            {/* Valor Planejado */}
            <div>
              <label style={labelStyle}>{tipoValor === 'percentual' ? 'Meta (%)' : 'Valor Planejado (R$)'}</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--ink3)', fontWeight: 600 }}>
                  {tipoValor === 'percentual' ? '%' : 'R$'}
                </span>
                <input
                  type="number"
                  step={tipoValor === 'percentual' ? '0.1' : '0.01'}
                  min="0"
                  value={editing?.valor_planejado || ''}
                  onChange={e => setEditing({ ...editing, valor_planejado: Number(e.target.value) })}
                  placeholder={tipoValor === 'percentual' ? '0,0' : '0,00'}
                  style={{ ...inputStyle, paddingLeft: 28 }}
                  required
                />
              </div>
              {tipoValor === 'percentual' && (
                <p style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 4 }}>Informe o valor percentual (ex: 15 para 15%)</p>
              )}
            </div>

            {/* Observação */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Observação (opcional)</label>
              <input type="text" value={editing?.observacao || ''} onChange={e => setEditing({ ...editing, observacao: e.target.value })} placeholder="Ex: referência ao budget aprovado em..." style={inputStyle} />
            </div>

            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="submit" disabled={saving} style={{ background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 20px', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Salvando...' : 'Salvar Meta'}
              </button>
              <button type="button" onClick={() => setEditing(null)} style={{ background: 'var(--surf2)', color: 'var(--ink2)', border: '1px solid var(--line2)', borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Cancelar
              </button>
              {!editing?.id && (
                <button type="button" onClick={() => setEditing({ mes_referencia: editing?.mes_referencia || '' })} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--ink3)', fontSize: 11, cursor: 'pointer' }}>
                  Limpar formulário
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Lista de metas cadastradas */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
          {/* Header — título + busca + botões */}
          <div style={{ padding: '12px 16px', background: 'var(--surf2)', borderBottom: '1px solid var(--line2)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Metas cadastradas ({metasFiltradas.length}{debSearch && metasFiltradas.length !== metas.length ? ` de ${metas.length}` : ''})</span>
            <input
              type="text"
              value={searchManage}
              onChange={e => setSearchManage(e.target.value)}
              placeholder="Buscar por mês, categoria, tipo, valor, observação..."
              style={{ flex: 1, minWidth: 200, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line2)', fontSize: 11, background: 'var(--surface)' }}
            />
            <button onClick={() => setShowImport(true)} style={{ background: 'var(--surf2)', color: 'var(--ink2)', border: '1px solid var(--line2)', borderRadius: 6, padding: '5px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              ↑ Importar
            </button>
            <button onClick={() => setEditing({ mes_referencia: fromMonth, tipo_valor: 'reais' })} style={{ background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              + Nova Meta
            </button>
          </div>

          {/* Barra de ações em massa — só aparece quando há seleção */}
          {selectedIds.size > 0 && (
            <div style={{ padding: '10px 16px', background: 'var(--brand-l, #fff4e6)', borderBottom: '1px solid var(--line2)', display: 'flex', alignItems: 'center', gap: 12, fontSize: 11 }}>
              <strong>{selectedIds.size} meta(s) selecionada(s)</strong>
              <button onClick={() => setShowBulk(true)} style={{ background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                ✎ Editar em massa
              </button>
              <button onClick={excluirSelecionadas} style={{ background: 'var(--surface)', color: 'var(--red)', border: '1px solid var(--red)', borderRadius: 4, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                ✕ Excluir selecionadas
              </button>
              <button onClick={() => setSelectedIds(new Set())} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--ink3)', cursor: 'pointer', fontSize: 11 }}>
                Limpar seleção
              </button>
            </div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: 'var(--surf2)', borderBottom: '1px solid var(--line2)' }}>
                <th style={{ padding: '10px 8px 10px 16px', width: 32 }}>
                  <input
                    type="checkbox"
                    checked={metasFiltradas.length > 0 && metasFiltradas.every(m => selectedIds.has(m.id))}
                    onChange={e => {
                      if (e.target.checked) setSelectedIds(new Set(metasFiltradas.map(m => m.id)))
                      else setSelectedIds(new Set())
                    }}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--ink3)' }}>Mês</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--ink3)' }}>Tipo</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--ink3)' }}>Categoria</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--ink3)' }}>Valor</th>
                <th style={{ padding: '10px 16px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--ink3)' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {metas.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--ink3)' }}>Nenhuma meta cadastrada. Use o formulário acima para adicionar.</td></tr>
              )}
              {metas.length > 0 && metasFiltradas.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: 'var(--ink3)' }}>Nenhuma meta corresponde à busca &quot;{debSearch}&quot;.</td></tr>
              )}
              {metasFiltradas.map(m => {
                const checked = selectedIds.has(m.id)
                return (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--line)', background: checked ? 'var(--brand-l, #fff4e6)' : undefined }} className="hover:bg-[var(--surf2)]">
                    <td style={{ padding: '9px 8px 9px 16px' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setSelectedIds(prev => {
                          const n = new Set(prev)
                          n.has(m.id) ? n.delete(m.id) : n.add(m.id)
                          return n
                        })}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td style={{ padding: '9px 16px', color: 'var(--ink2)' }}>{m.mes_referencia}</td>
                    <td style={{ padding: '9px 16px' }}><span style={{ color: m.tipo_lancamento === 'Receita' ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{m.tipo_lancamento}</span></td>
                    <td style={{ padding: '9px 16px', color: 'var(--ink)', maxWidth: 340 }}>{m.categoria}</td>
                    <td style={{ padding: '9px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--ink)' }}>{fR(m.valor_planejado)}</td>
                    <td style={{ padding: '9px 16px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                        <button onClick={() => { setEditing({ ...m, tipo_valor: m.observacao?.includes('tipo_valor:percentual') ? 'percentual' : 'reais' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} style={{ background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Editar</button>
                        <button onClick={() => deleteMeta(m.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Excluir</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{view === 'dash' ? 'Metas vs Realizado' : 'Gerenciador de Metas'}</h2>
          <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 3 }}>
            {view === 'dash'
              ? `Faturamento do período: ${fR(faturamento)} · ${DRE_LEAVES.length} categorias DRE · ${NON_DRE_ROWS.length} linhas não-DRE · ${KPI_ROWS.length} KPIs`
              : 'Adicione ou edite metas — a categoria é selecionada da lista completa do plano de contas'}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => { setView(view === 'dash' ? 'manage' : 'dash'); if (view === 'manage') setEditing(null); }}
            style={{ background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 6, padding: '6px 14px', fontSize: 11, fontWeight: 600, color: 'var(--ink2)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {view === 'dash' ? '⚙ Gerenciar Metas' : '📊 Voltar ao Dashboard'}
          </button>
        )}
      </div>
      {isLoading && metas.length === 0
        ? <div style={{ color: 'var(--ink3)', fontSize: 12, padding: '32px 0', textAlign: 'center' }}>Carregando metas...</div>
        : (view === 'manage' && isAdmin ? renderManage() : renderDashboard())}

      {/* ── Modais ──────────────────────────────────────────────────────── */}
      {showReplicateFor && (
        <MetaReplicateModal
          baseMeta={showReplicateFor}
          metasExistentes={metas}
          onClose={() => setShowReplicateFor(null)}
          onReplicate={async (meses, sobrescrever) => {
            await replicarMeta(showReplicateFor, meses, sobrescrever)
          }}
        />
      )}

      {showBulk && selectedIds.size > 0 && (
        <MetaBulkEditModal
          selecionadas={metas.filter(m => selectedIds.has(m.id))}
          onClose={() => setShowBulk(false)}
          onApply={aplicarBulkEdit}
        />
      )}

      {showImport && (
        <MetaImportModal
          categoryLeaves={ALL_CATEGORY_LEAVES.map(l => ({ fullName: l.fullName, tipo: l.tipo }))}
          onClose={() => setShowImport(false)}
          onImport={importarMetas}
        />
      )}
    </div>
  )
}

// ─── Estilos reutilizáveis ────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--ink3)', marginBottom: 4, fontWeight: 500,
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 6,
  border: '1px solid var(--line2)', fontSize: 12, background: 'var(--surface)', color: 'var(--ink)',
}
