'use client'

// Policy-bearing wrapper around MUI's Link. `href` is required (anchor
// semantics only — this is not a click-handler-only button dressed as a
// link), and `underline` defaults to `hover` so links are visually
// distinguishable from surrounding text without a fixed underline.
//
// Framework routing (e.g. Next.js `<Link>`'s client-side navigation) stays
// the consuming app's responsibility: pass a routed anchor component via
// MUI's `component` prop from `apps/web`/`apps/ops` rather than this
// package importing `next/link`, which would break the mobile seam
// documented in docs/design/ui-boundary-and-ops-workspace.md section 1.
import * as React from 'react'
import MuiLink from '@mui/material/Link'
import type { LinkProps as MuiLinkProps } from '@mui/material/Link'

export interface LinkProps extends MuiLinkProps {
  href: string
}

export const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { underline = 'hover', ...rest },
  ref,
) {
  return <MuiLink ref={ref} underline={underline} {...rest} />
})
