import type { Lancamento } from './types'

export function pD(s: string): Date | null {
  if (!s || s === '(em branco)') return null
  const parts = s.trim().split('/')
  if (parts.length !== 3) return null
  const [d, m, y] = parts
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  if (isNaN(date.getTime())) return null
  return date
}

export function pN(s: string): number {
  if (!s || s === '(em branco)') return 0
  // Remove currency symbol and spaces
  const clean = s.trim().replace(/^R\$\s*/, '').trim()
  // BR format: 1.234,56 → remove thousands dot, replace decimal comma with dot
  const normalized = clean.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(normalized)
  return isNaN(n) ? 0 : n
}

const TRANSFER_CATS = new Set([
  'transferência de entrada',
  'transferência de saída',
  'saldo inicial',
])

function parseRow(headers: string[], cols: string[]): Lancamento | null {
  const get = (key: string): string => {
    const idx = headers.indexOf(key)
    if (idx < 0) return ''
    return (cols[idx] || '').trim()
  }

  const dataRaw = get('Data da baixa ou previsão')
  const data = pD(dataRaw)

  const fornecedor = get('Nome do cliente ou fornecedor')
  const desc = get('Descrição do lançamento') || fornecedor

  const tipoRaw = get('A pagar ou a receber')
  const tipo: 'Receita' | 'Despesa' =
    tipoRaw === 'Contas a receber' ? 'Receita' : 'Despesa'

  const origem = get('Origem do lançamento')
  const isTransfer = origem === 'Transferência'

  const conta = get('Conta financeira')
  const forma = get('Forma de pagamento')

  const valorRaw = get('Valor')
  const valor = Math.abs(pN(valorRaw))

  const situacao = get('Situação')

  // Categories
  const cat1 = get('Categoria')
  const catSup = get('Categoria superior')
  const catSup1 = get('Categoria superior (Nível 1)')

  // Centro de custo
  const cc1 = get('Centro de custo')

  // Check if transfer category
  const catLower = cat1.toLowerCase()
  const isTransferCat = TRANSFER_CATS.has(catLower)

  if (isTransfer || isTransferCat) {
    return {
      data,
      desc,
      fornecedor,
      tipo,
      origem,
      conta,
      forma,
      valor,
      situacao,
      isTransfer: true,
      cat1,
      catSup,
      catSup1,
      cc1,
      categorias: cat1 ? [{ nome: cat1, valor }] : [],
      _ccList: cc1 && cc1 !== '(em branco)' ? [{ nome: cc1, valor }] : [],
    }
  }

  return {
    data,
    desc,
    fornecedor,
    tipo,
    origem,
    conta,
    forma,
    valor,
    situacao,
    isTransfer: false,
    cat1,
    catSup,
    catSup1,
    cc1,
    categorias: cat1 && cat1 !== '(em branco)' ? [{ nome: cat1, valor }] : [],
    _ccList: cc1 && cc1 !== '(em branco)' ? [{ nome: cc1, valor }] : [],
  }
}

function splitCSVLine(line: string, sep: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === sep && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

export function parseCSV(text: string): Lancamento[] {
  // Detect separator
  const firstLine = text.split('\n')[0]
  const sep = firstLine.includes(';') ? ';' : ','

  const lines = text.split('\n').filter(l => l.trim().length > 0)
  if (lines.length < 2) return []

  const headers = splitCSVLine(lines[0], sep).map(h =>
    h.trim().replace(/^"|"$/g, '').trim()
  )

  const result: Lancamento[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i], sep).map(c =>
      c.trim().replace(/^"|"$/g, '').trim()
    )
    if (cols.every(c => c === '')) continue

    try {
      const row = parseRow(headers, cols)
      if (row) result.push(row)
    } catch {
      // Skip malformed rows
    }
  }

  return result
}
