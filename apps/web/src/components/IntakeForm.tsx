'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { IntakeFilters } from '@wivwav/types'
import styles from './IntakeForm.module.css'

const AI_MESSAGE =
  "Tell me what you're looking for — wheelchair type, ramp or lift, budget, and location. I'll set the filters."

const EXAMPLES = [
  'Power wheelchair, rear-entry van with in-floor ramp, used, under $45k in Florida',
  'Side-entry minivan with hand controls for my father, budget around $35k',
  'Lift-equipped full-size van for a manual wheelchair, new or lightly used, Pacific Northwest',
  'Accessible SUV conversion with a side ramp, newer model, anywhere in the Midwest',
]

function buildFilterSearch(filters: IntakeFilters): string {
  const params = new URLSearchParams()
  if (filters.conversionType != null) params.set('conversionType', filters.conversionType)
  if (filters.rampType != null) params.set('rampType', filters.rampType)
  if (filters.hasLift === true) params.set('hasLift', 'true')
  if (filters.handControls === true) params.set('handControls', 'true')
  if (filters.condition != null) params.set('condition', filters.condition)
  if (filters.priceMax != null && filters.priceMax > 0) {
    params.set('priceMax', String(filters.priceMax * 100))
  }
  if (filters.state != null) params.set('state', filters.state)
  return params.toString()
}

export function IntakeForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [aiText, setAiText] = useState('')
  const [aiDone, setAiDone] = useState(false)
  const [animPlaceholder, setAnimPlaceholder] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Type out the AI message on load
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setAiText(AI_MESSAGE)
      setAiDone(true)
      return
    }

    let timer: ReturnType<typeof setTimeout>
    let i = 0

    function tick() {
      i++
      setAiText(AI_MESSAGE.slice(0, i))
      if (i < AI_MESSAGE.length) {
        timer = setTimeout(tick, 22)
      } else {
        setAiDone(true)
      }
    }

    timer = setTimeout(tick, 500)
    return () => clearTimeout(timer)
  }, [])

  // Cycle placeholder examples after the AI message has finished typing
  useEffect(() => {
    if (!aiDone) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setAnimPlaceholder(EXAMPLES[0] ?? '')
      return
    }

    let timer: ReturnType<typeof setTimeout>
    let idx = 0
    let phase: 'typing' | 'deleting' = 'typing'
    let current = ''

    function tick() {
      const target = EXAMPLES[idx] ?? ''
      if (phase === 'typing') {
        current = target.slice(0, current.length + 1)
        setAnimPlaceholder(current)
        if (current.length === target.length) {
          phase = 'deleting'
          timer = setTimeout(tick, 2400)
        } else {
          timer = setTimeout(tick, 32)
        }
      } else {
        current = current.slice(0, -1)
        setAnimPlaceholder(current)
        if (current.length === 0) {
          idx = (idx + 1) % EXAMPLES.length
          phase = 'typing'
          timer = setTimeout(tick, 200)
        } else {
          timer = setTimeout(tick, 16)
        }
      }
    }

    timer = setTimeout(tick, 600)
    return () => clearTimeout(timer)
  }, [aiDone])

  function handleInput() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      e.currentTarget.form?.requestSubmit()
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const description = textareaRef.current?.value.trim() ?? ''
    if (!description) {
      setErrorMsg('Please describe what you need before searching.')
      textareaRef.current?.focus()
      return
    }

    setErrorMsg(null)

    startTransition(async () => {
      try {
        const res = await fetch('/api/intake', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description }),
        })

        if (res.ok) {
          const body = await res.json() as { data?: { filters?: IntakeFilters } }
          const filters = body.data?.filters ?? {}
          const qs = buildFilterSearch(filters)
          router.push(qs ? `/filters?${qs}` : '/filters')
        } else {
          router.push('/filters')
        }
      } catch {
        router.push('/filters')
      }
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Describe your vehicle needs"
      noValidate
      className={styles.form}
    >
      <div className={styles.chatWindow}>

        {/* Chat header */}
        <div className={styles.chatHeader}>
          <span className={styles.chatAvatar} aria-hidden="true">W</span>
          <span className={styles.chatName}>WivWav</span>
          <span className={styles.chatOnline} aria-label="Online" />
        </div>

        {/* AI message */}
        <div className={styles.messages}>
          <div className={styles.aiBubbleRow}>
            <span className={styles.aiBubbleAvatar} aria-hidden="true">W</span>
            <p className={styles.aiBubble}>
              {aiText}
              {!aiDone && <span className={styles.cursor} aria-hidden="true" />}
            </p>
          </div>
        </div>

        {/* Composer */}
        <div className={styles.composer}>
          <label htmlFor="intake-description" className={styles.srOnly}>
            Describe what you need
          </label>
          <textarea
            ref={textareaRef}
            id="intake-description"
            name="description"
            rows={1}
            aria-describedby={errorMsg ? 'intake-error' : undefined}
            aria-invalid={errorMsg != null ? 'true' : undefined}
            className={styles.composerTextarea}
            placeholder={animPlaceholder}
            disabled={isPending}
            maxLength={2000}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
          />
          <button
            type="submit"
            className={styles.sendBtn}
            disabled={isPending}
            aria-label={isPending ? 'Searching…' : 'Send'}
          >
            {isPending ? (
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

        {errorMsg && (
          <p id="intake-error" role="alert" className={styles.error}>
            {errorMsg}
          </p>
        )}
      </div>

      <span className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {isPending ? 'Searching for matching vehicles…' : ' '}
      </span>

      <div className={styles.actions}>
        <a href="/filters" className={styles.skipLink}>
          Skip — search on my own
        </a>
      </div>
    </form>
  )
}
