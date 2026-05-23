'use client'

/**
 * Modal que aparece DEPOIS de salvar uma meta, perguntando se quer replicar
 * a mesma meta para outros meses (próximos meses do ano corrente + próximo ano).
 */
import { useState, useMemo } from 'react'
import type { Meta } from '@/lib/types'
import { fR } from '@/lib/utils'

interface Props {
  baseMeta: Meta                   // meta recém-salva — fonte do valor/categoria/etc
  metasExistentes: Meta[]          // todas as metas atuais (para detectar duplicatas)
  onClose:    () => void
  onReplicate: (mesesAlvo: string[], sobrescrever: boolean) => Promise<void>
}

export function MetaReplicateModal({ baseMeta, metasExistentes, onClose, onReplicate }: Props) {
  // Gera os 24 meses a partir do mês base (exclusive) — não inclui o próprio
  const candidatos = useMemo(() => {
    const list: string[] = []
    const [yStr, mStr] = baseMeta.mes_referencia.split('-')
    let y = Number(yStr)
    let m = Number(mStr)
    for (let i = 0; i < 24; i++) {
      m++
      if (m > 12) { m = 1; y++ }
      list.push(`${y}-${String(m).padStart(2, '0')}`)
    }
    return list
  }, [baseMeta.mes_referencia])

  // Set de meses que JÁ TÊM meta para a mesma categoria
  const jaExistemPorCat = useMemo(() => {
    const set = new Set<string>()
    for (const m of metasExistentes) {
      if (m.categoria === baseMeta.categoria && m.tipo_lancamento === baseMeta.tipo_lancamento) {
        set.add(m.mes_referencia)
      }
    }
    return set
  }, [metasExistentes, baseMeta.categoria, baseMeta.tipo_lancamento])

  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [sobrescrever, setSobrescrever] = useState(false)
  const [salvando, setSalvando]         = useState(false)

  const toggleMes = (mes: string) =>
    setSelecionados(prev => {
      const n = new Set(prev)
      n.has(mes) ? n.delete(mes) : n.add(mes)
      return n
    })

  const selecionarRestoDoAno = () => {
    const ano = baseMeta.mes_referencia.split('-')[0]
    const novos = new Set(selecionados)
    for (const mes of candidatos) {
      if (mes.startsWith(ano)) novos.add(mes)
    }
    setSelecionados(novos)
  }

  const selecionarProximos12 = () => {
    const novos = new Set(selecionados)
    candidatos.slice(0, 12).forEach(m => novos.add(m))
    setSelecionados(novos)
  }

  const limparTudo = () => setSelecionados(new Set())

  const replicar = async () => {
    if (selecionados.size === 0) return
    setSalvando(true)
    try {
      // Se NÃO sobrescrever, remover meses que já têm meta
      const alvos = sobrescrever
        ? Array.from(selecionados)
        : Array.from(selecionados).filter(m => !jaExistemPorCat.has(m))
      await onReplicate(alvos, sobrescrever)
      onClose()
    } finally {
      setSalvando(false)
    }
  }

  // Para exibição: agrupar candidatos por ano
  const porAno = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const m of candidatos) {
      const y = m.slice(0, 4)
      if (!map.has(y)) map.set(y, [])
      map.get(y)!.push(m)
    }
    return Array.from(map.entries())
  }, [candidatos])

  const mesLabel = (ym: string) => {
    const [, m] = ym.split('-')
    const meses = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
    return meses[Number(m)]
  }

  const aplicaveis = sobrescrever
    ? selecionados.size
    : Array.from(selecionados).filter(m => !jaExistemPorCat.has(m)).length

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={{ padding: 20, borderBottom: '1px solid var(--line)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Replicar para outros meses?</h3>
          <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4, margin: 0 }}>
            Meta salva: <strong>{baseMeta.categoria}</strong> ·{' '}
            <span style={{ color: baseMeta.tipo_lancamento === 'Receita' ? 'var(--green)' : 'var(--red)' }}>
              {baseMeta.tipo_lancamento}
            </span>{' '}
            · {fR(baseMeta.valor_planejado)}
          </p>
        </div>

        <div style={{ padding: 20, maxHeight: 420, overflow: 'auto' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <button onClick={selecionarProximos12} style={btnLink}>Próximos 12 meses</button>
            <button onClick={selecionarRestoDoAno} style={btnLink}>Resto do ano</button>
            <button onClick={limparTudo} style={btnLink}>Limpar</button>
          </div>

          {porAno.map(([ano, meses]) => (
            <div key={ano} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink3)', marginBottom: 6 }}>{ano}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
                {meses.map(mes => {
                  const jaTem = jaExistemPorCat.has(mes)
                  const checked = selecionados.has(mes)
                  return (
                    <label
                      key={mes}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '6px 8px', borderRadius: 4,
                        background: checked ? 'var(--brand-l, #ffeaea)' : 'var(--surf2)',
                        border: '1px solid ' + (checked ? 'var(--brand)' : 'var(--line)'),
                        cursor: 'pointer',
                        fontSize: 11,
                        opacity: jaTem && !sobrescrever ? 0.55 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMes(mes)}
                        style={{ cursor: 'pointer' }}
                      />
                      <span style={{ fontWeight: 600 }}>{mesLabel(mes)}</span>
                      {jaTem && (
                        <span title="Já existe meta para essa categoria neste mês"
                          style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--amber)' }}>
                          já tem
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            </div>
          ))}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 12, color: 'var(--ink2)' }}>
            <input type="checkbox" checked={sobrescrever} onChange={e => setSobrescrever(e.target.checked)} />
            Sobrescrever metas existentes (caso contrário, meses com "já tem" são pulados)
          </label>
        </div>

        <div style={{ padding: 16, borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
          <span style={{ marginRight: 'auto', fontSize: 11, color: 'var(--ink3)' }}>
            {selecionados.size === 0 ? 'Selecione meses' :
              `${aplicaveis} meta(s) serão ${sobrescrever ? 'atualizadas/criadas' : 'criadas'}`}
          </span>
          <button onClick={onClose} style={btnSecondary} disabled={salvando}>Agora não</button>
          <button onClick={replicar} style={btnPrimary} disabled={salvando || aplicaveis === 0}>
            {salvando ? 'Replicando…' : `Replicar ${aplicaveis > 0 ? `(${aplicaveis})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Estilos compartilhados ───────────────────────────────────────────────────

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
  width: 'min(560px, 92vw)',
  maxHeight: '90vh',
  overflow: 'hidden',
  display: 'flex', flexDirection: 'column',
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
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

const btnLink: React.CSSProperties = {
  background: 'none', color: 'var(--brand)',
  border: '1px solid var(--brand)', borderRadius: 4,
  padding: '4px 10px', fontSize: 11, fontWeight: 600,
  cursor: 'pointer',
}
