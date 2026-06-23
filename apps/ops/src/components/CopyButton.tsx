'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import styles from './CopyButton.module.css'

interface CopyButtonProps {
  text: string
  label?: string | undefined
  className?: string | undefined
}

export function CopyButton({ text, label = 'Copy', className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button
      type="button"
      className={[styles.copyBtn, className].filter(Boolean).join(' ')}
      onClick={handleClick}
      aria-label={copied ? 'Copied!' : label}
      title={copied ? 'Copied!' : label}
      data-copied={copied ? 'true' : 'false'}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}
