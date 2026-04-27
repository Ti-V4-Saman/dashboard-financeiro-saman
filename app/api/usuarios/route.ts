import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

export interface Usuario {
  id: number
  nome: string
  email: string
  ativo: boolean
  criado_em: string
}

async function isAdmin(): Promise<boolean> {
  const session = await auth()
  return (session?.user as { isAdmin?: boolean })?.isAdmin === true
}

// ── GET — lista todos os usuários ────────────────────────────────────────────
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }
  try {
    const { rows } = await pool.query(
      'SELECT id, nome, email, ativo, criado_em FROM ca.usuarios_dashboard ORDER BY criado_em DESC'
    )
    return NextResponse.json(rows)
  } catch (err) {
    console.error('[GET /api/usuarios]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ── POST — adiciona novo usuário ──────────────────────────────────────────────
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
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ── PATCH — alterna ATIVO (ativa/bloqueia) ────────────────────────────────────
export async function PATCH(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }
  try {
    const { id, ativo } = await req.json() as { id: number; ativo: boolean }
    await pool.query(
      'UPDATE ca.usuarios_dashboard SET ativo = $1 WHERE id = $2',
      [ativo, id]
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/usuarios]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
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
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
