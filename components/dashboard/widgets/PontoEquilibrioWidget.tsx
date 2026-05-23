'use client'

/**
 * Widget Ponto de Equilíbrio.
 *
 * Mostra projeção de fluxo de caixa para o mês corrente + 2 futuros.
 * Sempre em regime CAIXA, ignora o filtro de período do dashboard.
 *
 * Card do mês corrente é mais rico (decomposição do "Já entrou" + alavancas
 * acionáveis + saldo projetado). Cards futuros são simplificados.
 */
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── Tipos espelham /api/ponto-equilibrio ────────────────────────────────────

interface ReceitaAtual {
  ja_entrou_total:         number
  ja_entrou_no_vencimento: number
  ja_entrou_antecipacao:   number
  ja_entrou_recuperacao:   number
  a_entrar:                number
  qtd_a_entrar:            number
  em_atraso:               number
  qtd_em_atraso:           number
  total_potencial:         number
}
interface DespesaAtual {
  ja_saiu:            number
  a_pagar:            number
  qtd_a_pagar:        number
  em_atraso:          number
  total_comprometido: number
}
interface MesAtual {
  mes_ref:              string
  mes_label:            string
  is_atual:             true
  dias_uteis_restantes: number
  receita:              ReceitaAtual
  despesa:              DespesaAtual
  gap:                  number
  saldo_projetado:      number
}
interface MesFuturo {
  mes_ref:           string
  mes_label:         string
  is_atual:          false
  dias_uteis_total:  number
  receita:           { a_entrar: number; qtd_a_entrar: number; total_potencial: number }
  despesa:           { a_pagar:  number; qtd_a_pagar:  number; total_comprometido: number }
  gap:               number
}
type Mes = MesAtual | MesFuturo

interface Payload {
  saldo_atual:  number
  calculado_em: string
  meses:        Mes[]
}

// ── Formatadores ────────────────────────────────────────────────────────────

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDDMM(yyyymmdd: string): string {
  const [, m, d] = yyyymmdd.split('-')
  return `${d}/${m}`
}

// ── Cores de gap ────────────────────────────────────────────────────────────

function gapColor(gap: number, despesa: number): {
  bg: string; fg: string; emoji: string; label: string
} {
  if (despesa <= 0 || gap >= 0) {
    return { bg: 'var(--green-l)', fg: 'var(--green)', emoji: '🟢', label: 'GAP positivo' }
  }
  const pct = Math.abs(gap) / despesa
  if (pct > 0.1) {
    return { bg: 'var(--red-l)', fg: 'var(--red)', emoji: '🔴', label: 'GAP crítico' }
  }
  return { bg: 'var(--amber-l)', fg: 'var(--amber)', emoji: '🟡', label: 'GAP de atenção' }
}

// ── Loading / Error ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
      {[0, 1, 2].map(i => (
        <div key={i}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 10,
            padding: 16,
            minHeight: 280,
            animation: 'pulse 1.5s ease-in-out infinite',
            opacity: 0.5,
          }}
        />
      ))}
    </div>
  )
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--red)',
      borderRadius: 10, padding: 20, textAlign: 'center',
    }}>
      <p style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>
        Erro ao carregar dados do ponto de equilíbrio.
      </p>
      <button
        onClick={onRetry}
        style={{
          background: 'var(--surface)', color: 'var(--red)',
          border: '1px solid var(--red)', borderRadius: 6,
          padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
        }}
      >Tentar novamente</button>
    </div>
  )
}

// ── Linhas auxiliares ───────────────────────────────────────────────────────

function Linha({
  label, valor, color, sub, bold, indent,
}: {
  label: string
  valor: number
  color?: string
  sub?: string
  bold?: boolean
  indent?: number
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', paddingLeft: indent || 0 }}>
      <span style={{
        fontSize: indent ? 10 : 11,
        color: color || (indent ? 'var(--ink3)' : 'var(--ink2)'),
        fontWeight: bold ? 600 : 400,
      }}>{label}</span>
      <span style={{
        fontSize: indent ? 10 : 11,
        color: color || (indent ? 'var(--ink3)' : 'var(--ink)'),
        fontWeight: bold ? 700 : 500,
        whiteSpace: 'nowrap',
      }}>{formatBRL(valor)}</span>
    </div>
  )
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: 'var(--ink3)',
        textTransform: 'uppercase', letterSpacing: '0.04em',
        marginBottom: 4,
      }}>{titulo}</div>
      {children}
    </div>
  )
}

