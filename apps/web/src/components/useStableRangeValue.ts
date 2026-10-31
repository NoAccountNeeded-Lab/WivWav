'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type RangeValue = readonly [number, number]
interface HistoryRange {
  range: RangeValue
  searchParams: string
}
interface PendingRange {
  expected: RangeValue
  from: RangeValue
  historyOverride: boolean
  historySearchParams: string | null
}

export function parsePositiveIntegerParameter(raw: string | null): number {
  if (raw === null || raw.trim() === '') return 0
  if (!/^\d+$/.test(raw)) return 0
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
}

export function rangeFilterSearchParams(search: string, preservePage = false): URLSearchParams {
  const params = new URLSearchParams(search)
  if (!preservePage) params.delete('page')
  return params
}

function sameRange(left: RangeValue, right: RangeValue): boolean {
  return left[0] === right[0] && left[1] === right[1]
}

function matchesExpectedRange(actual: RangeValue, expected: RangeValue, defaults: RangeValue): boolean {
  return (expected[0] === 0 ? actual[0] === 0 || actual[0] === defaults[0] : actual[0] === expected[0])
    && (expected[1] === 0 ? actual[1] === 0 || actual[1] === defaults[1] : actual[1] === expected[1])
}

/** Keeps a committed slider value visible until the URL reflects that commit. */
const noop = () => {}

export function useStableRangeValue(
  urlValue: RangeValue,
  defaultValue: RangeValue = urlValue,
  reapplyCommit: (expectedValue: RangeValue, searchParams?: string) => void = noop,
  readHistoryValue?: (search: string) => HistoryRange | null,
) {
  const [localValue, setLocalValue] = useState<RangeValue | null>(null)
  const pendingValue = useRef<PendingRange | null>(null)
  const lastReapplied = useRef<string | null>(null)
  const urlValueRef = useRef(urlValue)
  urlValueRef.current = urlValue

  useEffect(() => {
    const pending = pendingValue.current
    if (!pending) return
    if (pending.historyOverride && !matchesExpectedRange(urlValue, pending.expected, defaultValue)) return
    if (matchesExpectedRange(urlValue, pending.expected, defaultValue)) {
      if (pending.historyOverride) {
        setLocalValue(null)
        return
      }
      pendingValue.current = null
      lastReapplied.current = null
      setLocalValue((local) => {
        if (!local || sameRange(local, pending.expected)
          || (pending.expected[0] === 0 && pending.expected[1] > 0 && local[0] === 0 && local[1] === 0)) return null
        if (local[0] === pending.expected[0] && pending.expected[1] === 0) {
          return [local[0], defaultValue[1]]
        }
        if (local[1] === pending.expected[1] && pending.expected[0] === 0) {
          return [defaultValue[0], local[1]]
        }
        return local
      })
      return
    }
    if (!pending.historyOverride && sameRange(urlValue, pending.from)) {
      if (sameRange(pending.expected, pending.from)) {
        pendingValue.current = null
        lastReapplied.current = null
        setLocalValue(null)
      }
      return
    }

    const key = `${urlValue[0]}:${urlValue[1]}|${pending.expected[0]}:${pending.expected[1]}`
    if (lastReapplied.current !== key) {
      lastReapplied.current = key
      reapplyCommit(pending.expected, pending.historySearchParams ?? undefined)
    }
  }, [urlValue[0], urlValue[1], defaultValue[0], defaultValue[1], reapplyCommit])

  useEffect(() => {
    function clearPendingOnHistoryNavigation() {
      const priorPending = pendingValue.current
      const historyValue = priorPending && readHistoryValue
        ? readHistoryValue(window.location.search)
        : null
      if (historyValue) {
        pendingValue.current = {
          expected: historyValue.range,
          from: urlValueRef.current,
          historyOverride: true,
          historySearchParams: historyValue.searchParams,
        }
      } else {
        pendingValue.current = null
      }
      lastReapplied.current = null
      setLocalValue(null)
    }

    window.addEventListener('popstate', clearPendingOnHistoryNavigation)
    return () => {
      window.removeEventListener('popstate', clearPendingOnHistoryNavigation)
    }
  }, [readHistoryValue])

  const clearHistoryOverride = useCallback(() => {
    if (pendingValue.current?.historyOverride) {
      pendingValue.current = null
      lastReapplied.current = null
    }
  }, [])

  const handleChange = useCallback((value: number[]) => {
    clearHistoryOverride()
    if (value.length >= 2) setLocalValue([value[0]!, value[1]!])
    else if (value.length === 1) setLocalValue([0, value[0]!])
  }, [clearHistoryOverride])

  const handleCommit = useCallback((value: number[], expectedValue?: RangeValue): RangeValue | null => {
    if (value.length === 0) return null
    clearHistoryOverride()
    const committed: RangeValue = value.length >= 2 ? [value[0]!, value[1]!] : [0, value[0]!]
    pendingValue.current = {
      expected: expectedValue ?? committed,
      from: urlValueRef.current,
      historyOverride: false,
      historySearchParams: null,
    }
    lastReapplied.current = null
    if (sameRange(pendingValue.current.expected, urlValueRef.current)) {
      pendingValue.current = null
      lastReapplied.current = null
      setLocalValue(null)
    } else {
      setLocalValue(committed)
    }
    return committed
  }, [clearHistoryOverride])

  return {
    value: pendingValue.current?.historyOverride
      ? [pendingValue.current.expected[0] || defaultValue[0], pendingValue.current.expected[1] || defaultValue[1]] as const
      : localValue ?? [urlValue[0] || defaultValue[0], urlValue[1] || defaultValue[1]] as const,
    handleChange,
    handleCommit,
  }
}
