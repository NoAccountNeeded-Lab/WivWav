'use client'

import { useCallback, useEffect, useRef, useState, useTransition, useId } from 'react'
import { useRouter } from 'next/navigation'
import type { IntakeFilters } from '@wivwav/types'
import styles from './DiscoverPage.module.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const OPENING_MESSAGE = "Tell me what you're looking for…"

const SESSION_KEY = 'discover:chat-collapsed'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
]

// ── Types ─────────────────────────────────────────────────────────────────────

// Each filter value is a string (query-param style).
// filterSource tracks whether each key was last set by 'ai' or 'manual'.
type FilterSource = 'ai' | 'manual'

// Combined state for filters + sources — updated atomically to avoid stale
// closure bugs when merging AI-returned filters against manual overrides.
interface FilterState {
  filters: Record<string, string>
  sources: Record<string, FilterSource>
}

interface ChatMessage {
  role: 'ai' | 'user'
  content: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFilterSearch(filters: Record<string, string>): string {
  const params = new URLSearchParams(filters)
  return params.toString()
}

function filtersToIntakeContext(filters: Record<string, string>): string {
  if (Object.keys(filters).length === 0) return 'No filters are currently set.'
  const parts = Object.entries(filters).map(([k, v]) => `${k}: ${v}`)
  return `Current filters — ${parts.join(', ')}.`
}

/**
 * Convert AI intake response filters to query-param style strings.
 * NOTE: IntakeFilters.priceMax is in dollars; we store as cents (multiply ×100)
 * so it can be passed directly to /filters?priceMax=<cents>.
 */
function intakeFiltersToParams(intake: IntakeFilters): Record<string, string> {
  const params: Record<string, string> = {}
  if (intake.conversionType != null) params['conversionType'] = intake.conversionType
  if (intake.rampType != null) params['rampType'] = intake.rampType
  if (intake.hasLift === true) params['hasLift'] = 'true'
  if (intake.handControls === true) params['handControls'] = 'true'
  if (intake.condition != null) params['condition'] = intake.condition
  if (intake.priceMax != null && intake.priceMax > 0) {
    params['priceMax'] = String(intake.priceMax * 100)
  }
  if (intake.state != null) params['state'] = intake.state
  return params
}

// ── Pill label formatting ─────────────────────────────────────────────────────

function fmtDollars(cents: number): string {
  const dollars = Math.floor(cents / 100)
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(0)}k`
  return `$${dollars}`
}

function fmtLabel(key: string, value: string): string {
  if (key === 'priceMax') return `Up to ${fmtDollars(parseInt(value, 10))}`
  if (key === 'priceMin') return `From ${fmtDollars(parseInt(value, 10))}`
  if (key === 'hasLift') return 'Has lift'
  if (key === 'handControls') return 'Hand controls'
  if (key === 'mileageMax') return `Under ${parseInt(value, 10).toLocaleString()} mi`
  if (key === 'yearMin') return `${value}+`
  if (key === 'yearMax') return `Up to ${value}`
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function fmtPillAriaLabel(key: string): string {
  const map: Record<string, string> = {
    conversionType: 'Entry type',
    rampType: 'Ramp type',
    hasLift: 'Has lift',
    handControls: 'Hand controls',
    condition: 'Condition',
    priceMax: 'Price',
    priceMin: 'Price',
    state: 'State',
    make: 'Make',
    model: 'Model',
    color: 'Color',
    yearMin: 'Year',
    yearMax: 'Year',
    mileageMax: 'Mileage',
  }
  return `Remove ${(map[key] ?? key).toLowerCase()} filter`
}

// ── Typewriter hook ───────────────────────────────────────────────────────────

function useTypewriter(text: string, delay = 500, speed = 22) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setDisplayed(text)
      setDone(true)
      return
    }

    let timer: ReturnType<typeof setTimeout>
    let i = 0

    function tick() {
      i++
      setDisplayed(text.slice(0, i))
      if (i < text.length) {
        timer = setTimeout(tick, speed)
      } else {
        setDone(true)
      }
    }

    timer = setTimeout(tick, delay)
    return () => clearTimeout(timer)
  }, [text, delay, speed])

  return { displayed, done }
}

// ── Main component ────────────────────────────────────────────────────────────

export function DiscoverPage() {
  const router = useRouter()
  const [, startTransition] = useTransition()

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isThinking, setIsThinking] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)

  // Collapsed state persisted to sessionStorage so it survives navigation
  // within the tab but resets on a new browser session.
  const [chatCollapsed, setChatCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return sessionStorage.getItem(SESSION_KEY) === 'true'
  })

  // Combined filter + source state to avoid stale-closure race conditions
  // when the AI response arrives and we need to check manual overrides.
  const [filterState, setFilterState] = useState<FilterState>({ filters: {}, sources: {} })

  // Manual control mode
  const [manualMode, setManualMode] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const liveRegionRef = useRef<HTMLDivElement>(null)

  const formId = useId()
  const inputId = `${formId}-input`

  // Opening message typewriter
  const { displayed: openingText, done: openingDone } = useTypewriter(OPENING_MESSAGE)

  // Announce the opening message to screen readers once typewriter completes
  useEffect(() => {
    if (openingDone && liveRegionRef.current) {
      liveRegionRef.current.textContent = OPENING_MESSAGE
    }
  }, [openingDone])

  // Scroll to bottom of messages on new message or thinking state change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isThinking])

  // Persist collapsed state to sessionStorage
  const toggleCollapsed = useCallback(() => {
    setChatCollapsed((prev) => {
      const next = !prev
      sessionStorage.setItem(SESSION_KEY, String(next))
      return next
    })
  }, [])

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleTextareaInput() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    setInputValue(el.value)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  async function handleSend() {
    const text = inputValue.trim()
    if (!text) {
      setInputError('Please describe what you need.')
      textareaRef.current?.focus()
      return
    }
    setInputError(null)
    setInputValue('')
    if (textareaRef.current) {
      textareaRef.current.value = ''
      textareaRef.current.style.height = 'auto'
    }

    const userMessage: ChatMessage = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMessage])
    setIsThinking(true)

    // Announce thinking state to screen readers
    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = 'WivWav is thinking…'
    }

    // Capture current filter state snapshot for context building.
    // We read filterState.filters directly here — this is safe because
    // isThinking is set true above, which disables the UI and prevents
    // concurrent manual filter changes.
    const filterContext = filtersToIntakeContext(filterState.filters)
    const description = `${filterContext}\n\nUser: ${text}`

    try {
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      })

      if (res.ok) {
        const body = (await res.json()) as { data?: { filters?: IntakeFilters } }
        const intakeFilters = body.data?.filters ?? {}
        const newParams = intakeFiltersToParams(intakeFilters)

        // Merge atomically: only update keys that were NOT manually set.
        // Both filters and sources are updated in one setState call to
        // avoid stale-closure issues with separate state slices.
        let appliedKeys: string[] = []
        setFilterState((prev) => {
          const nextFilters = { ...prev.filters }
          const nextSources = { ...prev.sources }
          appliedKeys = []
          for (const [k, v] of Object.entries(newParams)) {
            if (prev.sources[k] !== 'manual') {
              nextFilters[k] = v
              nextSources[k] = 'ai'
              appliedKeys.push(k)
            }
          }
          return { filters: nextFilters, sources: nextSources }
        })

        // Build a brief AI reply summarising what changed.
        // Note: appliedKeys is set synchronously inside the setFilterState
        // updater above before this line runs in the same microtask.
        let replyText: string
        if (appliedKeys.length === 0) {
          replyText =
            "I didn't catch specific filter values from that — could you add a bit more detail? You can also adjust the filters below directly."
        } else {
          const labels = appliedKeys.map((k) => fmtLabel(k, newParams[k]!)).join(', ')
          replyText = `Got it! I've set: ${labels}. Adjust anything below or keep chatting.`
        }

        const aiMessage: ChatMessage = { role: 'ai', content: replyText }
        setMessages((prev) => [...prev, aiMessage])

        // Announce AI response to screen readers
        if (liveRegionRef.current) {
          liveRegionRef.current.textContent = replyText
        }
      } else {
        const fallback: ChatMessage = {
          role: 'ai',
          content: 'Something went wrong — please try again or adjust the filters below.',
        }
        setMessages((prev) => [...prev, fallback])
        if (liveRegionRef.current) {
          liveRegionRef.current.textContent = fallback.content
        }
      }
    } catch {
      const errContent = "Couldn't reach the server. Check your connection and try again."
      const errMsg: ChatMessage = { role: 'ai', content: errContent }
      setMessages((prev) => [...prev, errMsg])
      if (liveRegionRef.current) {
        liveRegionRef.current.textContent = errContent
      }
    } finally {
      setIsThinking(false)
    }
  }

  function removeFilter(key: string) {
    setFilterState((prev) => {
      const nextFilters = { ...prev.filters }
      const nextSources = { ...prev.sources }
      delete nextFilters[key]
      delete nextSources[key]
      return { filters: nextFilters, sources: nextSources }
    })
  }

  function clearAllFilters() {
    setFilterState({ filters: {}, sources: {} })
  }

  function setManualFilter(key: string, value: string | null) {
    if (value === null || value === '') {
      removeFilter(key)
      return
    }
    setFilterState((prev) => ({
      filters: { ...prev.filters, [key]: value },
      sources: { ...prev.sources, [key]: 'manual' as FilterSource },
    }))
  }

  function handleSeeMatches() {
    const qs = buildFilterSearch(filterState.filters)
    startTransition(() => {
      router.push(qs ? `/filters?${qs}` : '/filters')
    })
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const { filters, sources } = filterState
  const filterPills = Object.entries(filters).map(([key, value]) => ({
    key,
    label: fmtLabel(key, value),
    ariaLabel: fmtPillAriaLabel(key),
    source: sources[key] ?? 'ai',
  }))

  const hasFilters = filterPills.length > 0

  return (
    <div className={styles.page}>
      <div className={styles.container}>

        {/* ── Chat window ─────────────────────────────────────────────────── */}
        <section
          className={`${styles.chatWindow} ${chatCollapsed ? styles.chatWindowCollapsed : ''}`}
          aria-label="AI assistant chat"
        >
          {/* Chat header */}
          <div className={styles.chatHeader}>
            <span className={styles.chatAvatarWrap}>
              <span className={styles.chatAvatar} aria-hidden="true">W</span>
              <span className={styles.chatOnline} aria-label="Online" />
            </span>
            <h1 className={styles.chatHeading}>
              Find the right accessible vehicle
            </h1>
            <button
              type="button"
              className={styles.collapseBtn}
              onClick={toggleCollapsed}
              aria-expanded={!chatCollapsed}
              aria-controls="chat-body"
              aria-label={chatCollapsed ? 'Expand chat' : 'Collapse chat'}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
                className={chatCollapsed ? styles.chevronDown : styles.chevronUp}
              >
                <path
                  d="M3 10l5-5 5 5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className={styles.collapseBtnLabel}>
                {chatCollapsed ? 'Expand' : 'Collapse'}
              </span>
            </button>
          </div>

          {/* Collapsible body */}
          <div id="chat-body" className={styles.chatBody} hidden={chatCollapsed}>

            {/* Messages */}
            <div
              className={styles.messages}
              role="log"
              aria-label="Conversation"
              aria-live="polite"
            >
              {/* Opening AI message */}
              <div className={styles.messageRow}>
                <span className={styles.messageAvatarSmall} aria-hidden="true">W</span>
                <p className={styles.aiBubble} aria-live="off">
                  {openingText}
                  {!openingDone && <span className={styles.cursor} aria-hidden="true" />}
                </p>
              </div>

              {/* Conversation turns */}
              {messages.map((msg, idx) =>
                msg.role === 'user' ? (
                  <div key={idx} className={`${styles.messageRow} ${styles.messageRowUser}`}>
                    <p className={styles.userBubble}>{msg.content}</p>
                  </div>
                ) : (
                  <div key={idx} className={styles.messageRow}>
                    <span className={styles.messageAvatarSmall} aria-hidden="true">W</span>
                    <p className={styles.aiBubble}>{msg.content}</p>
                  </div>
                ),
              )}

              {/* Thinking indicator */}
              {isThinking && (
                <div className={styles.messageRow}>
                  <span className={styles.messageAvatarSmall} aria-hidden="true">W</span>
                  <div
                    className={styles.thinkingDots}
                    role="status"
                    aria-label="WivWav is thinking"
                  >
                    <span aria-hidden="true" />
                    <span aria-hidden="true" />
                    <span aria-hidden="true" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Composer */}
            <div className={styles.composer}>
              <label htmlFor={inputId} className={styles.srOnly}>
                Type your reply
              </label>
              <textarea
                ref={textareaRef}
                id={inputId}
                rows={2}
                placeholder="Type your reply…"
                className={styles.composerTextarea}
                disabled={isThinking}
                maxLength={2000}
                aria-describedby={inputError ? `${formId}-error` : undefined}
                aria-invalid={inputError != null ? 'true' : undefined}
                onInput={handleTextareaInput}
                onKeyDown={handleKeyDown}
              />
              <button
                type="button"
                className={styles.sendBtn}
                disabled={isThinking}
                aria-label={isThinking ? 'Sending…' : 'Send'}
                onClick={() => void handleSend()}
              >
                {isThinking ? (
                  <span className={styles.spinner} aria-hidden="true" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M2 8h12M9 3l5 5-5 5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            </div>

            {inputError && (
              <p id={`${formId}-error`} role="alert" className={styles.inputError}>
                {inputError}
              </p>
            )}

            {/* Manual mode link (inside chat) */}
            {!manualMode && (
              <div className={styles.manualToggleRow}>
                <button
                  type="button"
                  className={styles.manualToggleBtn}
                  onClick={() => setManualMode(true)}
                >
                  Adjust filters yourself ↓
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ── Active filter bubbles ──────────────────────────────────────── */}
        <section
          aria-label="Active filters"
          className={styles.activeFiltersSection}
        >
          {hasFilters ? (
            <ul
              className={styles.pills}
              role="list"
              aria-live="polite"
              aria-atomic="false"
              aria-relevant="additions removals"
            >
              {filterPills.map((pill) => (
                <li key={pill.key} className={styles.pill}>
                  <span className={styles.pillLabel}>{pill.label}</span>
                  <button
                    type="button"
                    className={styles.pillRemove}
                    aria-label={pill.ariaLabel}
                    onClick={() => removeFilter(pill.key)}
                  >
                    ×
                  </button>
                </li>
              ))}
              {filterPills.length >= 2 && (
                <li>
                  <button
                    type="button"
                    className={`${styles.pill} ${styles.pillClearAll}`}
                    aria-label="Clear all filters"
                    onClick={clearAllFilters}
                  >
                    Clear all ×
                  </button>
                </li>
              )}
            </ul>
          ) : (
            <p className={styles.noFilters}>
              No filters set — chat above or adjust below.
            </p>
          )}
        </section>

        {/* ── Filter controls ────────────────────────────────────────────── */}
        <section
          className={`${styles.filterControls} ${!manualMode ? styles.filterControlsDisabled : ''}`}
          aria-label="Filter controls"
          aria-disabled={!manualMode ? 'true' : undefined}
        >
          <div className={styles.filterGrid}>

            {/* Entry type */}
            <div className={styles.filterField}>
              <label
                htmlFor={`${formId}-conversionType`}
                className={styles.filterLabel}
              >
                Entry type
              </label>
              <select
                id={`${formId}-conversionType`}
                className={styles.filterSelect}
                disabled={!manualMode}
                value={filters['conversionType'] ?? ''}
                onChange={(e) => setManualFilter('conversionType', e.target.value || null)}
              >
                <option value="">Any</option>
                <option value="rear_entry">Rear entry</option>
                <option value="side_entry">Side entry</option>
              </select>
            </div>

            {/* Condition */}
            <div className={styles.filterField}>
              <label
                htmlFor={`${formId}-condition`}
                className={styles.filterLabel}
              >
                Condition
              </label>
              <select
                id={`${formId}-condition`}
                className={styles.filterSelect}
                disabled={!manualMode}
                value={filters['condition'] ?? ''}
                onChange={(e) => setManualFilter('condition', e.target.value || null)}
              >
                <option value="">Any</option>
                <option value="new">New</option>
                <option value="used">Used</option>
                <option value="certified_pre_owned">CPO</option>
              </select>
            </div>

            {/* Ramp type */}
            <div className={styles.filterField}>
              <label
                htmlFor={`${formId}-rampType`}
                className={styles.filterLabel}
              >
                Ramp type
              </label>
              <select
                id={`${formId}-rampType`}
                className={styles.filterSelect}
                disabled={!manualMode}
                value={filters['rampType'] ?? ''}
                onChange={(e) => setManualFilter('rampType', e.target.value || null)}
              >
                <option value="">Any</option>
                <option value="in_floor">In-floor</option>
                <option value="fold_out">Fold-out</option>
                <option value="fold_in">Fold-in</option>
                <option value="none">No ramp</option>
              </select>
            </div>

            {/* State */}
            <div className={styles.filterField}>
              <label
                htmlFor={`${formId}-state`}
                className={styles.filterLabel}
              >
                State
              </label>
              <select
                id={`${formId}-state`}
                className={styles.filterSelect}
                disabled={!manualMode}
                value={filters['state'] ?? ''}
                onChange={(e) => setManualFilter('state', e.target.value || null)}
              >
                <option value="">Any state</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Price min */}
            <div className={styles.filterField}>
              <label
                htmlFor={`${formId}-priceMin`}
                className={styles.filterLabel}
              >
                Min price ($)
              </label>
              <input
                type="number"
                id={`${formId}-priceMin`}
                className={styles.filterInput}
                disabled={!manualMode}
                placeholder="e.g. 20000"
                min={0}
                step={1000}
                value={
                  filters['priceMin'] != null
                    ? String(Math.floor(parseInt(filters['priceMin'], 10) / 100))
                    : ''
                }
                onChange={(e) => {
                  const dollars = parseInt(e.target.value, 10)
                  setManualFilter('priceMin', isNaN(dollars) ? null : String(dollars * 100))
                }}
              />
            </div>

            {/* Price max */}
            <div className={styles.filterField}>
              <label
                htmlFor={`${formId}-priceMax`}
                className={styles.filterLabel}
              >
                Max price ($)
              </label>
              <input
                type="number"
                id={`${formId}-priceMax`}
                className={styles.filterInput}
                disabled={!manualMode}
                placeholder="e.g. 45000"
                min={0}
                step={1000}
                value={
                  filters['priceMax'] != null
                    ? String(Math.floor(parseInt(filters['priceMax'], 10) / 100))
                    : ''
                }
                onChange={(e) => {
                  const dollars = parseInt(e.target.value, 10)
                  setManualFilter('priceMax', isNaN(dollars) ? null : String(dollars * 100))
                }}
              />
            </div>

            {/* Make */}
            <div className={styles.filterField}>
              <label htmlFor={`${formId}-make`} className={styles.filterLabel}>Make</label>
              <input
                type="text"
                id={`${formId}-make`}
                className={styles.filterInput}
                disabled={!manualMode}
                placeholder="e.g. Toyota"
                value={filters['make'] ?? ''}
                onChange={(e) => setManualFilter('make', e.target.value || null)}
              />
            </div>

            {/* Model */}
            <div className={styles.filterField}>
              <label htmlFor={`${formId}-model`} className={styles.filterLabel}>Model</label>
              <input
                type="text"
                id={`${formId}-model`}
                className={styles.filterInput}
                disabled={!manualMode}
                placeholder="e.g. Sienna"
                value={filters['model'] ?? ''}
                onChange={(e) => setManualFilter('model', e.target.value || null)}
              />
            </div>

            {/* Year from */}
            <div className={styles.filterField}>
              <label htmlFor={`${formId}-yearMin`} className={styles.filterLabel}>Year from</label>
              <input
                type="number"
                id={`${formId}-yearMin`}
                className={styles.filterInput}
                disabled={!manualMode}
                placeholder="e.g. 2018"
                min={1990}
                max={2030}
                step={1}
                value={filters['yearMin'] ?? ''}
                onChange={(e) => setManualFilter('yearMin', e.target.value || null)}
              />
            </div>

            {/* Year to */}
            <div className={styles.filterField}>
              <label htmlFor={`${formId}-yearMax`} className={styles.filterLabel}>Year to</label>
              <input
                type="number"
                id={`${formId}-yearMax`}
                className={styles.filterInput}
                disabled={!manualMode}
                placeholder="e.g. 2024"
                min={1990}
                max={2030}
                step={1}
                value={filters['yearMax'] ?? ''}
                onChange={(e) => setManualFilter('yearMax', e.target.value || null)}
              />
            </div>

            {/* Mileage max */}
            <div className={styles.filterField}>
              <label htmlFor={`${formId}-mileageMax`} className={styles.filterLabel}>Max mileage</label>
              <input
                type="number"
                id={`${formId}-mileageMax`}
                className={styles.filterInput}
                disabled={!manualMode}
                placeholder="e.g. 50000"
                min={0}
                step={5000}
                value={filters['mileageMax'] ?? ''}
                onChange={(e) => setManualFilter('mileageMax', e.target.value || null)}
              />
            </div>

            {/* Color */}
            <div className={styles.filterField}>
              <label htmlFor={`${formId}-color`} className={styles.filterLabel}>Color</label>
              <input
                type="text"
                id={`${formId}-color`}
                className={styles.filterInput}
                disabled={!manualMode}
                placeholder="e.g. White"
                value={filters['color'] ?? ''}
                onChange={(e) => setManualFilter('color', e.target.value || null)}
              />
            </div>

          </div>

          {/* Boolean filters */}
          <div className={styles.filterCheckboxRow}>
            <label className={`${styles.filterCheckbox} ${!manualMode ? styles.filterCheckboxDisabled : ''}`}>
              <input
                type="checkbox"
                disabled={!manualMode}
                checked={filters['hasLift'] === 'true'}
                onChange={(e) => setManualFilter('hasLift', e.target.checked ? 'true' : null)}
              />
              Has lift
            </label>
            <label className={`${styles.filterCheckbox} ${!manualMode ? styles.filterCheckboxDisabled : ''}`}>
              <input
                type="checkbox"
                disabled={!manualMode}
                checked={filters['handControls'] === 'true'}
                onChange={(e) => setManualFilter('handControls', e.target.checked ? 'true' : null)}
              />
              Hand controls
            </label>
          </div>

          {/* Take manual control button */}
          {!manualMode && (
            <div className={styles.manualOverlayRow}>
              <button
                type="button"
                className={styles.manualOverlayBtn}
                onClick={() => setManualMode(true)}
                aria-label="Enable manual filter controls"
              >
                Adjust filters yourself
              </button>
            </div>
          )}
        </section>

        {/* ── CTA ───────────────────────────────────────────────────────── */}
        <div className={styles.ctaRow}>
          <button
            type="button"
            className={styles.ctaBtn}
            onClick={handleSeeMatches}
            aria-label={
              hasFilters
                ? 'See matching vehicles with current filters'
                : 'See all vehicles'
            }
          >
            See Matches →
          </button>
        </div>

      </div>

      {/* Screen-reader live region for AI responses and status updates */}
      <div
        ref={liveRegionRef}
        aria-live="polite"
        aria-atomic="true"
        className={styles.srOnly}
      />
    </div>
  )
}