// ── CARD: Mês corrente ──────────────────────────────────────────────────────

function CardMesAtual({ mes, saldoAtual, mesFimYMD }: {
  mes: MesAtual
  saldoAtual: number
  mesFimYMD: string
}) {
  const gc = gapColor(mes.gap, mes.despesa.total_comprometido)
  const cobrarAtrasados = mes.receita.em_atraso
  const cortarDespesa   = Math.max(0, Math.abs(mes.gap) - cobrarAtrasados)

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>{mes.mes_label}</h3>
        <span style={{
          fontSize: 9, fontWeight: 600, padding: '2px 8px',
          borderRadius: 4, background: 'var(--blue-l, #e8f0fd)', color: 'var(--blue, #1B55A3)',
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>EM CURSO · {mes.dias_uteis_restantes}d úteis</span>
      </div>

      <Secao titulo="Receita">
        <Linha label="Já entrou no caixa" valor={mes.receita.ja_entrou_total} color="var(--green)" bold />
        <Linha label="↳ No vencimento"      valor={mes.receita.ja_entrou_no_vencimento} indent={12} />
        <Linha label="↳ Antecipações (mês fut.)" valor={mes.receita.ja_entrou_antecipacao} indent={12} />
        <Linha label="↳ Recuperação atrasos"     valor={mes.receita.ja_entrou_recuperacao} indent={12} />
        <Linha label={`A entrar até ${formatDDMM(mesFimYMD)}`} valor={mes.receita.a_entrar} />
        <Linha label={`⚠ Em atraso (recuperar)`} valor={mes.receita.em_atraso} color="var(--amber)" />
        <div style={separatorStyle} />
        <Linha label="Total potencial" valor={mes.receita.total_potencial} bold />
      </Secao>

      <Secao titulo="Despesa">
        <Linha label="Já saiu" valor={mes.despesa.ja_saiu} color="var(--red)" bold />
        <Linha label={`A pagar (${mes.despesa.qtd_a_pagar} contas)`} valor={mes.despesa.a_pagar} />
        <Linha label="⚠ Em atraso" valor={mes.despesa.em_atraso} color="var(--amber)" />
        <div style={separatorStyle} />
        <Linha label="Total comprometido" valor={mes.despesa.total_comprometido} bold />
      </Secao>

      {/* GAP */}
      <div style={{
        marginTop: 14, padding: '10px 12px',
        background: gc.bg, borderRadius: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: gc.fg, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {gc.emoji} GAP cenário otimista*
          </div>
          <div style={{ fontSize: 9, color: gc.fg, opacity: 0.7, marginTop: 1 }}>
            * assumindo 100% atrasados recuperados
          </div>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: gc.fg, whiteSpace: 'nowrap' }}>
          {formatBRL(mes.gap)}
        </div>
      </div>

      {/* ALAVANCAS */}
      <div style={{
        marginTop: 10, padding: '8px 12px',
        background: 'var(--surf2)', borderRadius: 6,
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: 'var(--ink3)',
          textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4,
        }}>
          Alavancas pra zerar o gap
        </div>
        {mes.gap >= 0 ? (
          <div style={{ fontSize: 11, color: 'var(--green)' }}>✓ Mês equilibrado, sem ação adicional</div>
        ) : (
          <>
            <div style={{ fontSize: 11, color: 'var(--ink2)', padding: '2px 0' }}>
              • Cobrar atrasados: <strong>{formatBRL(cobrarAtrasados)}</strong>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink2)', padding: '2px 0' }}>
              • Cortar/postergar despesa: <strong>{formatBRL(cortarDespesa)}</strong>
            </div>
          </>
        )}
      </div>

      {/* Footer com saldo */}
      <div style={{
        marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--line2)',
        fontSize: 10,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
          <span style={{ color: 'var(--ink3)' }}>Saldo atual consolidado</span>
          <span style={{ color: saldoAtual < 0 ? 'var(--red)' : 'var(--ink)' }}>{formatBRL(saldoAtual)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
          <span style={{ color: 'var(--ink3)' }}>Projeção saldo final {formatDDMM(mesFimYMD)}</span>
          <span style={{ color: mes.saldo_projetado < 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>
            {formatBRL(mes.saldo_projetado)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── CARD: Mês futuro ────────────────────────────────────────────────────────

function CardMesFuturo({ mes }: { mes: MesFuturo }) {
  const gc = gapColor(mes.gap, mes.despesa.total_comprometido)
  const dias = mes.dias_uteis_total || 1
  const vendasDia = Math.abs(mes.gap) / dias

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>{mes.mes_label}</h3>
        <span style={{
          fontSize: 9, fontWeight: 600, padding: '2px 8px',
          borderRadius: 4, background: 'var(--surf3)', color: 'var(--ink3)',
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>{mes.dias_uteis_total}d úteis</span>
      </div>

      <Secao titulo="Receita">
        <Linha label="A entrar (não antecipado)" valor={mes.receita.a_entrar} color="var(--green)" />
        <div style={separatorStyle} />
        <Linha label="Total potencial" valor={mes.receita.total_potencial} bold />
      </Secao>

      <Secao titulo="Despesa">
        <Linha label={`A pagar (${mes.despesa.qtd_a_pagar} contas)`} valor={mes.despesa.a_pagar} color="var(--red)" />
        <div style={separatorStyle} />
        <Linha label="Total comprometido" valor={mes.despesa.total_comprometido} bold />
      </Secao>

      <div style={{
        marginTop: 14, padding: '10px 12px',
        background: gc.bg, borderRadius: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: gc.fg, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {gc.emoji} GAP previsto
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: gc.fg, whiteSpace: 'nowrap' }}>
          {formatBRL(mes.gap)}
        </div>
      </div>

      <div style={{
        marginTop: 10, padding: '8px 12px',
        background: 'var(--surf2)', borderRadius: 6,
      }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: 'var(--ink3)',
          textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4,
        }}>
          Alavancas pra zerar o gap
        </div>
        {mes.gap >= 0 ? (
          <div style={{ fontSize: 11, color: 'var(--green)' }}>✓ Mês equilibrado, sem ação adicional</div>
        ) : (
          <>
            <div style={{ fontSize: 11, color: 'var(--ink2)', padding: '2px 0' }}>
              • Vendas extras: <strong>{formatBRL(vendasDia)}/dia útil</strong>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink2)', padding: '2px 0' }}>
              • OU cortar despesa equivalente
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Componente principal ────────────────────────────────────────────────────

export default function PontoEquilibrioWidget() {
  const { data, error, isLoading, mutate } = useSWR<Payload>('/api/ponto-equilibrio', fetcher, {
    refreshInterval: 60_000,   // refresh a cada 1 min
  })

  if (isLoading) return <LoadingSkeleton />
  if (error || !data || 'error' in (data as object)) {
    return <ErrorCard onRetry={() => mutate()} />
  }

  const mesAtual = data.meses.find(m => m.is_atual) as MesAtual | undefined
  // Derivar YYYY-MM-DD do último dia do mês atual a partir do mes_ref
  const fimMesAtualYMD = mesAtual ? lastDayOfMonth(mesAtual.mes_ref) : ''

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
          Ponto de Equilíbrio — Próximos 3 meses
        </h2>
        <p style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2, margin: 0 }}>
          Receita esperada vs Despesa comprometida · antecipações já consideradas no mês em que entraram
        </p>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {data.meses.map(m => m.is_atual
          ? <CardMesAtual  key={m.mes_ref} mes={m} saldoAtual={data.saldo_atual} mesFimYMD={fimMesAtualYMD} />
          : <CardMesFuturo key={m.mes_ref} mes={m} />
        )}
      </div>
    </div>
  )
}

// ── Util local ──────────────────────────────────────────────────────────────

function lastDayOfMonth(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number)
  const d = new Date(y, m, 0)   // dia 0 do mês+1 = último dia do mês
  return `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Estilos compartilhados ──────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
}

const separatorStyle: React.CSSProperties = {
  height: 1,
  background: 'var(--line)',
  margin: '6px 0 4px',
}
