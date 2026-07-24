'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { OpsNavItem } from '@/app/ops/ops-nav'

/** Returns `true` when the click was fully handled (caller must not
 *  navigate), `false` to fall through to the item's normal `href`
 *  navigation. */
export type NavItemInterceptor = (item: OpsNavItem) => boolean

interface NavItemInterceptorContextValue {
  intercept: NavItemInterceptor | null
  setIntercept: (fn: NavItemInterceptor | null) => void
}

const NavItemInterceptorContext = createContext<NavItemInterceptorContextValue | null>(null)

/**
 * Wraps `apps/ops/src/app/ops/layout.tsx` (every `/ops/*` page, since that's
 * where the shared `<OpsNav />` is instantiated) so a single leaf route can
 * redirect nav-item clicks into its own workspace panels without changing
 * `OpsNav`'s default behavior for every other page (#913's "route-scoped
 * only" requirement). Default state is `null` — no interception — so pages
 * that never call `useRegisterNavItemInterceptor` see exactly today's
 * `NavLinkItem`/`NavRail`/`BottomTabs` navigation.
 */
export function NavItemInterceptorProvider({ children }: { children: ReactNode }) {
  const [intercept, setInterceptState] = useState<NavItemInterceptor | null>(null)
  // `intercept` is itself a function — `useState`'s raw setter would treat a
  // bare function argument as a `(prev) => next` updater rather than the new
  // value, so every caller of the context's `setIntercept` funnels through
  // this wrapper, which always stores it via the updater form on their
  // behalf (`() => fn`), regardless of how the caller passes it in.
  const setIntercept = useCallback((fn: NavItemInterceptor | null) => {
    setInterceptState(() => fn)
  }, [])
  const value = useMemo(() => ({ intercept, setIntercept }), [intercept, setIntercept])
  return <NavItemInterceptorContext.Provider value={value}>{children}</NavItemInterceptorContext.Provider>
}

/** Consumed by the nav-rendering components; returns `null` outside a
 *  provider (e.g. component tests that render `NavColumn`/`NavRail` in
 *  isolation) so they fall back to normal navigation. */
export function useNavItemInterceptor(): NavItemInterceptor | null {
  const ctx = useContext(NavItemInterceptorContext)
  return ctx?.intercept ?? null
}

/**
 * Call from a route that wants to intercept nav-item clicks. Registers on
 * mount and clears on unmount, so navigating away from the registering route
 * restores default nav behavior for every other `/ops` page sharing this
 * context — the interceptor is never left dangling on a route that no
 * longer wants it.
 */
export function useRegisterNavItemInterceptor(fn: NavItemInterceptor): void {
  const ctx = useContext(NavItemInterceptorContext)
  // Depend on `setIntercept` itself (a stable `useCallback` in the provider),
  // not the whole `ctx` object — `ctx` is re-memoized every time `intercept`
  // changes, and this effect's own cleanup changes `intercept`, so depending
  // on `ctx` re-triggers this same effect every commit: an infinite,
  // synchronous render loop that pegs the CPU with no test output at all.
  const setIntercept = ctx?.setIntercept
  useEffect(() => {
    if (!setIntercept) return undefined
    setIntercept(fn)
    return () => setIntercept(null)
  }, [setIntercept, fn])
}
