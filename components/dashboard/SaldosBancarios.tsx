'use client'

import { fR } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface ContaSaldo {
  id: string
  nome: string
  tipo: string
  tipoRaw?: string
  banco: string | null
  saldo: number
  saldoEtl?: number
  dataUltimaConciliacao: string | null
  syncedAt?: string | null
  horasDesdeSync?: number | null
}

export interface SaldosData {
  contas: ContaSaldo[]
  consolidado: number
  disponivel?: number
  dividaCartao?: number
  posicaoLiquida?: number
}

interface Props {
  data: SaldosData | null
  loading?: boolean
}

// ── Avatar helpers ────────────────────────────────────────────────────────────

const PALETTE = [
  { bg: '#E8F0FD', fg: '#1B55A3' }, // azul
  { bg: '#FFF3E0', fg: '#8B5B0D' }, // âmbar
  { bg: '#E8F8F0', fg: '#14703F' }, // verde
  { bg: '#F3E8FD', fg: '#7C3AED' }, // roxo
  { bg: '#FEE8E8', fg: '#C62828' }, // vermelho
  { bg: '#E8ECF0', fg: '#384858' }, // cinza
]

function avatarColor(nome: string) {
  let h = 0
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}

function iniciais(nome: string): string {
  return nome
    .replace(/[^a-zA-ZÀ-ÿ\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 3)
}

/** Retorna o caminho da logo se existir para o nome da conta, null caso contrário. */
function getBankLogo(nome: string): string | null {
  const n = nome.toLowerCase()
  if (n.includes('conta azul'))   return '/img/conta_azul.png'
  if (n.includes('conta simpl'))  return '/img/conta_simples.png'
  if (n.includes('iugu'))         return '/img/iugu.png'
  if (n.includes('maquineta'))    return '/img/Maquineta.png'
  if (n.includes('santander'))    return '/img/santander.png'
  if (n.includes('sicoob'))       return '/img/sicoob.jpeg'
  return null
}

function saldoCor(saldo: number): string {
  if (saldo > 0) return '#1D9E75'
  if (saldo < 0) return '#E24B4A'
  return 'var(--ink3)'
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ h = 14, w = '100%' }: { h?: number; w?: string }) {
  return (
    <div
      className="rounded animate-pulse"
      style={{ height: h, width: w, background: 'var(--surf3)' }}
    />
  )
}

// ── SaldosBancarios ──────────────────────────────────────────────────────────

