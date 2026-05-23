'use client'

/**
 * Modal de importação XLSX/CSV de metas.
 *
 * Fluxo:
 *  1. Usuário baixa template (botão) — gera CSV de exemplo
 *  2. Preenche no Excel
 *  3. Clica "Selecionar arquivo" → preview tabular
 *  4. Valida cada linha (mes_referencia, categoria, tipo, valor)
 *  5. "Importar X registros" → POST /api/metas/bulk
 *
 * Valida no client:
 *  • mes_referencia formato YYYY-MM
 *  • categoria existe em ALL_CATEGORY_LEAVES (passado por prop)
 *  • valor_planejado > 0
 *  • tipo_lancamento = Receita|Despesa
 */
import { useState, useRef, useMemo } from 'react'
import * as XLSX from 'xlsx'
import type { Meta } from '@/lib/types'
import { parseCatHier } from '@/lib/utils'

interface CategoryLeaf {
  fullName: string
  tipo: 'Receita' | 'Despesa'
}

interface Props {
  categoryLeaves: CategoryLeaf[]   // todas as categorias válidas
  onClose:   () => void
  onImport:  (metas: Omit<Meta, 'criado_em'>[]) => Promise<void>
}

interface ParsedRow {
  index: number
  mes_referencia: string
  categoria: string
  tipo_lancamento: string
  valor_planejado: number
  observacao: string
  // validation
  valid: boolean
  errors: string[]
}

