import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getSheetRows, appendSheetRow, updateSheetCell } from '@/lib/gsheetsApi'

const SHEET = 'USUARIOS'
// Colunas (1-indexado): NOME=1, CPF=2, EMAIL=3, TELEFONE=4, ATIVO=5, CRIADO_EM=6

export interface Usuario {
  rowIndex: number   // linha na planilha (começa em 2, pois linha 1 é cabeçalho)
  nome: string
  cpf: string
  email: string
  telefone: string
  ativo: boolean
  criadoEm: string
}

function parseRows(rows: string[][]): Usuario[] {
  if (rows.length < 2) return []
  return rows.slice(1).map((r, i) => ({
    rowIndex: i + 2,
    nome: r[0] || '',
    cpf: r[1] || '',
    email: r[2] || '',
    telefone: r[3] || '',
    ativo: (r[4] || 'TRUE').toUpperCase() === 'TRUE',
    criadoEm: r[5] || '',
  }))
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
    const rows = await getSheetRows(SHEET)
    return NextResponse.json(parseRows(rows))
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
    const { nome, cpf, email, telefone } = await req.json() as Partial<Usuario>
    if (!email) return NextResponse.json({ error: 'email obrigatório' }, { status: 400 })

    const criadoEm = new Date().toLocaleDateString('pt-BR')
    await appendSheetRow(SHEET, [
      nome || '',
      cpf  || '',
      email.trim().toLowerCase(),
      telefone || '',
      'TRUE',
      criadoEm,
    ])
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
    const { rowIndex, ativo } = await req.json() as { rowIndex: number; ativo: boolean }
    await updateSheetCell(SHEET, rowIndex, 5, ativo ? 'TRUE' : 'FALSE')
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[PATCH /api/usuarios]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ── DELETE — remove usuário (soft-delete: limpa email + desativa) ─────────────
export async function DELETE(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }
  try {
    const { rowIndex } = await req.json() as { rowIndex: number }
    await updateSheetCell(SHEET, rowIndex, 5, 'FALSE')
    await updateSheetCell(SHEET, rowIndex, 3, `REMOVIDO_${Date.now()}`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/usuarios]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