export function SaldosBancarios({ data, loading }: Props) {
  return (
    // h-full + flex-col fazem o card preencher a celula do grid quando
    // renderizado em sidebar (gridRow: '1 / span 2' na VisaoGeral).
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle>Saldos bancários</CardTitle>
        <CardDescription>Por conta financeira</CardDescription>
      </CardHeader>

      {/* flex-1 faz o conteudo expandir; consolidado vai pro bottom com mt-auto */}
      <CardContent className="gap-0 pt-0 flex-1 flex flex-col">
        {/* KPIs (Disponível / Dívida Cartão / Posição Líquida) */}
        <div
          className="grid grid-cols-3 gap-1.5 mb-2 pb-2"
          style={{ borderBottom: '0.5px solid var(--line)' }}
        >
          {([
            { label: 'Disponível',      value: data?.disponivel ?? null,     forceCor: 'pos' as const },
            { label: 'Dívida cartão',   value: data?.dividaCartao ?? null,   forceCor: 'neg' as const },
            { label: 'Posição líquida', value: data?.posicaoLiquida ?? null, forceCor: null },
          ]).map(k => {
            const cor =
              k.value == null         ? 'var(--ink3)' :
              k.forceCor === 'pos'    ? '#1D9E75' :
              k.forceCor === 'neg'    ? (k.value < 0 ? '#E24B4A' : 'var(--ink3)') :
              saldoCor(k.value)
            return (
              <div
                key={k.label}
                className="rounded px-1.5 py-1"
                style={{ background: 'var(--surf2)' }}
              >
                <div className="text-[9px] uppercase tracking-wide" style={{ color: 'var(--ink4)' }}>
                  {k.label}
                </div>
                {loading || !data || k.value == null ? (
                  <Skeleton h={13} w="80%" />
                ) : (
                  <div className="text-[12px] font-semibold leading-tight" style={{ color: cor }}>
                    {fR(k.value)}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Lista de contas */}
        <div>
          {loading || !data ? (
            <div className="space-y-3 py-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <Skeleton h={28} w="28px" />
                  <Skeleton h={12} w="60%" />
                  <Skeleton h={12} w="20%" />
                </div>
              ))}
            </div>
          ) : data.contas.length === 0 ? (
            <p className="py-4 text-center text-[11px]" style={{ color: 'var(--ink3)' }}>
              Nenhuma conta ativa
            </p>
          ) : (
            <div>
              {data.contas.map((c, i) => {
                const av   = avatarColor(c.nome)
                const logo = getBankLogo(c.nome)
                const isLast = i === data.contas.length - 1
                return (
                  <div
                    key={c.id}
                    className="flex items-center gap-2.5 py-2"
                    style={{
                      borderBottom: isLast ? 'none' : '0.5px solid var(--line)',
                    }}
                  >
                    {/* Avatar: logo ou iniciais */}
                    <div
                      className="shrink-0 flex items-center justify-center rounded overflow-hidden"
                      style={{
                        width: 28, height: 28,
                        background: logo ? '#fff' : av.bg,
                        color: av.fg,
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.02em',
                        border: logo ? '0.5px solid var(--line2)' : 'none',
                      }}
                    >
                      {logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={logo}
                          alt={c.nome}
                          style={{ width: 28, height: 28, objectFit: 'contain', padding: 3 }}
                        />
                      ) : (
                        iniciais(c.nome)
                      )}
                    </div>

                    {/* Nome + tipo (+ badge de defasagem se synced_at > 24h) */}
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-[11px] font-medium truncate"
                        style={{ color: 'var(--ink2)' }}
                        title={c.nome}
                      >
                        {c.nome}
                      </div>
                      <div className="flex items-center gap-1.5 text-[9px]" style={{ color: 'var(--ink4)' }}>
                        <span>{c.tipo}</span>
                        {typeof c.horasDesdeSync === 'number' && c.horasDesdeSync > 24 && (
                          <span
                            className="rounded px-1 py-px"
                            title={`Última sincronização: ${c.syncedAt ?? '—'}`}
                            style={{
                              background: 'var(--surf3)',
                              color: 'var(--ink3)',
                              fontSize: 9,
                              lineHeight: 1.1,
                            }}
                          >
                            ⚠ {Math.floor(c.horasDesdeSync / 24)}d
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Saldo */}
                    <div
                      className="text-[12px] font-semibold shrink-0"
                      style={{ color: saldoCor(c.saldo) }}
                    >
                      {fR(c.saldo)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Consolidado — mt-auto empurra para o bottom quando o card preenche
            uma sidebar mais alta que o conteudo natural da lista. */}
        <div
          className="flex items-center justify-between pt-2 mt-auto"
          style={{ borderTop: '0.5px solid var(--line)' }}
        >
          <span className="text-[12px] font-medium" style={{ color: 'var(--ink3)' }}>
            Saldo consolidado
          </span>
          {loading || !data ? (
            <Skeleton h={13} w="80px" />
          ) : (
            <span
              className="text-[13px] font-bold"
              style={{ color: saldoCor(data.consolidado) }}
            >
              {fR(data.consolidado)}
            </span>
          )}
        </div>

        {/* "A receber 30d" e "A pagar 30d" foram movidos para o widget
            "Ponto de Equilíbrio" (próximos 3 meses, regime caixa, com
            decomposição). Mantemos apenas o saldo consolidado aqui. */}
      </CardContent>
    </Card>
  )
}
