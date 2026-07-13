import { ConditionalFooter } from '@wivwav/web'

// ConditionalFooter takes no props — it renders <Footer /> unless the
// current pathname matches /vehicle/:id, hiding the marketing footer on
// vehicle detail pages. usePathname() returns null in this harness (no
// AppRouterContext/PathnameContext provider is mounted), and the component's
// regex test against null pathname doesn't match /vehicle/, so it always
// renders the footer here — which is also its real default behavior on
// every non-detail page (home, search results, etc).
export function Default() {
  return (
    <div style={{ background: '#f9fafb', paddingTop: 40 }}>
      <ConditionalFooter />
    </div>
  )
}
