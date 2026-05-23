'use client'

/**
 * Modal de edição em massa.
 *
 * Permite alterar 4 campos para várias metas selecionadas: valor_planejado,
 * tipo_lancamento, tipo_valor (R$/percentual) e mes_referencia.
 * Cada campo só é aplicado se o checkbox "alterar?" estiver marcado.
 */
import { useState } from 'react'
import type { Meta } from '@/lib/types'

interface Props {
  selecionadas: Meta[]
  onClose:  () => void
  onApply:  (updates: BulkUpdate) => Promise<void>
}

export interface BulkUpdate {
  valor_planejado?: number
  tipo_lancamento?: 'Receita' | 'Despesa'
  tipo_valor?:      'reais' | 'percentual'   // grava em `observacao`
  mes_referencia?:  string                   // YYYY-MM
}

export function MetaBulkEditModal({ selecionadas, onClose, onApply }: Props) {
  const [aplicar, setAplicar] = useState<Record<keyof BulkUpdate, boolean>>({
    valor_planejado: false,
    tipo_lancamento: false,
    tipo_valor:      false,
    mes_referencia:  false,
  })
  const [valor, setValor]   = useState<string>('')
  const [tipoL, setTipoL]   = useState<'Receita' | 'Despesa'>('Despesa')
  const [tipoV, setTipoV]   = useState<'reais' | 'percentual'>('reais')
  const [mes, setMes]       = useState<string>('')
  const [salvando, setSalvando] = useState(false)

  const aplicarMudancas = async () => {
    const updates: BulkUpdate = {}
    if (aplicar.valor_planejado) {
      const n = Number(valor)
      if (Number.isFinite(n)) updates.valor_planejado = n
    }
    if (aplicar.tipo_lancamento) updates.tipo_lancamento = tipoL
    if (aplicar.tipo_valor)      updates.tipo_valor      = tipoV
    if (aplicar.mes_referencia)  updates.mes_referencia  = mes

    if (Object.keys(updates).length === 0) {
      alert('Marque pelo menos um campo para alterar.')
      return
    }

    setSalvando(true)
    try {
      await onApply(updates)
      onClose()
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={{ padding: 20, borderBottom: '1px solid var(--line)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Editar {selecionadas.length} meta(s) em massa</h3>
          <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4, margin: 0 }}>
            Marque os campos que você quer alterar. Os outros ficam inalterados.
          </p>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Valor */}
          <CampoBulk
            label="Valor planejado"
            ativado={aplicar.valor_planejado}
            onToggle={v => setAplicar(p => ({ ...p, valor_planejado: v }))}
          >
            <input
              type="number" step="0.01" min="0"
              value={valor} onChange={e => setValor(e.target.value)}
              placeholder="0,00"
              style={inputStyle}
              disabled={!aplicar.valor_planejado}
            />
          </CampoBulk>

          {/* Tipo lançamento */}
          <CampoBulk
            label="Tipo de lançamento"
            ativado={aplicar.tipo_lancamento}
            onToggle={v => setAplicar(p => ({ ...p, tipo_lancamento: v }))}
          >
            <select
              value={tipoL}
              onChange={e => setTipoL(e.target.value as 'Receita' | 'Despesa')}
              style={inputStyle}
              disabled={!aplicar.tipo_lancamento}
            >
              <option value="Despesa">Despesa</option>
              <option value="Receita">Receita</option>
            </select>
          </CampoBulk>

          {/* Tipo do valor */}
          <CampoBulk
            label="Tipo de meta"
            ativado={aplicar.tipo_valor}
            onToggle={v => setAplicar(p => ({ ...p, tipo_valor: v }))}
          >
            <div style={{ display: 'flex', gap: 0, borderRadius: 6, border: '1px solid var(--line2)', overflow: 'hidden', opacity: aplicar.tipo_valor ? 1 : 0.5 }}>
              {(['reais', 'percentual'] as const).map(tv => (
                <button
                  key={tv}
                  type="button"
                  onClick={() => aplicar.tipo_valor && setTipoV(tv)}
                  style={{
                    flex: 1, padding: '7px', fontSize: 12, fontWeight: 600,
                    cursor: aplicar.tipo_valor ? 'pointer' : 'default',
                    border: 'none',
                    background: tipoV === tv ? 'var(--brand)' : 'var(--surf2)',
                    color: tipoV === tv ? '#fff' : 'var(--ink2)',
                  }}
                >
                  {tv === 'reais' ? 'R$ Valor' : '% Percentual'}
                </button>
              ))}
            </div>
          </CampoBulk>

          {/* Mês de referência */}
          <CampoBulk
            label="Mês de referência"
            ativado={aplicar.mes_referencia}
            onToggle={v => setAplicar(p => ({ ...p, mes_referencia: v }))}
          >
            <input
              type="month"
              value={mes} onChange={e => setMes(e.target.value)}
              style={inputStyle}
              disabled={!aplicar.mes_referencia}
            />
          </CampoBulk>

          {/* Preview */}
          <div style={{
            background: 'var(--surf2)', borderRadius: 6, padding: 10,
            fontSize: 11, color: 'var(--ink3)',
            border: '1px dashed var(--line2)',
          }}>
            <strong>{selecionadas.length} meta(s)</strong> serão atualizadas.
            {' '}
            {(Object.keys(aplicar) as (keyof BulkUpdate)[]).filter(k => aplicar[k]).length === 0
              ? 'Nenhum campo marcado ainda.'
              : `Campos: ${(Object.keys(aplicar) as (keyof BulkUpdate)[]).filter(k => aplicar[k]).map(labelCampo).join(', ')}.`}
          </div>
        </div>

        <div style={{ padding: 16, borderTop: '1px solid var(--line)', display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecondary} disabled={salvando}>Cancelar</button>
          <button onClick={aplicarMudancas} style={btnPrimary} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Aplicar a todas'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function labelCampo(k: keyof BulkUpdate): string {
  switch (k) {
    case 'valor_planejado': return 'valor'
    case 'tipo_lancamento': return 'tipo'
    case 'tipo_valor':      return 'tipo de meta'
    case 'mes_referencia':  return 'mês'
  }
}

function CampoBulk({
  label, ativado, onToggle, children,
}: {
  label: string
  ativado: boolean
  onToggle: (v: boolean) => void
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 200, fontSize: 12, color: ativado ? 'var(--ink)' : 'var(--ink3)' }}>
        <input
          type="checkbox"
          checked={ativado}
          onChange={e => onToggle(e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        Alterar {label.toLowerCase()}
      </label>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

// ── Estilos ──────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000,
}

const modalStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 12,
  width: 'min(540px, 92vw)',
  maxHeight: '90vh',
  overflow: 'hidden',
  display: 'flex', flexDirection: 'column',
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px',
  borderRadius: 6, border: '1px solid var(--line2)',
  fontSize: 12, background: 'var(--surface)', color: 'var(--ink)',
}

const btnPrimary: React.CSSProperties = {
  background: 'var(--brand)', color: '#fff',
  border: 'none', borderRadius: 6,
  padding: '7px 16px', fontSize: 12, fontWeight: 600,
  cursor: 'pointer',
}

const btnSecondary: React.CSSProperties = {
  background: 'var(--surf2)', color: 'var(--ink2)',
  border: '1px solid var(--line2)', borderRadius: 6,
  padding: '7px 14px', fontSize: 12, fontWeight: 600,
  cursor: 'pointer',
}
