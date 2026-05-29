import { Pool } from 'pg'

/**
 * Pool de conexões PostgreSQL/Supabase compartilhado por TODAS as rotas de API.
 *
 * Por que singleton global:
 *   - Em serverless/Next.js cada módulo de rota instanciava seu próprio Pool;
 *     somados (8 rotas × N instâncias) estouravam o limite de conexões do
 *     Postgres. Um único pool por processo evita isso.
 *   - O cache em `globalThis` sobrevive ao hot-reload do dev (que reavalia
 *     módulos e, sem isso, vazaria um pool a cada reload).
 *
 * Segurança TLS:
 *   - Quando `DATABASE_CA_CERT` (PEM do CA do Supabase) está definido, a
 *     conexão usa verificação completa de certificado (rejectUnauthorized:true),
 *     fechando o vetor de MITM.
 *   - Sem o CA, mantemos a conexão funcionando (rejectUnauthorized:false) para
 *     não quebrar produção, mas emitimos um aviso. Defina DATABASE_CA_CERT em
 *     produção para habilitar a verificação. O CA do Supabase está em
 *     Project Settings → Database → SSL Configuration.
 */

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined
}

function buildSsl(): { ca: string; rejectUnauthorized: true } | { rejectUnauthorized: false } {
  const ca = process.env.DATABASE_CA_CERT
  if (ca && ca.trim()) {
    return { ca, rejectUnauthorized: true }
  }
  console.warn(
    '[db] DATABASE_CA_CERT ausente — conexão TLS sem verificação de certificado. ' +
      'Defina DATABASE_CA_CERT (PEM do CA do Supabase) para habilitar a verificação.',
  )
  return { rejectUnauthorized: false }
}

export function getPool(): Pool {
  if (!globalThis.__pgPool) {
    globalThis.__pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: buildSsl(),
    })
  }
  return globalThis.__pgPool
}
