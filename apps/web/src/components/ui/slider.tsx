'use client'

import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from '@/lib/utils'

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, 'aria-label': ariaLabel, ...props }, ref) => {
  const thumbs = props.defaultValue ?? props.value ?? []

  // Radix's Root aria-label is not forwarded to each Thumb (the actual
  // role="slider" element axe/screen readers need a name on), so derive a
  // per-thumb label from it instead of leaving Thumbs unnamed.
  function thumbLabel(index: number): string | undefined {
    if (!ariaLabel) return undefined
    if (thumbs.length <= 1) return ariaLabel
    if (index === 0) return `${ariaLabel} minimum`
    if (index === thumbs.length - 1) return `${ariaLabel} maximum`
    return `${ariaLabel} ${index + 1}`
  }

  return (
    <SliderPrimitive.Root
      ref={ref}
      aria-label={ariaLabel}
      className={cn(
        'relative flex w-full touch-none select-none items-center',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-[hsl(var(--border))]">
        <SliderPrimitive.Range className="absolute h-full bg-[hsl(var(--primary))]" />
      </SliderPrimitive.Track>
      {thumbs.map((_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          aria-label={thumbLabel(i)}
          className={cn(
            'block h-4 w-4 rounded-full border border-[hsl(var(--primary))] bg-white shadow',
            'transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        />
      ))}
    </SliderPrimitive.Root>
  )
})
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
