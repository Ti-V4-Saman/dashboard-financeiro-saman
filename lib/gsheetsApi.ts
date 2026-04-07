/**
 * Google Sheets API v4 helper — autenticação via Service Account (sem dependências externas).
 * Usa o módulo nativo `crypto` do Node + `fetch` global do Node 18+.
 */

import { createSign } from 'crypto'

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

// Cache do access token em memória (válido por 1h, renovado com 60s de margem)
let _cachedToken: { token: string; exp: number } | null = null

async function getSAToken(): Promise<string> {
  if (_cachedToken && Date.now() < _cachedToken.exp - 60_000) {
    return _cachedToken.token
  }

  const saEmail = process.env.GOOGLE_SA_EMAIL || ''
  // A chave privada vem do JSON do service account, com \n literais no .env
  const saKey = (process.env.GOOGLE_SA_KEY || '').replace(/\\n/g, '\n')

  if (!saEmail || !saKey) {
    throw new Error('GOOGLE_SA_EMAIL ou GOOGLE_SA_KEY não configurados.')
  }

  const now = Math.floor(Date.now() / 1000)
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: saEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  })).toString('base64url')

  const sign = createSign('RSA-SHA256')
  sign.update(`${header}.${payload}`)
  const signature = sign.sign(saKey, 'base64url')
  const jwt = `${header}.${payload}.${signature}`

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Erro ao obter token SA: ${err}`)
  }

  const data = await res.json() as { access_token: string; expires_in: number }
  _cachedToken = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 }
  return _cachedToken.token
}

function sheetsId(): string {
  return process.env.SHEETS_ID || ''
}

/** Lê todas as linhas de uma aba (retorna string[][]). */
export async function getSheetRows(sheetName: string): Promise<string[][]> {
  const token = await getSAToken()
  const range = encodeURIComponent(`${sheetName}!A:Z`)
  const res = await fetch(`${BASE}/${sheetsId()}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Erro ao ler aba ${sheetName}: ${res.status}`)
  const data = await res.json() as { values?: string[][] }
  return data.values || []
}

/** Adiciona uma linha no final da aba. */
export async function appendSheetRow(sheetName: string, values: string[]): Promise<void> {
  const token = await getSAToken()
  const range = encodeURIComponent(`${sheetName}!A:Z`)
  const res = await fetch(
    `${BASE}/${sheetsId()}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [values] }),
    },
  )
  if (!res.ok) throw new Error(`Erro ao inserir linha em ${sheetName}: ${res.status}`)
}

/** Atualiza uma célula específica (row e col são 1-indexados). */
export async function updateSheetCell(
  sheetName: string,
  row: number,
  col: number,
  value: string,
): Promise<void> {
  const token = await getSAToken()
  // col 1=A, 2=B, ... 26=Z
  const colLetter = String.fromCharCode(64 + col)
  const range = encodeURIComponent(`${sheetName}!${colLetter}${row}`)
  const res = await fetch(
    `${BASE}/${sheetsId()}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[value]] }),
    },
  )
  if (!res.ok) throw new Error(`Erro ao atualizar célula ${sheetName}!${colLetter}${row}: ${res.status}`)
}
