import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { isAdmin } from '@/lib/auth-guard'
import { sanitizeScreens } from '@/lib/screens'

const pool = getPool()

export interface Usuario {
  id: number
  nome: string
  email: string
  ativo: boolean
  is_admin: boolean
  telas_permitidas: string[]
  ver_folha_detalhe: boolean
  criado_em: string
}

// ── GET — lista todos os usuários ────────────────────────────────────────────
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }
  try {
    const { rows } = await pool.query(
      'SELECT id, nome, email, ativo, is_admin, telas_permitidas, ver_folha_detalhe, criado_em FROM ca.usuarios_dashboard ORDER BY criado_em DESC'
    )
    return NextResponse.json(rows)
  } catch (err) {
    console.error('[GET /api/usuarios]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── POST — adiciona novo usuário à allowlist ─────────────────────────────────
// Cria sem telas (default '{}') e sem admin; permissões são definidas no PATCH.
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }
  try {
    const { nome, email } = await req.json() as Partial<Usuario>
    if (!email) return NextResponse.json({ error: 'email obrigatório' }, { status: 400 })

    await pool.query(
      'INSERT INTO ca.usuarios_dashboard (nome, email) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET ativo = TRUE, nome = EXCLUDED.nome',
      [nome || '', email.trim().toLowerCase()]
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/usuarios]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── PATCH — atualiza ativo / is_admin / telas_permitidas (parcial) ───────────
export async function PATCH(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }
  try {
    const body = await req.json() as {
      id: number
      ativo?: boolean
      is_admin?: boolean
      telas_permitidas?: string[]
      ver_folha_detalhe?: boolean
    }
    if (typeof body.id !== 'number') {
      return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
    }

    const sets: string[] = []
    const vals: unknown[] = []
    let i = 1

    if (typeof body.ativo === 'boolean') {
      sets.push(`ativo = $${i++}`); vals.push(body.ativo)
    }
    if (typeof body.is_admin === 'boolean') {
      sets.push(`is_admin = $${i++}`); vals.push(body.is_admin)
    }
    if (typeof body.ver_folha_detalhe === 'boolean') {
      sets.push(`ver_folha_detalhe = $${i++}`); vals.push(body.ver_folha_detalhe)
    }
    if (Array.isArray(body.telas_permitidas)) {
      // 'acesso' é governado pelo is_admin — nunca persistido como tela comum.
      const telas = sanitizeScreens(body.telas_permitidas).filter(s => s !== 'acesso')
      sets.push(`telas_permitidas = $${i++}`); vals.push(telas)
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'nada para atualizar' }, { status: 400 })
    }

    vals.push(body.id)
    await pool.query(
      `UPDATE ca.usuarios_dashboard SET ${sets.join(', ')} WHERE id = $${i}`,
      vals,
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/usuarios]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── DELETE — remove usuário ───────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }
  try {
    const { id } = await req.json() as { id: number }
    await pool.query('DELETE FROM ca.usuarios_dashboard WHERE id = $1', [id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/usuarios]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
