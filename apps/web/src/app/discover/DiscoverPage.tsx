'use client'

import { Suspense, useEffect, useRef, useState, useId } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { IntakeFilters } from '@wivwav/types'
import { CategoryBarChart } from '@/components/CategoryBarChart'
import { PriceHistogram } from '@/components/PriceHistogram'
import { YearHistogram } from '@/components/YearHistogram'
import { MileageHistogram } from '@/components/MileageHistogram'
import { ActiveFilters } from '@/components/ActiveFilters'
import styles from './DiscoverPage.module.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const OPENING_MESSAGE =
  "Describe what you need — wheelchair type, ramp or lift, budget, location — and I'll set the filters for you."

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'ai' | 'user'
  content: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function filtersToIntakeContext(params: URLSearchParams): string {
  const intakeKeys = ['conversionType', 'rampType', 'hasLift', 'handControls', 'condition', 'priceMax', 'state']
  const active = intakeKeys.filter((k) => params.has(k)).map((k) => `${k}: ${params.get(k)}`)
  if (active.length === 0) return 'No filters currently set.'
  return `Current filters — ${active.join(', ')}.`
}

function fmtDollars(cents: number): string {
  const dollars = Math.floor(cents / 100)
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(0)}k`
  return `$${dollars}`
}

function fmtLabel(key: string, value: string): string {
  if (key === 'priceMax') return `up to ${fmtDollars(parseInt(value, 10))}`
  if (key === 'hasLift') return 'has lift'
  if (key === 'handControls') return 'hand controls'
  return value.replace(/_/g, ' ')
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

// ── Chat panel ────────────────────────────────────────────────────────────────

function DiscoverChat() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isThinking, setIsThinking] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const liveRegionRef = useRef<HTMLDivElement>(null)

  const formId = useId()
  const inputId = `${formId}-input`

  const { displayed: openingText, done: openingDone } = useTypewriter(OPENING_MESSAGE)

  useEffect(() => {
    if (openingDone && liveRegionRef.current) {
      liveRegionRef.current.textContent = OPENING_MESSAGE
    }
  }, [openingDone])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isThinking])

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

    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setIsThinking(true)

    if (liveRegionRef.current) liveRegionRef.current.textContent = 'WivWav is thinking…'

    const description = `${filtersToIntakeContext(searchParams)}\n\nUser: ${text}`

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

        if (Object.keys(newParams).length > 0) {
          const merged = new URLSearchParams(searchParams.toString())
          for (const [k, v] of Object.entries(newParams)) merged.set(k, v)
          router.push(`${pathname}?${merged.toString()}`, { scroll: false })
        }

        let replyText: string
        if (Object.keys(newParams).length === 0) {
          replyText =
            "I didn't catch specific filter values from that — could you add a bit more detail?"
        } else {
          const labels = Object.entries(newParams).map(([k, v]) => fmtLabel(k, v)).join(', ')
          replyText = `Got it! I've set: ${labels}. Use the panels below to refine further, or keep chatting.`
        }

        setMessages((prev) => [...prev, { role: 'ai', content: replyText }])
        if (liveRegionRef.current) liveRegionRef.current.textContent = replyText
      } else {
        const fallback = 'Something went wrong — please try again or use the filter panels.'
        setMessages((prev) => [...prev, { role: 'ai', content: fallback }])
        if (liveRegionRef.current) liveRegionRef.current.textContent = fallback
      }
    } catch {
      const errContent = "Couldn't reach the server. Check your connection and try again."
      setMessages((prev) => [...prev, { role: 'ai', content: errContent }])
      if (liveRegionRef.current) liveRegionRef.current.textContent = errContent
    } finally {
      setIsThinking(false)
    }
  }

  function handleSeeMatches() {
    const qs = searchParams.toString()
    router.push(qs ? `/filters?${qs}` : '/filters')
  }

  return (
    <div className={styles.chatCol}>

      {/* Glass chat card */}
      <div className={styles.chatWindow}>

        {/* Header */}
        <div className={styles.chatHeader}>
          <span className={styles.chatAvatarWrap}>
            <span className={styles.chatAvatar} aria-hidden="true">W</span>
            <span className={styles.chatOnline} aria-label="Online" />
          </span>
          <h1 className={styles.chatHeading}>Find the right accessible vehicle</h1>
        </div>

        {/* Messages */}
        <div
          className={styles.messages}
          role="log"
          aria-label="Conversation"
          aria-live="polite"
        >
          {/* Opening AI message */}
          <div className={styles.messageRow}>
            <span className={styles.messageAvatar} aria-hidden="true">W</span>
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
                <span className={styles.messageAvatar} aria-hidden="true">W</span>
                <p className={styles.aiBubble}>{msg.content}</p>
              </div>
            ),
          )}

          {/* Thinking indicator */}
          {isThinking && (
            <div className={styles.messageRow}>
              <span className={styles.messageAvatar} aria-hidden="true">W</span>
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
          <label htmlFor={inputId} className={styles.srOnly}>Type your reply</label>
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

      </div>

      {/* Active filter pills */}
      <ActiveFilters />

      {/* CTA */}
      <div className={styles.ctaRow}>
        <button
          type="button"
          className={styles.ctaBtn}
          onClick={handleSeeMatches}
        >
          See Matches →
        </button>
        <a href="/filters" className={styles.skipLink}>Browse on my own</a>
      </div>

      {/* SR live region */}
      <div
        ref={liveRegionRef}
        aria-live="polite"
        aria-atomic="true"
        className={styles.srOnly}
      />
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function DiscoverPage() {
  return (
    <div className={styles.page}>

      {/* Chat — full width, centered */}
      <div className={styles.chatRow}>
        <Suspense>
          <DiscoverChat />
        </Suspense>
      </div>

      {/* 3-column filter area below chat */}
      <div className={styles.filterGrid}>

        {/* Col 1: make, model, condition, entry type */}
        <aside aria-label="Filter by vehicle type">
          <Suspense>
            <CategoryBarChart
              showMap={false}
              showHistograms={false}
              limitGroups={['make', 'model', 'condition', 'entry']}
            />
          </Suspense>
        </aside>

        {/* Col 2: color, state, WAV features */}
        <aside aria-label="Filter by feature and location">
          <Suspense>
            <CategoryBarChart
              showMap={false}
              showHistograms={false}
              limitGroups={['color', 'state', 'features']}
            />
          </Suspense>
        </aside>

        {/* Col 3: price, year, mileage histograms */}
        <aside aria-label="Filter by price, year, and mileage">
          <Suspense><PriceHistogram /></Suspense>
          <Suspense><YearHistogram /></Suspense>
          <Suspense><MileageHistogram /></Suspense>
        </aside>

      </div>
    </div>
  )
}
