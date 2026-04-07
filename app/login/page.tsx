'use client'

import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { useState, Suspense } from 'react'

function LoginContent() {
  const params = useSearchParams()
  const callbackUrl = params.get('callbackUrl') || '/'
  const error = params.get('error')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    setLoading(true)
    await signIn('google', { callbackUrl })
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--page)' }}
    >
      <div
        className="w-full max-w-sm rounded-xl p-8 flex flex-col items-center gap-6"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          boxShadow: '0 2px 6px rgba(0,0,0,.07), 0 6px 20px rgba(0,0,0,.05)',
        }}
      >
        {/* Logo */}
        <div className="text-center">
          <div className="text-2xl font-bold tracking-tight mb-1" style={{ color: 'var(--brand)' }}>
            V4 Saman &amp; Co
          </div>
          <div className="text-[12px]" style={{ color: 'var(--ink3)' }}>
            Dashboard Financeiro
          </div>
        </div>

        <div className="w-full h-px" style={{ background: 'var(--line)' }} />

        <div className="text-center">
          <div className="text-[13px] font-medium mb-1" style={{ color: 'var(--ink)' }}>
            Acesso restrito
          </div>
          <div className="text-[11px]" style={{ color: 'var(--ink3)' }}>
            Entre com sua conta Google autorizada
          </div>
        </div>

        {error && (
          <div
            className="w-full rounded-lg px-4 py-3 text-[11px] text-center"
            style={{ background: 'var(--red-l)', color: 'var(--red)', border: '1px solid var(--red-m, #EFA8A8)' }}
          >
            {error === 'AccessDenied'
              ? 'Sua conta não tem permissão de acesso. Solicite ao administrador.'
              : 'Ocorreu um erro ao autenticar. Tente novamente.'}
          </div>
        )}

        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 rounded-lg py-2.5 text-[13px] font-medium transition-all"
          style={{
            background: loading ? 'var(--surf2)' : 'var(--surface)',
            border: '1px solid var(--line2)',
            color: 'var(--ink)',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {/* Google icon */}
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
          </svg>
          {loading ? 'Redirecionando...' : 'Entrar com Google'}
        </button>

        <div className="text-[10px] text-center" style={{ color: 'var(--ink4)' }}>
          Apenas contas autorizadas têm acesso
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}
