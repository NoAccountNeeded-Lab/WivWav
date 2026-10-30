# Brand And UI Guidelines

WivWav is a practical search tool for wheelchair accessible vehicles. The product should feel clear, trustworthy, fast, and calm. It should not feel like a generic car marketplace or a marketing landing page.

## Product Principles

- Search and comparison come first.
- Accessibility is part of the product value, not a compliance add-on.
- Data density is good when it remains scannable.
- Mobile layouts must support real shopping workflows, not just shrink desktop UI.
- Copy should be direct and plain.

## Visual Direction

- Use restrained, high-contrast interfaces.
- Prefer functional layout over decorative sections.
- Use cards only for repeated listings, modals, and framed tools.
- Keep controls familiar: selects, checkboxes, segmented controls, sliders, icon buttons with labels where needed.
- Avoid visual treatments that make information harder to compare.

## Layout Rules

- Listing pages should prioritize filters, map/list context, result count, price, mileage, location, and WAV-specific features.
- Detail pages should prioritize image, price, location, conversion details, access equipment, seller contact, and source link.
- Use full-width sections or constrained content areas; do not nest cards inside cards.
- Every interactive control needs a stable size so labels, hover states, and dynamic values do not shift layout.
- For filter panels, stat tiles, result counts, or comparison views, follow the public data-visualization rules below. This guide is the canonical source; it does not depend on an external `dataviz` skill.

## Accessibility Rules

- Target WCAG 2.1 AA.
- All controls must be reachable and usable by keyboard.
- Focus states must be visible.
- Form controls need programmatic labels.
- Error, loading, empty, and no-results states need readable text.
- Color cannot be the only way to communicate status.
- Maps must not be the only way to access listing locations.

## Public Shopping Data Visualization

Public shopping pages use a fixed palette regardless of season or stored theme preference: deep purple for primary actions and selected values, muted teal for unselected chart data, and neutral page/card surfaces. Use semantic tokens rather than component-level color literals.

Charts must keep selection understandable without color alone. Keep labels and counts available as text, provide keyboard operation and visible focus for interactive marks, and provide a text alternative for maps and other visual summaries. Do not animate chart meaning or selection. Any decorative motion must be subtle, pause in hidden tabs, and respect reduced-motion preferences.

---

## Color System

### Semantic Token Architecture

Themes are defined as a mapping of **semantic tokens → Radix Color scale steps**. Tokens reference step positions, not specific color values. This means swapping the primary scale (e.g. Teal → Orange) cascades through the entire UI automatically.

Every theme must define these semantic tokens:

```css
/* Primary scale — drives interactive elements, chart fills, links */
--color-primary-subtle:   /* step 3  — tinted background, hover states */
--color-primary-ui:       /* step 5  — UI element background */
--color-primary-border:   /* step 7  — borders, dividers */
--color-primary-solid:    /* step 9  — solid fill, chart bars, buttons */
--color-primary-text:     /* step 11 — text on light background */

/* Accent scale — secondary highlights, tags, badges */
--color-accent-subtle:    /* step 3 */
--color-accent-solid:     /* step 9 */
--color-accent-text:      /* step 11 */

/* Neutral scale — always Slate, never changes between themes */
--color-bg:               /* Slate 1  — page background */
--color-surface:          /* Slate 2  — card/section background */
--color-border:           /* Slate 6  — default border */
--color-border-strong:    /* Slate 8  — emphasized border */
--color-text:             /* Slate 12 — body text */
--color-text-secondary:   /* Slate 11 — secondary/muted text */
--color-text-placeholder: /* Slate 9  — placeholder text */
```

Status colors are **fixed across all themes** — never theme-dependent:

```css
--color-success:  /* Green 9  */
--color-warning:  /* Amber 9  */
--color-error:    /* Red 9    */
--color-info:     /* Blue 9   */
```

### Future custom primary color

This token architecture is intentionally compatible with custom primary colors. A user-chosen hue would generate a Radix-compatible 12-step scale (Radix publishes their generation algorithm) and feed into the same semantic slots. Do not hard-code hex values inside components — always use semantic tokens.

---

## Ops Themes

Ops surfaces offer theme families and a light, dark, or system mode. Public shopping pages use the fixed palette above and do not show a theme control.

### Ops theme switching behavior

- The ops picker stores the selected family in `localStorage` key `ops-theme` and the mode (`light`, `dark`, or `system`) in `ops-mode`.
- The ops root uses `data-theme` for the resolved family; its server-rendered default is `grafana` until the picker applies the saved preference.
- Public shopping surfaces ignore obsolete seasonal preferences and always use the fixed public palette.

### Ops theme picker UI

- Offers the supported theme families and light, dark, and system modes.
- Keeps text labels for theme names and modes; do not use color alone to distinguish options.
- Preserve the ops picker’s existing control and persistence behavior when changing public shopping styles.

### Chart fills in themed ops contexts

Ops chart bars and pie slices for **data** use `--color-primary-solid` (step 9) for active/selected and `--color-border` (Slate 6) for dimmed/unselected — never theme accent colors for data, to avoid ambiguity with status colors. Public shopping charts follow the fixed purple/teal palette above.

The **vehicle color picker** filter is a special case: swatches use the actual vehicle color (white, black, silver, red, etc.) with a `--color-border` ring for contrast on light swatches. These are not themed.

---

## Implementation Contract

Before changing user-facing UI, agents and developers should check:

- `docs/BRAND.md`
- `.github/instructions/web-accessibility.instructions.md`
- Existing component styles in `apps/web/src`

If a new UI pattern is introduced, update this file or create a follow-up issue for designer review.
