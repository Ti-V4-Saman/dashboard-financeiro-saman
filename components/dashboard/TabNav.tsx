'use client'

type Tab = 'visao' | 'dre' | 'cc' | 'comparativo' | 'qualidade' | 'lancamentos' | 'metas'

interface TabNavProps {
  active: Tab
  onChange: (t: Tab) => void
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'visao', label: 'Visão Geral' },
  { id: 'dre', label: 'DRE' },
  { id: 'cc', label: 'Centros de Custo' },
  { id: 'comparativo', label: 'Comparativo' },
  { id: 'qualidade', label: 'Qualidade & Insights' },
  { id: 'lancamentos', label: 'Lançamentos' },
  { id: 'metas', label: 'Metas' },
]

export function TabNav({ active, onChange }: TabNavProps) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--line)',
      }}
      className="px-6 flex overflow-x-auto gap-0"
    >
      {TABS.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className="flex-shrink-0 px-4 py-[11px] text-[12px] transition-all whitespace-nowrap"
          style={{
            color: active === t.id ? 'var(--ink)' : 'var(--ink3)',
            fontWeight: active === t.id ? 600 : 400,
            background: 'none',
            border: 'none',
            borderBottom: active === t.id ? '2px solid var(--brand)' : '2px solid transparent',
            cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export type { Tab }
