'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { UserPlus, ToggleLeft, ToggleRight, Trash2, Shield, Users, UserCheck, UserX } from 'lucide-react'
import type { Usuario } from '@/app/api/usuarios/route'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function fCPF(v: string) {
  const n = v.replace(/\D/g, '').slice(0, 11)
  return n
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}

function fTel(v: string) {
  const n = v.replace(/\D/g, '').slice(0, 11)
  if (n.length <= 10)
    return n.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3')
  return n.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3')
}

const EMPTY = { nome: '', cpf: '', email: '', telefone: '' }

export function UsuariosTab() {
  const { data: usuarios, error, mutate, isLoading } = useSWR<Usuario[]>('/api/usuarios', fetcher)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const flash = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 3500)
  }

  // ── Adicionar ────────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    if (!form.email.includes('@')) return flash('err', 'Informe um e-mail válido.')
    setSaving(true)
    const res = await fetch('/api/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    if (res.ok) {
      setForm(EMPTY)
      setShowForm(false)
      mutate()
      flash('ok', 'Usuário adicionado com sucesso.')
    } else {
      const d = await res.json()
      flash('err', d.error || 'Erro ao adicionar.')
    }
  }

  // ── Toggle ativo ─────────────────────────────────────────────────────────────
  const handleToggle = async (u: Usuario) => {
    await fetch('/api/usuarios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIndex: u.rowIndex, ativo: !u.ativo }),
    })
    mutate()
  }

  // ── Remover ──────────────────────────────────────────────────────────────────
  const handleRemove = async (u: Usuario) => {
    if (!confirm(`Remover ${u.nome || u.email}? Esta ação não pode ser desfeita.`)) return
    await fetch('/api/usuarios', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIndex: u.rowIndex }),
    })
    mutate()
    flash('ok', 'Usuário removido.')
  }

  const lista = usuarios || []
  const ativos   = lista.filter(u => u.ativo).length
  const inativos = lista.filter(u => !u.ativo).length

  return (
    <div className="space-y-4">
      {/* ── Cards de resumo ──────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {[
          { icon: Users,     label: 'Total cadastrado', val: lista.length, color: 'var(--brand)' },
          { icon: UserCheck, label: 'Com acesso ativo',  val: ativos,      color: 'var(--green)' },
          { icon: UserX,     label: 'Bloqueados',        val: inativos,    color: 'var(--red)'   },
        ].map(({ icon: Icon, label, val, color }) => (
          <div
            key={label}
            style={{
              background: 'var(--surface)', border: '1px solid var(--line)',
              borderRadius: 10, padding: '14px 18px',
              display: 'flex', alignItems: 'center', gap: 12,
            }}
          >
            <div style={{ width: 36, height: 36, borderRadius: 8, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon size={18} style={{ color }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink3)', marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>{val}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Tabela ───────────────────────────────────────────────────────────── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>

        {/* Cabeçalho */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Shield size={15} style={{ color: 'var(--brand)' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Controle de Acesso</span>
          </div>
          <button
            onClick={() => { setShowForm(v => !v); setForm(EMPTY) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--brand)', color: '#fff',
              border: 'none', borderRadius: 7, padding: '7px 14px',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <UserPlus size={14} />
            {showForm ? 'Cancelar' : 'Novo usuário'}
          </button>
        </div>

        {/* Formulário de adição */}
        {showForm && (
          <div style={{ padding: '16px', borderBottom: '1px solid var(--line)', background: 'var(--surf2)', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            {[
              { key: 'nome',     label: 'Nome completo', placeholder: 'João da Silva',         width: 200 },
              { key: 'email',    label: 'E-mail *',      placeholder: 'joao@empresa.com',       width: 210 },
              { key: 'cpf',     label: 'CPF',           placeholder: '000.000.000-00',          width: 145 },
              { key: 'telefone', label: 'Telefone',      placeholder: '(11) 99999-9999',        width: 155 },
            ].map(({ key, label, placeholder, width }) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
                <input
                  value={form[key as keyof typeof form]}
                  onChange={e => {
                    let v = e.target.value
                    if (key === 'cpf') v = fCPF(v)
                    if (key === 'telefone') v = fTel(v)
                    setForm(f => ({ ...f, [key]: v }))
                  }}
                  placeholder={placeholder}
                  style={{
                    width, padding: '7px 10px', fontSize: 12,
                    border: '1px solid var(--line2)', borderRadius: 6,
                    background: 'var(--surface)', color: 'var(--ink)',
                    outline: 'none',
                  }}
                />
              </div>
            ))}
            <button
              onClick={handleAdd}
              disabled={saving}
              style={{
                background: 'var(--green)', color: '#fff',
                border: 'none', borderRadius: 7, padding: '8px 18px',
                fontSize: 12, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Salvando...' : 'Salvar acesso'}
            </button>
          </div>
        )}

        {/* Flash */}
        {msg && (
          <div style={{
            padding: '10px 16px', fontSize: 12, fontWeight: 500,
            background: msg.type === 'ok' ? '#f0fdf4' : '#fef2f2',
            color: msg.type === 'ok' ? 'var(--green)' : 'var(--red)',
            borderBottom: '1px solid var(--line)',
          }}>
            {msg.text}
          </div>
        )}

        {/* Tabela de usuários */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
            <thead>
              <tr style={{ background: 'var(--surf2)', borderBottom: '2px solid var(--line2)' }}>
                {['Nome', 'E-mail', 'CPF', 'Telefone', 'Cadastro', 'Status', 'Ações'].map((h, i) => (
                  <th
                    key={h}
                    style={{
                      padding: '10px 16px',
                      textAlign: i >= 5 ? 'center' : 'left',
                      fontSize: 11, fontWeight: 600, color: 'var(--ink3)',
                      whiteSpace: 'nowrap',
                      borderLeft: i > 0 ? '1px solid var(--line)' : undefined,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--ink3)', fontSize: 12 }}>
                    Carregando...
                  </td>
                </tr>
              )}
              {error && (
                <tr>
                  <td colSpan={7} style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--red)', fontSize: 12 }}>
                    Erro ao carregar usuários. Verifique as configurações do Service Account.
                  </td>
                </tr>
              )}
              {!isLoading && !error && lista.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--ink3)', fontSize: 12 }}>
                    Nenhum usuário cadastrado. Clique em &quot;Novo usuário&quot; para adicionar.
                  </td>
                </tr>
              )}
              {lista.map(u => (
                <tr key={u.rowIndex} style={{ background: u.ativo ? 'var(--surface)' : '#fef2f2', borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '10px 16px', color: 'var(--ink)', fontWeight: 500 }}>{u.nome || '—'}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--ink2)', borderLeft: '1px solid var(--line)' }}>{u.email}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--ink3)', borderLeft: '1px solid var(--line)', fontVariantNumeric: 'tabular-nums' }}>{u.cpf || '—'}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--ink3)', borderLeft: '1px solid var(--line)' }}>{u.telefone || '—'}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--ink3)', borderLeft: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{u.criadoEm || '—'}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'center', borderLeft: '1px solid var(--line)' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600,
                      background: u.ativo ? '#dcfce7' : '#fee2e2',
                      color: u.ativo ? 'var(--green)' : 'var(--red)',
                    }}>
                      {u.ativo ? 'Ativo' : 'Bloqueado'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', borderLeft: '1px solid var(--line)' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      <button
                        onClick={() => handleToggle(u)}
                        title={u.ativo ? 'Bloquear acesso' : 'Liberar acesso'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 5, color: u.ativo ? 'var(--green)' : 'var(--ink3)' }}
                      >
                        {u.ativo ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                      </button>
                      <button
                        onClick={() => handleRemove(u)}
                        title="Remover usuário"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 5, color: 'var(--red)' }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Nota de rodapé */}
      <p style={{ fontSize: 10, color: 'var(--ink3)', textAlign: 'center', paddingBottom: 8 }}>
        Dados armazenados na aba <strong>USUARIOS</strong> da planilha do Google Sheets.
        Alterações refletem imediatamente no próximo login.
      </p>
    </div>
  )
}