export function MetaImportModal({ categoryLeaves, onClose, onImport }: Props) {
  const [arquivo, setArquivo]   = useState<File | null>(null)
  const [rows, setRows]         = useState<ParsedRow[]>([])
  const [salvando, setSalvando] = useState(false)
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const categoriasValidas = useMemo(() => {
    const map = new Map<string, CategoryLeaf>()
    for (const c of categoryLeaves) {
      map.set(c.fullName.trim().toLowerCase(), c)
    }
    return map
  }, [categoryLeaves])

  // ── Baixar template CSV ─────────────────────────────────────────────────
  const baixarTemplate = () => {
    const linhas = [
      ['mes_referencia', 'categoria', 'tipo_lancamento', 'valor_planejado', 'observacao'],
      ['2026-01', '1.1.01 Aquisição | [Saber] BR', 'Receita', '50000', 'budget Q1'],
      ['2026-02', '1.1.01 Aquisição | [Saber] BR', 'Receita', '55000', ''],
      ['2026-01', '3.1.05 CSP - Operação [Executar]', 'Despesa', '12000', ''],
    ]
    const csv = linhas.map(l => l.map(c =>
      /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c,
    ).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'template_metas.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  // ── Parse do arquivo ────────────────────────────────────────────────────
  const onPickFile = async (file: File) => {
    setArquivo(file)
    setErroGeral(null)
    try {
      const buf = await file.arrayBuffer()
      const wb  = XLSX.read(buf, { type: 'array' })
      const ws  = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

      const parsed: ParsedRow[] = raw.map((r, i) => {
        const get = (k: string): string => {
          // procura key case-insensitive
          for (const key of Object.keys(r)) {
            if (key.trim().toLowerCase() === k.toLowerCase()) {
              return String(r[key] ?? '').trim()
            }
          }
          return ''
        }
        const mes = get('mes_referencia')
        const cat = get('categoria')
        const tip = get('tipo_lancamento')
        const valStr = get('valor_planejado').replace(',', '.').replace(/[R$\s]/gi, '')
        const obs = get('observacao')

        const errors: string[] = []
        if (!/^\d{4}-\d{2}$/.test(mes)) errors.push('mês inválido (formato YYYY-MM)')
        if (!cat) errors.push('categoria vazia')
        else if (!categoriasValidas.has(cat.toLowerCase())) errors.push(`categoria não encontrada: ${cat}`)
        if (!['Receita', 'Despesa'].includes(tip)) errors.push('tipo_lancamento deve ser Receita ou Despesa')
        const valor = Number(valStr)
        if (!Number.isFinite(valor) || valor <= 0) errors.push('valor_planejado deve ser > 0')

        return {
          index: i + 2,             // +2 porque tem header e Excel é 1-indexed
          mes_referencia:  mes,
          categoria:       cat,
          tipo_lancamento: tip,
          valor_planejado: valor,
          observacao:      obs,
          valid: errors.length === 0,
          errors,
        }
      })

      setRows(parsed)
    } catch (e) {
      setErroGeral('Falha ao ler arquivo: ' + (e instanceof Error ? e.message : String(e)))
      setRows([])
    }
  }

  // ── Importar ────────────────────────────────────────────────────────────
  const importar = async () => {
    const validas = rows.filter(r => r.valid)
    if (validas.length === 0) return
    setSalvando(true)
    try {
      const metas = validas.map<Omit<Meta, 'criado_em'>>(r => {
        const { l1, l2 } = parseCatHier(r.categoria)
        return {
          id: crypto.randomUUID(),
          tipo: 'categoria',
          categoria: r.categoria,
          categoria_nivel_1: l1,
          categoria_nivel_2: l2,
          categoria_nivel_3: r.categoria,
          centro_de_custo: '',
          mes_referencia: r.mes_referencia,
          valor_planejado: r.valor_planejado,
          tipo_lancamento: r.tipo_lancamento as 'Receita' | 'Despesa',
          observacao: r.observacao,
        }
      })
      await onImport(metas)
      onClose()
    } finally {
      setSalvando(false)
    }
  }

  const validas    = rows.filter(r => r.valid).length
  const invalidas  = rows.length - validas

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={{ padding: 20, borderBottom: '1px solid var(--line)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Importar metas (XLSX/CSV)</h3>
          <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 4, margin: 0 }}>
            Baixe o template, preencha no Excel e importe. Suporta .xlsx, .xls e .csv.
          </p>
        </div>

        <div style={{ padding: 20, overflow: 'auto', flex: 1 }}>
          {/* Step 1: Template */}
          <div style={{ marginBottom: 16 }}>
            <strong style={{ fontSize: 12 }}>1. Baixe o template (se ainda não tem)</strong>
            <div style={{ marginTop: 6 }}>
              <button onClick={baixarTemplate} style={btnSecondary}>↓ Baixar template_metas.csv</button>
              <span style={{ fontSize: 10, color: 'var(--ink3)', marginLeft: 10 }}>
                Colunas: mes_referencia (YYYY-MM) · categoria · tipo_lancamento · valor_planejado · observacao
              </span>
            </div>
          </div>

          {/* Step 2: Upload */}
          <div style={{ marginBottom: 16 }}>
            <strong style={{ fontSize: 12 }}>2. Selecione o arquivo preenchido</strong>
            <div style={{ marginTop: 6 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={e => e.target.files?.[0] && onPickFile(e.target.files[0])}
                style={{ display: 'none' }}
              />
              <button onClick={() => fileInputRef.current?.click()} style={btnSecondary}>
                {arquivo ? `📄 ${arquivo.name}` : 'Selecionar arquivo'}
              </button>
              {arquivo && (
                <button onClick={() => { setArquivo(null); setRows([]); setErroGeral(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                  style={{ ...btnSecondary, marginLeft: 6 }}>
                  ✕
                </button>
              )}
            </div>
          </div>

          {erroGeral && (
            <p style={{ fontSize: 11, color: 'var(--red)' }}>{erroGeral}</p>
          )}

          {/* Step 3: Preview */}
          {rows.length > 0 && (
            <>
              <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 11 }}>
                <span style={{ color: 'var(--green)' }}><strong>{validas}</strong> válida(s)</span>
                {invalidas > 0 && (
                  <span style={{ color: 'var(--red)' }}><strong>{invalidas}</strong> com erro</span>
                )}
              </div>

              <div style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--surf2)' }}>
                    <tr>
                      <Th>L#</Th><Th>Mês</Th><Th>Categoria</Th><Th>Tipo</Th>
                      <Th align="right">Valor</Th><Th>Observação</Th><Th>Status</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 200).map(r => (
                      <tr key={r.index} style={{ borderTop: '0.5px solid var(--line)', background: r.valid ? 'transparent' : 'var(--red-l, rgba(255,0,0,0.05))' }}>
                        <Td>{r.index}</Td>
                        <Td>{r.mes_referencia}</Td>
                        <Td style={{ maxWidth: 280, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={r.categoria}>{r.categoria}</Td>
                        <Td>{r.tipo_lancamento}</Td>
                        <Td align="right">{r.valor_planejado.toLocaleString('pt-BR')}</Td>
                        <Td style={{ maxWidth: 160, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={r.observacao}>{r.observacao || '—'}</Td>
                        <Td>
                          {r.valid
                            ? <span style={{ color: 'var(--green)' }}>OK</span>
                            : <span style={{ color: 'var(--red)' }} title={r.errors.join('; ')}>✕ erro</span>}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 200 && (
                <p style={{ fontSize: 10, color: 'var(--ink3)', marginTop: 6 }}>
                  Exibindo as primeiras 200 linhas. Outras {rows.length - 200} estão prontas para import.
                </p>
              )}

              {/* Lista detalhada dos erros */}
              {invalidas > 0 && (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ fontSize: 11, cursor: 'pointer', color: 'var(--red)' }}>
                    Ver {invalidas} erro(s) em detalhe
                  </summary>
                  <ul style={{ fontSize: 10, color: 'var(--ink2)', marginTop: 6, paddingLeft: 18 }}>
                    {rows.filter(r => !r.valid).slice(0, 50).map(r => (
                      <li key={r.index}>Linha {r.index}: {r.errors.join(' · ')}</li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>

        <div style={{ padding: 16, borderTop: '1px solid var(--line)', display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnSecondary} disabled={salvando}>Cancelar</button>
          <button onClick={importar} style={btnPrimary} disabled={salvando || validas === 0}>
            {salvando ? 'Importando…' : `Importar ${validas > 0 ? `(${validas})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      padding: '6px 8px', textAlign: align,
      fontWeight: 600, fontSize: 10,
      color: 'var(--ink3)',
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>{children}</th>
  )
}
function Td({ children, align = 'left', style, title }: {
  children: React.ReactNode
  align?: 'left' | 'right'
  style?: React.CSSProperties
  title?: string
}) {
  return (
    <td style={{ padding: '5px 8px', textAlign: align, color: 'var(--ink2)', ...style }} title={title}>
      {children}
    </td>
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
  width: 'min(900px, 96vw)',
  maxHeight: '92vh',
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
