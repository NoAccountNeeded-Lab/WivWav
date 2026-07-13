import { SiteHeader } from '@wivwav/web'

export function Default() {
  return <SiteHeader />
}

export function WithSection() {
  return <SiteHeader section="Search results" />
}

export function WithListingSection() {
  return <SiteHeader section="2021 Toyota Sienna Autobot VMI" />
}
