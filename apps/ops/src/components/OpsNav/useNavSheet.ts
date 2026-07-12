import { useCallback, useRef, useState } from 'react'

/**
 * Open/close state plus a trigger ref for a modal sheet, shared by every nav
 * surface that opens the More sheet (bottom tabs, icon rail).
 */
export function useNavSheet<T extends HTMLElement = HTMLButtonElement>() {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<T>(null)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const toggle = useCallback(() => setIsOpen(current => !current), [])

  return { isOpen, open, close, toggle, triggerRef }
}
