'use client'

import { useState, useEffect } from 'react'
import type { Meta } from '@/lib/types'

const STORAGE_KEY = 'fin_metas_v1'

export function useMetas() {
  const [metas, setMetas] = useState<Meta[]>([])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setMetas(JSON.parse(raw))
    } catch {
      // ignore
    }
  }, [])

  function persist(list: Meta[]) {
    setMetas(list)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    } catch {
      // ignore
    }
  }

  function addMeta(m: Omit<Meta, 'id' | 'criado_em'>): Meta {
    const nova: Meta = {
      ...m,
      id: crypto.randomUUID(),
      criado_em: new Date().toISOString(),
    }
    persist([...metas, nova])
    return nova
  }

  function updateMeta(id: string, m: Omit<Meta, 'id' | 'criado_em'>) {
    persist(metas.map(x => (x.id === id ? { ...x, ...m } : x)))
  }

  function deleteMeta(id: string) {
    persist(metas.filter(x => x.id !== id))
  }

  return { metas, addMeta, updateMeta, deleteMeta }
}
