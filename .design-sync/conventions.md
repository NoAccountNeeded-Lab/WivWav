## Framework assumptions

This library is `apps/web`, a Next.js **App Router** + **next-intl** marketplace app — not a
framework-agnostic component kit. Several components read routing/locale context directly and
will throw if mounted without it:

- **Router-dependent** (call `useRouter`/`usePathname`/`useSearchParams` from `next/navigation`,
  or the app's own `@/navigation` wrapper): `SiteHeader`, `SortSelect`, `ActiveFilters`,
  `PriceHistogram`, `YearHistogram`, `SafetyRefreshButton`, `CategoryBarChart`,
  `MileageHistogram`, `IntakeForm`.
- **Locale-dependent** (call `useLocale`/`useTranslations` from `next-intl`):
  `LanguageSwitcher` (and transitively `SiteHeader`, which renders it).

Build pages containing these inside a real Next.js App Router tree with a `next-intl`
`NextIntlClientProvider` (locale + messages) above them — e.g. the actual `app/[locale]/layout.tsx`
root layout. There is no prop to opt out of this; it's load-bearing, not optional context.

Wrap the page/app root in `ErrorBoundary` (from this library) once, near the top — its default
fallback is a plain accessible "An error occurred" message; pass a custom `fallback` node for a
styled alternative.

## Styling idiom

Styling is **CSS Modules per component** (`<Name>.module.css`, scoped class names) plus a shared
Tailwind v4 token layer defined once in the app's `globals.css` `@theme` block and consumed as
CSS custom properties. Components are pre-styled — you compose them with props/children, you
don't add utility classes to reskin them. When you do need raw layout/utility classes around
components (spacing, flex/grid containers), these are the real design tokens available as
Tailwind theme values / CSS vars — use them over inventing new colors:

- Color: `--color-primary` (#5c35c6), `--color-primary-dark`, `--color-primary-light`,
  `--color-text`, `--color-text-secondary`, `--color-text-muted`, `--color-surface`,
  `--color-border`, `--color-border-strong`, `--color-feature` / `--color-feature-bg` (WAV
  feature badges — kept green regardless of brand primary).
- Radius: `--radius-sm` (6px), `--radius` (14px), `--radius-lg` (20px), `--radius-xl` (28px).
- Type: brand sans stack is `var(--font-sans)` falling back to "Plus Jakarta Sans"; the wordmark
  (`Logo`) uses a separate `var(--font-logo)` / "Raleway" stack — don't mix the two.

## Where the truth lives

- `styles.css` (imports `_ds_bundle.css` + the app's compiled Tailwind/theme layer) is the full
  reachable stylesheet closure — read it before hand-writing any color/spacing value.
- Each component's `.prompt.md` documents its real prop shape from the shipped `.d.ts`.
- Domain content is a wheelchair-accessible-vehicle (WAV) marketplace: listings have a
  conversion brand (BraunAbility, VMI, Rollx Vans, AMS Vans, Freedom Motors, Vantage Mobility),
  entry type (side/rear), and WAV-specific feature flags (lift, hand controls, transfer seat,
  kneel system, lowered floor, power ramp, tie-down system, automatic door, motorized running
  board) — reuse these real vocabulary terms rather than inventing new ones.

## Example composition

```tsx
<ErrorBoundary>
  <DealerCard
    dealer={{ name: 'Meridian Mobility Vans', phone: '(614) 555-0142', website: 'meridianmobilityvans.com' }}
    location={{ city: 'Columbus', state: 'OH', zip: '43215' }}
    sellerType="dealer"
    listingUrl="/vehicle/123"
    priceLabel="$38,900"
  />
</ErrorBoundary>
```
