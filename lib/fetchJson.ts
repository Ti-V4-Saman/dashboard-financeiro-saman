/**
 * Helper único de fetch JSON do dashboard.
 *
 * PROBLEMA QUE ISTO RESOLVE
 * O padrão antigo, repetido em 4 arquivos, era:
 *
 *     const fetcher = (url: string) => fetch(url).then(r => r.json())
 *
 * `fetch` não rejeita em 4xx/5xx. Então um 403 do guard de tela virava
 * `{ error: 'Sem permissão...' }` — um objeto TRUTHY — e o SWR o entregava
 * como `data`. Pior: o default do destructuring (`const { data = [] }`) só
 * vale quando `data === undefined`, então ele NÃO protegia. O corpo do erro
 * chegava inteiro num `.filter()` e estourava
 * "t.filter is not a function", derrubando a página.
 *
 * REGRA DAQUI PARA A FRENTE
 * Nenhum corpo de resposta de erro pode chegar num `.filter/.map/.reduce`.
 *
 *   • `jsonFetcher`      — lança HttpError em !ok. `data` fica `undefined`,
 *                          e aí sim os defaults do destructuring funcionam.
 *   • `safeFetcher(vazio)` — em 403 resolve com um vazio seguro do tipo
 *                          esperado (array vazio para listas, objeto neutro
 *                          para agregados). Outros erros continuam lançando,
 *                          porque "sem permissão" e "backend caiu" são coisas
 *                          diferentes e merecem UI diferente.
 *
 * Nada aqui altera guard, permissão ou status code — o 403 do servidor está
 * correto e continua igual. O conserto é 100% no consumo client-side.
 */

export class HttpError extends Error {
  readonly status: number
  readonly url: string

  constructor(status: number, url: string, message?: string) {
    super(message ?? `HTTP ${status} em ${url}`)
    this.name = 'HttpError'
    this.status = status
    this.url = url
  }

  /** 403 = usuário autenticado, mas sem permissão para esta tela. */
  get isForbidden(): boolean {
    return this.status === 403
  }
}

/** True quando o erro (de SWR ou try/catch) é um 403 de permissão. */
export function isForbidden(err: unknown): boolean {
  return err instanceof HttpError && err.isForbidden
}

async function parseJson<T>(res: Response, url: string): Promise<T> {
  try {
    return (await res.json()) as T
  } catch {
    throw new HttpError(res.status, url, `Resposta não-JSON em ${url}`)
  }
}

/**
 * Fetcher padrão para SWR e chamadas diretas.
 * Lança HttpError quando a resposta não é 2xx — nunca devolve corpo de erro.
 */
export async function jsonFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    let detalhe: string | undefined
    try {
      const corpo = (await res.json()) as { error?: string }
      detalhe = typeof corpo?.error === 'string' ? corpo.error : undefined
    } catch {
      /* corpo não-JSON: o status já basta */
    }
    throw new HttpError(res.status, url, detalhe)
  }
  return parseJson<T>(res, url)
}

/**
 * Fetcher tolerante a falta de permissão.
 *
 * Em 403 resolve com `vazio` — o valor neutro do tipo esperado — para que o
 * componente renderize um estado vazio em vez de quebrar. Qualquer outro
 * erro é lançado normalmente (SWR popula `error` e a UI mostra falha).
 *
 *     const fetcherMetas = safeFetcher<Meta[]>([])
 *     const { data: metas = [] } = useSWR('/api/metas', fetcherMetas)
 *
 * `vazio` é congelado para impedir que um consumidor faça push/sort nele e
 * contamine todas as chamadas seguintes que compartilham a mesma referência.
 */
export function safeFetcher<T>(vazio: T): (url: string) => Promise<T> {
  const congelado = Object.isFrozen(vazio) ? vazio : Object.freeze(vazio)
  return async (url: string): Promise<T> => {
    try {
      return await jsonFetcher<T>(url)
    } catch (err) {
      if (isForbidden(err)) return congelado as T
      throw err
    }
  }
}

/**
 * Garante um array para consumo com .filter/.map/.reduce.
 * Última linha de defesa: se algo escapar (endpoint novo, resposta
 * inesperada), o componente renderiza vazio em vez de estourar.
 */
export function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}
