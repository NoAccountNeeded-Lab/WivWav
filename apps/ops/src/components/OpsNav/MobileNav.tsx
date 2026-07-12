'use client'

import { BottomTabs } from './BottomTabs'
import { MoreSheet } from './MoreSheet'
import { useNavSheet } from './useNavSheet'

/**
 * Below 768px: bottom tab bar + its "More" sheet, wired together so the sheet
 * always returns focus to the tab that opened it.
 */
export function MobileNav() {
  const { isOpen, toggle, close, triggerRef } = useNavSheet<HTMLButtonElement>()

  return (
    <>
      <BottomTabs isMoreOpen={isOpen} onMoreClick={toggle} moreButtonRef={triggerRef} />
      <MoreSheet isOpen={isOpen} onClose={close} triggerRef={triggerRef} />
    </>
  )
}
