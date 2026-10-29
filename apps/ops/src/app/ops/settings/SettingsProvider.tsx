'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { resolveOperatorSetting, type OperatorSettingKey, type OperatorSettingValue } from '@wivwav/types/operator-settings'

export interface SettingEntry {
  key: string
  value: unknown
  type: string
  id: string
  createdAt: string
  createdBy: string | null
}

interface SettingsState {
  entries: Map<string, SettingEntry>
  loading: boolean
  error: string | null
  mutationRevision: number
  apiBaseUrl: string
  save: <K extends OperatorSettingKey>(key: K, value: OperatorSettingValue<K>) => Promise<void>
  reset: (key: OperatorSettingKey) => Promise<void>
}

const SettingsContext = createContext<SettingsState | null>(null)

export function SettingsProvider({ apiBaseUrl, children }: { apiBaseUrl: string; children: React.ReactNode }) {
  const [entries, setEntries] = useState<Map<string, SettingEntry>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mutationRevision, setMutationRevision] = useState(0)
  const revision = useRef(0)

  const refresh = useCallback(async () => {
    const startedAtRevision = revision.current
    try {
      const response = await fetch(`${apiBaseUrl}/admin/config`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`Settings request failed (${response.status})`)
      const body = (await response.json()) as { data: SettingEntry[] }
      if (revision.current === startedAtRevision) {
        setEntries(new Map(body.data.map(entry => [entry.key, entry])))
        setError(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Settings could not load')
    } finally {
      setLoading(false)
    }
  }, [apiBaseUrl])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 60_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const save = useCallback(async (key: OperatorSettingKey, value: number | boolean) => {
    const response = await fetch(`${apiBaseUrl}/admin/config/${encodeURIComponent(key)}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value, type: typeof value === 'boolean' ? 'boolean' : 'number' }),
    })
    if (!response.ok) throw new Error(`Save failed (${response.status})`)
    const body = (await response.json()) as { data: SettingEntry }
    revision.current += 1
    setEntries(previous => new Map(previous).set(key, body.data))
    setMutationRevision(previous => previous + 1)
  }, [apiBaseUrl])

  const reset = useCallback(async (key: OperatorSettingKey) => {
    const response = await fetch(`${apiBaseUrl}/admin/config/${encodeURIComponent(key)}`, { method: 'DELETE' })
    if (!response.ok) throw new Error(`Reset failed (${response.status})`)
    revision.current += 1
    setEntries(previous => { const next = new Map(previous); next.delete(key); return next })
    setMutationRevision(previous => previous + 1)
  }, [apiBaseUrl])

  const value = useMemo(() => ({ entries, loading, error, mutationRevision, apiBaseUrl, save, reset }), [entries, loading, error, mutationRevision, apiBaseUrl, save, reset])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useOptionalSettings(): SettingsState | null {
  return useContext(SettingsContext)
}

export function useSettings(): SettingsState {
  const state = useContext(SettingsContext)
  if (!state) throw new Error('SettingsProvider is required')
  return state
}

export function useSettingValue<K extends OperatorSettingKey>(key: K): OperatorSettingValue<K> | null {
  const settings = useOptionalSettings()
  if (!settings || settings.loading || settings.error) return null
  const { entries } = settings
  const row = entries.get(key)
  return resolveOperatorSetting(key, row ? { value: row.value, type: row.type } : null)
}
