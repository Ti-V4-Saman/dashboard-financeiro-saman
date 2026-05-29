import type { NextConfig } from 'next'
import path from 'path'

const isDev = process.env.NODE_ENV !== 'production'

// Content-Security-Policy.
// Notas de compatibilidade com este app:
//   - script-src 'unsafe-inline': o Next injeta scripts inline de hidratação
//     (sem nonce configurado). Em dev, o Next também exige 'unsafe-eval'.
//   - style-src 'unsafe-inline': o app usa atributos `style={{...}}` em massa
//     e o Tailwind injeta estilos; ambos exigem inline.
//   - img-src https: data:: avatares do Google (googleusercontent) + imagens
//     embutidas em data-uri.
//   - font-src 'self': o Inter é self-hospedado via next/font (build time).
//   - connect-src 'self': todas as chamadas de API são same-origin.
//   - frame-ancestors 'none': anti-clickjacking (reforça X-Frame-Options).
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: https:`,
  `font-src 'self'`,
  `connect-src 'self'`,
  `form-action 'self' https://accounts.google.com`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `object-src 'none'`,
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // HSTS só faz sentido sob HTTPS (produção / Vercel).
  ...(!isDev
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
