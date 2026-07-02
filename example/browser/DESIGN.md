# Nexus v2 Browser Example — Design System

A clean, blueprint-style design built on flat surfaces, neutral ink scale, and a single blue accent. No rainbow gradients, no decorative orbs. The CTA is a single bold pill in `ink-900` (black in light, white in dark).

Every visual decision flows from CSS custom properties defined at the top of `src/App.css`. Components consume semantic tokens; primitives change in one place and the rest of the app re-skins.

---

## Token architecture

Three layers, top to bottom in `App.css`:

1. **Nexus primitives** — raw hex values. Prefix `--nexus-*`. The only place hex literals live.
2. **Semantic tokens** — what components actually consume (`--text`, `--bg`, `--panel`, `--accent`, `--cta-bg`, `--radius-md`, etc.). Defined in `:root` for dark, overridden in `:root[data-theme="light"]` for light.
3. **Component styles** — only read semantic tokens. Never reference `--nexus-*` directly.

The three legacy palette selectors (`charm`/`ocean`/`ember`) all resolve to the same Nexus primitives. The switcher in the topbar stays functional but is visually a no-op — kept so we don't break the UI affordance.

---

## Color tokens

### Nexus primitives (single source of truth)

**Ink — neutral text and borders**

| Token | Hex | Usage |
|---|---|---|
| `--nexus-ink-900` | `#1A1A15` | Primary text, black CTA bg (light mode) |
| `--nexus-ink-800` | `#1F1F1F` | CTA hover (light mode) |
| `--nexus-ink-600` | `#585B5A` | Muted text, captions |
| `--nexus-ink-500` | `#6B6B66` | Mid grey |
| `--nexus-ink-400` | `#8E8E89` | Subtle hint text |
| `--nexus-ink-300` | `#C9C9C5` | Disabled, dim borders |

**Blue — the only action color**

| Token | Hex | Usage |
|---|---|---|
| `--nexus-blue-700` | `#0068F4` | Darker blue — hover state on light bg, `--accent-light` in light mode |
| `--nexus-blue-500` | `#1078FF` | Action blue — links, focus ring, `--primary` / `--accent` |
| `--nexus-blue-100` | `#EAF1FF` | Tint backgrounds, active dropdown bg |
| `--nexus-blue-50`  | `#E5EEFF` | Softest tint |
| `--nexus-blue-tab` | `#F0F3F9` | Tab bar inactive background |

**Surface — backgrounds and borders**

| Token | Hex | Usage |
|---|---|---|
| `--nexus-surface-default` | `#FFFFFE` | Card / panel background |
| `--nexus-surface-soft`    | `#FAFAFC` | Page background |
| `--nexus-surface-cool`    | `#F6F6F6` | Nested panel, secondary surface |
| `--nexus-border`          | `#ECECEA` | Standard divider |
| `--nexus-border-2`        | `#E8E8E7` | Stronger divider |

**Status**

| Token | Hex | Usage |
|---|---|---|
| `--nexus-success`    | `#18C57A` | Confirmed, complete |
| `--nexus-success-bg` | `#E5F7EE` | Success tint background |
| `--nexus-danger`     | `#DC2626` | Failed, insufficient, destructive |
| `--nexus-danger-bg`  | `#FEE7E7` | Danger tint background |
| `--nexus-warning`    | `#F59E0B` | Caution, pending |
| `--nexus-warning-bg` | `#FEF3C7` | Warning tint background |

### Semantic tokens

| Token | Role | Light value | Dark value |
|---|---|---|---|
| `--bg` | Page background | `--nexus-surface-soft` | `#0E0E0E` |
| `--shell` | Frosted overlay | `rgba(255,255,254,.96)` | `rgba(26,26,21,.96)` |
| `--panel` | Card surface | `--nexus-surface-default` | `#18181A` |
| `--panel-2` | Nested card surface | `--nexus-surface-cool` | `#1F1F22` |
| `--line` | Standard border | `--nexus-border` | `rgba(255,255,255,.08)` |
| `--line-strong` | Stronger border | `--nexus-border-2` | `rgba(255,255,255,.14)` |
| `--text` | Primary text | `--nexus-ink-900` | `#FAFAFC` |
| `--muted` | Secondary text | `--nexus-ink-600` | `#8E8E89` |
| `--primary` | Action color | `--nexus-blue-500` | `--nexus-blue-500` |
| `--primary-light` | Hover/contrast variant | `--nexus-blue-700` (darker) | `--nexus-blue-100` (paler) |
| `--primary-soft` | Tinted bg | `--nexus-blue-100` | `rgba(16,120,255,.16)` |
| `--accent` | Same as primary in Nexus | `--nexus-blue-500` | `--nexus-blue-500` |
| `--accent-light` | Inverts per mode | `--nexus-blue-700` | `--nexus-blue-100` |
| `--success` / `--danger` / `--warning` | Status | direct nexus-* | direct nexus-* |
| `--success-soft` | Success tint bg (banner, toast) | `--nexus-success-bg` | `rgba(24,197,122,.18)` |
| `--danger-soft` | Danger tint bg (banner, toast) | `--nexus-danger-bg` | `rgba(220,38,38,.18)` |
| `--warning-soft` | Warning tint bg | `--nexus-warning-bg` | `rgba(245,158,11,.16)` |
| `--cta-bg` | Primary button bg | `--nexus-ink-900` (black) | `#FFFFFE` (white) |
| `--cta-bg-hover` | CTA hover | `--nexus-ink-800` | `#F0F0F0` |
| `--cta-text` | Primary button label | `#FFFFFE` | `--nexus-ink-900` |
| `--cta-shadow` | Primary button drop shadow | `0 6px 16px rgba(26,26,21,.18), 0 1px 3px rgba(26,26,21,.08)` | `0 4px 14px rgba(0,0,0,.45), 0 1px 3px rgba(0,0,0,.3)` |
| `--shadow` | Card elevation | `0 8px 28px rgba(26,26,21,.06)` | `0 12px 36px rgba(0,0,0,.45)` |

**Note on `*-light` tokens:** in dark mode these go paler (lighter than `--accent`) so action elements pop against dark surfaces. In light mode they invert to *darker* (`--nexus-blue-700`) so the same elements remain legible against light surfaces. This is a deliberate inversion — `light` here refers to "the contrast partner of accent", not "lighter in lightness."

---

## Typography

Three font families, all already loaded via `@fontsource` packages in `package.json`:

| Token | Family | Use |
|---|---|---|
| `--font-display` | **Space Grotesk Variable** | Hero numbers, large headings — the "Delight" role from the Nexus design spec |
| `--font-sans` | **Geist Variable** | Default body, UI labels, form copy |
| `--font-mono` | **Geist Mono** | Code, hex addresses, technical values |

Base size on `:root` is `15px`, line-height `1.5`, font smoothing antialiased.

### Type scale

| Token | Size | Role |
|---|---|---|
| `--text-2xs` | 11px (0.6875rem) | Label caps (`SEND · RECEIVE · TOTAL`, uppercase) |
| `--text-xs`  | 12px | Caption, balance hint |
| `--text-sm`  | 13px | Compact body |
| `--text-base`| 14px | Default body small |
| `--text-md`  | 15px | Default body |
| `--text-lg`  | 16px | Default body large |
| `--text-xl`  | 18px | Subheading |
| `--text-2xl` | 22px | Panel heading ("Swap") |
| `--text-3xl` | 30px | Section title ("Confirm swap") |
| `--text-4xl` | 48px | Hero amount (`499.50`) |

### Leading & tracking

| Token | Value | Use |
|---|---|---|
| `--leading-tight`  | 1.25 | Display |
| `--leading-snug`   | 1.375 | Headings |
| `--leading-normal` | 1.5 | Body (default) |
| `--tracking-normal` | 0 | Default |
| `--tracking-wide`  | 0.05em | Uppercase labels |

---

## Radius

| Token | Value | Use |
|---|---|---|
| `--radius-xs`  | 6px | Chips, small pills |
| `--radius-sm`  | 8px | Inputs, dropdown items |
| `--radius-md`  | 12px | Buttons (rectangular), small cards |
| `--radius-lg`  | 16px | Standard cards, modals |
| `--radius-xl`  | 20px | Hero card, topbar, large panels |
| `--radius-pill` | 9999px | Pill buttons (primary CTA), badges |

---

## Light vs dark mode

The canonical Nexus experience is **light** — it matches the design source files. Dark is derived.

**Derivation rules for dark mode:**

- Surfaces invert: page bg goes near-black (`#0E0E0E`), panels lift to `#18181A` / `#1F1F22`
- Text inverts: `#1A1A15` → `#FAFAFC`
- Lines become semi-transparent white (`rgba(255,255,255,.08–.14)`)
- Blue accent stays the same — `#1078FF` reads well on both
- `--accent-light` flips meaning (darker in light, paler in dark) for contrast against the surface
- CTA inverts color: black pill → white pill (with `--nexus-ink-900` text inferred from the contrast direction)
- Status colors (success/danger/warning) stay the same hex — they read on both backgrounds

When introducing new tokens, define the value in `:root` (the dark default) and override in `:root[data-theme="light"]` only when the light value materially differs. Don't duplicate.

---

## Component patterns

These are derived from current `App.css`. When adding new components, follow the same conventions.

### Buttons

- **Primary CTA** (`.primary-button`, `.intent-button-primary`) — filled `--cta-bg` (black in light, white in dark), rounded `--radius-md`, drop shadow `--cta-shadow`. Hover only changes `background` to `--cta-bg-hover` — no scale, no shadow change. There is one primary CTA per screen — no exceptions.
- **Secondary** (`.intent-button-secondary`) — outlined `--line-strong`, transparent bg, `--text` color.
- **Ghost** (`.ghost-button`) — circular, 30×30, transparent base, `--muted` color, `--line-strong` border. Used for the X close on modals (intent, progress success, source/destination pickers). Hover: `--accent-light` text, accent-tinted bg (`--primary-soft`), accent-tinted border. No scale transform — Nexus hovers are color-only.
- **Network toggle** — extends ghost, uppercase, `aria-pressed="false"` dims to opacity 0.55.

### Cards

- **Hero card** (`.hero-card`) — `--panel-2` bg, `--line-strong` border all sides (no left accent), `--radius-xl`, padding 24px. The left accent stripe used in the old design has been removed.
- **Funding card** (`.funding-card`) — two-column source → destination layout, source column tinted with `--primary-soft`, destination with `--accent-soft`.
- **Modal panel** (`.modal-panel`) — `--panel` bg, `--radius-lg`, `--shadow`. Title is flat `var(--text)` — no shimmer or gradient animation.
- **Modal header** (`.modal-header`) — `padding: 16px 16px 8px`. No `border-bottom` and no gradient — the body card carries its own border so a divider here would double up. Title on the left, ghost-button (X close) on the right.

### Inputs

- `--panel` background, `--line` border, `--radius-md`, padding `8px 12px`.
- Focus: 2px solid `--accent` outline with 2px offset (from `:focus-visible` global).
- Label sits above, color `--muted`, size `--text-base`, uppercase tracking-wide if it's a label-cap.

### Dropdowns

- Trigger looks like an input.
- Menu (`.dropdown-menu`) uses `--panel` bg, `--line-strong` border, `--radius-md`, backdrop blur, custom shadow.
- Items default to `--muted` color. Hover/focused fades in a subtle bg tint and shifts color to `--text`. No translate or slide — Nexus hovers are color-only.
- Active item gets `--primary-soft` bg and `--accent-light` text (in light mode this is `--nexus-blue-700`, visible; in dark this is `--nexus-blue-100`, also visible).

### Pills & badges

- `.meta-pill` — rounded 999px, soft accent tint background, accent-colored text/border.
- Variants by status: `--queued` (muted), `--running` (accent + pulsing dot), `--approved` / `--signed` / `--deposited` (accent shades), `--fulfilled` (success), `--failed` (danger), `--warning` (warning). All derive from semantic tokens — adding a new variant means adding a new semantic color, not a new hex.

### Receive card

The amount-input + destination-pill composition used by every operation tab.

- `.receive-card` — bordered rounded card (`--radius-lg`, `--panel` bg, subtle 1px shadow).
- `.receive-label` — small uppercase muted label at the top (e.g. "Receive amount" / "Deposit amount").
- `.receive-row` — horizontal flex row containing the amount input (left, flex:1) and a `<DestinationSelector>` pill (right, fixed width).
- `.receive-amount` — borderless transparent `<input>` with `--font-display` Space Grotesk at 2rem (32px), tabular numerics. Placeholder is `--nexus-ink-300` so the slot reads as empty without competing for attention.
- `.receive-hint` — muted footer line with the "Balance · X SYMBOL" link / max-calc state.
- `.recipient-section` (bridge tab only) — appears at the bottom of the card with a 1px top divider. RECIPIENT label + a `<RecipientInput>` row. Default state shows the truncated address (via `shortAddress()`) and an `Edit` pill button on the right; clicking Edit swaps the row to an inline `<input>` with Save / Cancel pill buttons. Empty value falls back to the connected wallet address. Validates against the `0x[40 hex]` shape; invalid drafts disable Save and tint the input border with `--danger`.

The card matches the "RECEIVE" panel in the Nexus design — large amount on the left, compact token pill on the right, balance hint below, and (for bridge) a recipient row at the bottom of the same card.

### Banners & toasts

Same idiom for both inline status banners (e.g. "Need $760 more across your assets") and Sonner toast notifications:

- **Default**: `--panel` bg, `--line` border, `--text` color, `--shadow`, `--radius-md`.
- **Success**: `background: var(--success-soft)`. Icon color `var(--success)`. Text stays `--text` — let the tint do the signaling.
- **Error**: `background: var(--danger-soft)`. Icon color `var(--danger)`. Same neutral text.
- **No left-accent stripe, no colored glow shadow** — those belong to the old design language. Status is carried by the soft background tint and the icon color.

Toast targets are `[data-sonner-toast]`, `.toast-success`, `.toast-error`. Sonner's classNames are wired in `App.tsx` (`success: "toast-success"`, `error: "toast-error"`).

### Picker search bar

Source picker and destination picker share a `<PickerSearch>` component (`components/PickerSearch.tsx`) — single rounded-`--radius-lg` pill containing: magnifying-glass icon · borderless text input · inner chain-filter pill on the right. Background is `--panel-2`, border `--line`, focus-within highlights with `--accent`. Horizontal margin matches `.modal-body` (24px) so the bar's edges align with the `.src-list` below.

The chain-filter pill shows either the selected chain's logo + name, or a globe icon + "All chains" when no filter is set. Clicking it switches the modal to a **chain picker sub-view** (see below). The pill is hidden when there's only one chain.

Live filtering uses the shared `matchesQuery(query, ...fields)` helper — case-insensitive substring across token symbol, chain name, and contract address — so typing a chain name narrows the list just like typing a symbol.

- Both modals reset `query`, `chainFilter`, and `view` to defaults when the dialog opens.
- Source picker filters at the `SourceOption` level inside each `TokenGroup`, then recomputes `totalFiat` / `totalBalance` so the group header reflects only the visible chains.
- Destination picker filters the flat `DestinationOption[]` list.
- Empty filtered state renders `<p class="picker-empty">No matches for current filters.</p>`.

### Chain picker sub-view

Both source and destination modals can swap their content into a `<ChainPickerView>` when the user clicks the chain-filter pill. The sub-view replaces the main content within the same modal panel — not a nested dialog.

- **Header**: back button (`<` icon) + "Select chain" + close X. Back returns to the main view without changing the filter; close dismisses the whole modal.
- **Search**: same `.picker-search` pill, autofocused, placeholder "Search chains". Matches against chain name and chain id.
- **List**: each row is a `<button class="chain-row">` with a `<RadioDot>`, chain logo (or globe icon for "All Chains"), and the chain name. Selected row's radio fills with accent. Rows separated by 1px dividers inside the rounded list.
- **No footer in this sub-view** — clicking a chain row immediately calls `onApply(chainId)` which sets the chain filter and switches `view` back to `"main"`. The parent modal's "Done (N)" CTA still confirms the token selection; we don't want two Done buttons.
- The "All Chains" row uses `chain-row-icon--all` (muted background, globe SVG); regular chain rows use the same `<ChainLogo>` helper that the search bar uses, falling back to a letter circle on broken image.

### Asset rows (shared primitive)

The source picker, balances modal, and any future token/chain list share a single row composition built from `AssetRow.tsx`:

| Sub-component | Renders | Class |
|---|---|---|
| `<AssetRowIcon>` | Token/chain logo (or letter-circle fallback on missing/broken `src`) | `.asset-row-icon` (36px), `.asset-row-icon--sm` (24px) |
| `<AssetRowMeta>` | Symbol (top, bold) + optional sub-line (bottom, muted) | `.asset-row-meta`, `.asset-row-symbol`, `.asset-row-sub` |
| `<AssetRowValue>` | Amount (top, bold) + optional USD (bottom, muted) | `.asset-row-value`, `.asset-row-amount`, `.asset-row-usd` |
| `<ChainDots>` | Up to N overlapping small chain logos with broken-image fallback | `.chain-dots`, `.chain-dot`, `.chain-dot-letter` |
| `<ChevronIcon>` | Expand/collapse chevron (non-interactive wrapper) | `.asset-row-chevron` |
| `<CopyButton>` | Inline icon-only button — copies a value to clipboard, swaps to checkmark for 1.5s. Stops click propagation so it can nest inside a clickable row. | `.copy-btn`, `.copy-btn--copied` |
| `<InfoIcon>` | Standalone `ⓘ` SVG used as the trigger for `<TokenInfoCard>` | `.asset-row-info` (the wrapper span) |
| `shortAddress(addr)` | `0xabcdef…1234` helper for truncated address display | — |

**Image-fallback rule:** all `<img>` rendered by these components go through the `<LogoImg src fallback>` helper in `AssetRow.tsx`. On missing/broken `src` (broken URL or onError) it swaps to the SDK-generated SVG data URI from `getFallbackTokenLogoDataUri(fallback)` — a circular gradient with the symbol's first character (or up to 3 chars), deterministic per symbol. The image is always a valid loadable URL, so the UI never shows a broken-image placeholder. Letter-span fallbacks (`.src-token-dot`, `.chain-row-letter`, etc.) have been removed.

The container is `.asset-row`. Two layout modes:

- **Group row** (default `.asset-row`): 36px icon, `--text-lg` symbol + amount. The whole row is one click target — use a `<button class="asset-row">` when the entire row triggers expand.
- **Chain row** (`.asset-row--chain`): 24px icon, indented padding-left (~48px), `--text-base` symbol + amount. Use `.asset-row--static` to mark non-interactive.

`.asset-row:hover:not(.asset-row--static)` tints the row with `var(--primary-soft)` so clickable rows have visible hover feedback.

When a checkbox needs to sit outside the click target (source picker group row), use a `<div class="asset-row">` with the checkbox + an inner `<button class="asset-row-toggle">` wrapping the rest. The toggle button picks up `flex: 1` and acts as the row's interactive area. **Never apply `.asset-row-toggle` to a button that already has `.asset-row`** — its `padding: 0` would override the row padding.

**USD display rule** — show the `≈$USD` line on **group rows only**, not on chain breakdown rows. Chain rows show the balance amount alone. This matches the source-picker design and keeps visual hierarchy clear.

**Sub-line rule** — when a token has only one chain, the sub-line shows the chain *name* (`<ChainDots max={1}/> Optimism`). When it has multiple chains, it shows the count (`<ChainDots/> 3 chains`).

### Token-list container

The list inside source picker and balances modal is **one rounded card with internal dividers**, not separate per-token cards.

- `.src-list` is the outer container: `border: 1px solid var(--line)`, `--radius-lg`, `var(--panel)` bg, `overflow: hidden`, plus `box-shadow: 0 4px 14px rgba(26,26,21,0.05)` for subtle elevation.
- `.src-group` is a section inside — no border, no radius, no shadow of its own.
- `.src-group + .src-group` adds a `border-top: 1px solid var(--line)` divider between adjacent groups.
- `.src-group-body` (the expanded chain breakdown) keeps `--panel-2` background + `border-top` to distinguish it from the group header above.

### Source picker

Two-component pattern, sources grouped by **token symbol**. The SDK returns `TokenBalance[]` already keyed by token; `flattenBalances` propagates `asset.logo` → `SourceOption.tokenLogo` so the picker can show real token icons (with letter-circle fallback for missing/broken logos).

- **`SourceSelector`** (the field) — a `.src-trigger` button that renders summary pills (`.src-pill`, one per selected token: letter circle + symbol + chain count) and an "Edit" affordance (`.src-trigger-edit`). Click opens the modal.
- **`SourceSelectorModal`** (the picker) — Radix dialog with a two-zone header:
  - `.src-modal-title` (left) stacks `<Dialog.Title class="modal-title">` (sized up via `.src-modal-header .modal-title` to `font-weight: 700` / `--text-lg`) over `.src-modal-subtitle` (muted, `--text-xs`).
  - Close X (right) is a `Dialog.Close` button.
- **Summary row** (`.src-summary`) shows "N of M selected · $total" with Select all / Clear actions.
- **Footer** is a **single full-width** `.primary-button` reading "Done (N)" — no Cancel button. Cancel is done by the close X.
- **Chain row sub-line** — chain name + `<CopyButton>` (copies the token's contract address on that chain) + `<InfoIcon>` (opens `<TokenInfoCard>`). Copy always sits before info.
- **Group ordering snapshots on open** — groups containing already-selected items come first, then the rest by fiat. Order doesn't reshuffle while toggling.
- **"Select all" applies as `[]`** — empty array means "no filter, use all sources" at the SDK layer. The trigger then renders the "All sources" placeholder.

### Balances modal

Read-only twin of the source picker. Reuses the same row primitive and `.src-list` container.

- `.bal-modal-panel` is just `max-width: 480px` — borders and shadow inherit from `.modal-panel`.
- Header uses `.src-modal-header` with title ("Balances") + subtitle ("Your cross-chain portfolio"). `.modal-header-actions` holds the refresh + close buttons on the right.
- `.src-summary` row shows "Portfolio" label + total fiat (no select-all/clear; data is read-only).
- Each asset is a `<button class="asset-row">` (whole-row click toggles expand). Expanded body has `.asset-row--chain.asset-row--static` rows (no click target, no USD on chain rows).
- **No footer CTA** — closing is via the X icon.

The checkbox primitive (`.checkbox`) has three states: default, `.checked` (blue fill, white tick centered via `translate(-50%,-50%) rotate(45deg)`), `.indeterminate` (blue fill, horizontal line centered the same way). All three use semantic tokens.

### Destination selector

Single-select picker used by every operation tab (Exact Out Swap, Swap & Execute, Bridge, Bridge & Execute). Replaces the previous pair of chain + token dropdowns.

- **`DestinationSelector`** is composed in `OperationPage` from `form.chainOptions` × `config.getTokenOptions(client, chainId)` — flattened into a `DestinationOption[]`. Each option has `chainId`, `chainName`, `chainLogo?`, `symbol`, `label`, `tokenLogo?`, `tokenAddress?`, `decimals?`.
- **Trigger** (`.dest-trigger`) — a **compact pill** with the token icon (chain badge in lower-right), the token symbol, and a small chevron. No "on Chain" sub-line — the chain is communicated via the badge overlay. Inline-flex, rounded `--radius-pill`, fits inside a row alongside other content like an amount input.
- **Modal** uses the same `.modal-panel` / `.src-modal-header` / `.src-list` chrome as the source picker. Title is "Choose asset to receive", subtitle "Select token and destination chain".
- **Flat list, single-select** — each row is one `(token, chain)` combo. Clicking a row calls `onSelect(option)` and closes the modal (no Apply button; no checkbox). The selected row gets `.src-group.is-open` styling.
- **Held-balance display** — pass `balances={...flattened SourceOption[]}` (typically `flattenBalances(form.balancesQuery.data)`) and the modal renders `<AssetRowValue>` on rows where the user owns that exact `(chainId, tokenAddress)`. Rows with no held balance just show the symbol + chain — the value column is omitted, not zeroed.
- **Row sub-line** — for tokens with a real contract address, the sub-line shows `shortAddress · <CopyButton> · <InfoIcon>` (copy button always sits **before** the info icon). For native tokens (zero address) the sub-line is just `on Chain`, with no copy or info icons. The info icon wraps the `<TokenInfoCard>` hover trigger.
- **Layout host** — `OperationPage` wraps the amount input + destination pill in a `.receive-card` so they sit side-by-side with a shared label and balance hint, matching the Nexus RECEIVE pattern.
- **Logos** are populated via `lib/logos.ts`. Three-tier lookup:
  1. **`availproject/nexus-assets`** by symbol (USDC, USDT, ETH, BNB, POL, AVAX, native chain coins). Branded, curated, static URLs. Slug maps live in `lib/logos.ts` and were generated from `chains/_index.json` and `tokens/_index.json` in the asset repo.
  2. **`lib/token-logos.json`** by `(chainId, lowercase-address)`. ~875 KB static snapshot of the LI.FI tokens endpoint (`https://li.quest/v1/tokens?chainTypes=EVM`), filtered to ~13 supported chains and ~5k tokens that have a `logoURI`. **Do not fetch at runtime** — regenerate the file with the `jq` pipeline documented at the top of `lib/logos.ts` when the registry needs an update.
  3. **1inch CDN** (`https://tokens.1inch.io/{lowercase-address}.png`) for any ERC20 not in the first two sources.
  - All URLs go through `useImageOk` so a 404 / failed load gracefully falls back to a letter circle.
  - `tsconfig.json` includes `"resolveJsonModule": true` so the static map imports cleanly.
- **Chain badge overlay** — `<AssetRowIcon badge={{ src, fallback }}>` renders a small (16px / 12px in `--sm`) chain logo in the bottom-right of the token icon (`.asset-row-icon-badge`). Lets one glance read both "what token" and "on what chain".
- **Per-row hover** uses the same `TokenInfoCard` — InfoIcon next to the token label opens a popover with symbol / chain / decimals / contract address.

### Token info hover card

Reusable Radix `HoverCard` that wraps any token+chain row and surfaces full metadata on hover. Used by source picker and balances modal today; reusable for a future destination picker.

- Component: `<TokenInfoCard token={{ symbol, tokenName?, tokenLogo?, chainName, chainLogo?, decimals?, contractAddress }}>{children}</TokenInfoCard>`.
- Internally wraps `children` with `HoverCard.Trigger asChild`; child must be a single focusable element (button, or `<div tabIndex={0}>` for read-only rows).
- Card content (`.token-info-card`): header with token icon + full name + "on Chain", divider, then a `<dl>` of Symbol / Name / Chain / Decimals / Contract address. Address is truncated to `0x1234…abcd` in a `<code>` chip with full address in `title` for hover-reveal of the full string.
- Optional fields (`tokenName`, `decimals`) are only rendered when present. Address always shown.
- `openDelay` defaults to 300ms (avoids accidental flashes); `closeDelay` 100ms.
- `side="right"` by default with `collisionPadding: 16` — flips automatically when near viewport edges.

Data plumbing:
- `flattenBalances` (in `lib/nexus.ts`) propagates `asset.name` → `SourceOption.tokenName` and `entry.decimals` → `SourceOption.decimals` so the source picker can populate the card.
- `BalancesModal` reads the same fields directly off the `TokenBalance` it already receives.

Animation: `token-info-in` (140ms ease-out fade + 2px translate). No spring, no shimmer — matches Nexus's quiet motion vocabulary.

### Flow modal (unified intent → progress → success / failure)

`src/components/FlowModal.tsx` owns a **single** Radix Dialog that hosts every phase of an operation — `intent` → `executing` → `completed` / `failed`. There is no longer a separate Intent modal and Progress modal; the Dialog stays mounted across phases and the inner content cross-fades.

`OperationPage` renders one `<FlowModal>` per tab; `App.tsx` no longer renders any modals directly. The Ctrl+Shift+K / J debug preview drives `FlowModal` with a mock `progressState` (intent stubbed to `null`).

**Panel shape (`.flow-modal-panel`):** 420 px max-width, `min(820px, calc(100vh - 32px))` max-height, `background: var(--panel-2)` (gray). The CSS block sits *after* `.modal-panel` in source order so single-class overrides win on the cascade — no specificity hacks. `display`, `flex`, border, radius, shadow, and the `modal-in` entrance animation inherit from `.modal-panel`. `position` is left to `.modal-content-centered`.

**Phase derivation** (in `FlowModal`):
- `progressState.phase === "completed"` → `completed`
- `progressState.phase === "failed"` → `failed`
- `progressState.phase === "executing"` → `executing`
- `pendingTransition && progressState !== null` → `executing` (bridges the brief gap between user-clicked-Confirm and the SDK actually moving to `executing` — set true on Confirm, cleared when `progressState.phase` catches up)
- `intentPending` → `intent`
- otherwise → `null` (modal closed)

**Visibility latch** — once a non-null phase is observed, `isOpen` is held true until the user explicitly dismisses (X / Esc / outside-click / Done) or the intent is denied (intent was pending, now neither pending nor approved, and no progress). This prevents the modal from closing for a frame during the intent → executing transition.

**Cross-fade** — `displayPhase` lags behind `phase` by ~180 ms via a `fadingOut` state machine: on phase change, `.flow-modal-body--fading` and `.flow-modal-footer--fading` set `opacity: 0` over a 180 ms transition; after the timeout, `displayPhase` is swapped and the fade-out class is removed, so the new content fades in over another 180 ms. The content swap happens during peak invisibility, so any height change is hidden. `.flow-modal-panel` also has `transition: height 200ms ease, max-height 200ms ease` so size changes are smooth. First content arrival skips the fade-out leg (no prior visible content to hide); `phase === null` skips the cross-fade so dismissal is instant.

**Header (`.flow-modal-header`)** — title bar always visible. Title swaps per phase:
- `intent` → `Confirm <Op>` (e.g. "Confirm Swap")
- `executing` → `<Op>`
- `completed` → `<Op> Complete`
- `failed` → `<Op>`

Plus a `.intent-refresh-pill` (pulsing accent dot + label) next to the title during the intent phase, and a circular ghost X close (only when dismissable — intent / completed / failed; not during executing).

**Footer** — phase-specific button (cross-fades alongside the body):
- `intent` → full-width black `Confirm` pill (`.intent-button.intent-button-primary`).
- `executing` → empty (no footer).
- `completed` → full-width black `Done` pill (`.exec-dismiss-button`).
- `failed` → full-width black `Close` pill (same class).

**Intent body** lives in a shared `.intent-body-card` (white panel, `var(--radius-lg)`, `var(--line)` border, soft shadow, `overflow: hidden`). Inside, the per-tab body component renders:
- `<SwapIntentBody>` — hero + `You Swap` accordion + `Total Fees` accordion + `Price Impact` accordion + Swap Buffer + Destination gas.
- `<BridgeIntentBody>` — hero + `You Send` accordion + `Total Fees` accordion + Destination gas.
- `<CompositeIntentBody>` — hero + `<CoverageRow>` + funding accordion (when shortfall) + Gas + Approval (optional) + fee items.

**`<IntentHero amount symbol usd? chainName chainLogo? tokenLogo? eyebrow? subline? chip?>`** — centered hero block at the top of the body card with `--primary-soft` background. Renders the destination token icon with the chain logo as a badge overlay. Token logo via `getTokenLogoUrl(symbol, address?, chainId)` (Bridge uses `intent.token.logo` from SDK when present). Below: amount in `--font-display`, `≈ $usd · on Chain` muted sub-line. Optional `eyebrow` (uppercase label) + `subline` (e.g. truncated contract address). Optional `chip` renders a pill with `<ChainDots>` + count + total.

**`<LineItem label sub? value valueSub? size="primary"|"secondary">`** — single label-on-left / value-on-right row in `.intent-line-items`. `size="primary"` is bolder/larger; `size="secondary"` is quieter. Each row has a `border-top: 1px solid var(--line)` separator spanning the **full card width** (24 px horizontal padding lives on `.intent-line-row` and `.intent-line:not(.intent-line--accordion)`, not on the container).

**`<LineItemAccordion>`** — built on `@radix-ui/react-collapsible`. Head shows label + sub + value + a `Hide Details` / `View Details` trigger (label swap and chevron rotation driven entirely by Radix's `data-state` attribute via CSS). When open, `padding-bottom: 0` (selector: `.intent-line--accordion[data-state="open"]`) so the gray expanded panel sits flush against the next item's border. Expanded panel (`.intent-line-expanded`) uses `--panel-2` background and sits at the natural card width — no negative-margin trick. The animation comes from `.collapsible-content` keyframes that interpolate `height: 0 ↔ var(--radix-collapsible-content-height)` over 200 ms.

**Source rows inside an expanded "You Swap" / "You Send" accordion** use `.intent-source-row` — token icon (with chain logo as badge, 36 px) + chain name (just the name, no "on " prefix) + amount + optional USD (formatted via `trimDp(value, 6)` so trailing zeros are dropped and we never exceed 6 decimals).

**`<CoverageRow status="sufficient" | "shortfall" title? detail? bars?>`** — used by composite modals.
- Title is optional: pass `"Token & gas covered"` when both are sufficient (head row shows with check icon + accent text); pass `undefined` on shortfall (no head row, just bars).
- Sufficient state uses `--success-soft` background + `--success` color for the head; shortfall uses `--primary-soft` + `--accent` (no red).
- Square corners (no `border-radius`).
- `bars[]` is **always passed**, regardless of sufficiency — both token and gas bars render in every case.
- Each bar's fill is **green `#22c49b` when `pct >= 100`** or **orange `#f4a338`** when `pct < 100`; the track is an 18 %-tint of the same hue.
- Sufficient bars (pct ≥ 100) show a green checkmark on the right; insufficient bars show `Available: <haveLabel> · Required: <shortfallLabel>` inline, with bolder "Available:" / "Required:" keys (`.coverage-bar-ratio-key`, `font-weight: 600`) and a muted `·` separator. `shortfallLabel` is the gap (`need − have`), pulled from `intent.shortfall.token.amount` / `.gas.amount`, not the full need.
- Bar labels carry a `<GasIcon>` (gas-pump) or `<TokenIcon>` (Heroicons dollar-coin solid). Both exported from `IntentModalShell.tsx` with `fill="currentColor"`.
- Bar label text always uses `var(--text)` so it stays black regardless of row color.

**Approve gating** (composite modals): `approveDisabled = !allSufficient && !funding` — Confirm is enabled whenever the SDK can execute (sufficient natively, or a funding plan exists).

**Executing body (`<ExecutingBody>`)** — gif hero + a steps card.

The hero (`.exec-hero`) — sits inside a white inner card on the gray panel:
- Source token symbols ("USDC, ETH") small muted at top.
- Entered amount in `--font-display` bold.
- Animated `/progress-grid.gif` (served from `example/browser/public/progress-grid.gif`, 800×457 source) constrained to `width: 100%; max-width: 360px; height: 110px; object-fit: fill` — squeezed vertically, no crop.
- Destination chip: `<AssetRowIcon>` (token + chain badge) + amount + `on <Chain>` line.

The steps card (`.exec-steps`) — second white card, only this scrolls internally (`flex: 1; min-height: 0; overflow-y: auto`).

**Step row (`.exec-row`)** — circular icon (22 px) + label + sub-text + optional chevron. Rows separated by `border-top: 1px solid var(--line)`:

| State | Icon | Label color | Sub-text |
|---|---|---|---|
| `pending` | Outlined gray circle | `var(--muted)`, weight 500 | "Waiting" |
| `active` / `submitted` | Blue arc spinner (`oklch(from var(--accent) … / 0.22)` track + `var(--accent)` arc, `spin` 0.7 s) | `var(--text)`, weight 600 | `var(--accent)` — "Approve in wallet" only when `step.rawState === "wallet_prompted"`, otherwise "Waiting for confirmation…"; "Confirming on-chain…" for `submitted` |
| `done` | Filled `var(--accent)` circle with white checkmark | `var(--text)`, weight 600 | Muted "`X` sec ago" (from `step.completedAt`) |
| `failed` | Filled `var(--danger)` circle with white X | `var(--text)`, weight 600 | `var(--danger)` error message |

The `rawState` field on `NormalizedStep` captures the SDK's raw state string (`"wallet_prompted"`, `"started"`, `"submitted"`, `"confirmed"`, `"failed"`) so the UI can tell wallet-prompt steps apart from automated / server-side execution. The previous blanket "Approve in wallet" sub-text was misleading for steps like `bridge_fill` / `vault_deposit` / `destination_swap` / `request_submission` that don't need a wallet popup.

Steps stay in **natural execution order**. The active step shows a chevron toggle in place; **collapsed** (the default) renders only that active row, **expanded** reveals the full plan with the active row still in its real position — never lifted to the top. A `useEffect` with `setInterval(setNow(Date.now()), 1000)` ticks every second so "X sec ago" stays fresh.

**Success body (`<CompletedBody>`)** — the gif hero swaps to `.exec-success-hero`: large destination token icon with a small `var(--accent)` check-badge overlay (`.exec-success-check`), "You received" eyebrow, big amount + small symbol, `on <Chain> · completed in <N>s` meta line. Duration is `state.completedAt − state.startedAt`.

The steps card swaps to a list of result rows:
- **You Swapped** — `<SourcesAccordion>` built on `@radix-ui/react-collapsible`. Head shows `$<sourcesTotal>` + `<N> asset(s)` trigger; expanded panel (`--panel-2` bg) renders each source via `<AssetRowIcon>` (token + chain badge) + symbol + chain + amount + USD (USD formatted via `trimDp(value, 6)`).
- **Steps** — `<StepsAccordion>` (also Radix Collapsible). Head shows `<N> step(s)`; expanded panel renders every step with its `<StepRow>` (check icon + label + "X sec ago" timestamp).
- One result row per `state.resultLinks` entry — left label is the step's own label (e.g. "Submit RFF", "Approve USDC on Base"), right is a `View Explorer ↗` link.
- **Total Fees** — value row with `$<feesTotal>`.

`state.result: ProgressResult` (typed in `lib/types.ts`) is populated by `progress.attachResult({...})` when the intent is approved. The approved intent view-model is threaded App → Home → OperationPage → `useOperationForm`; the intent-approved `useEffect` extracts `sources`, `sourcesTotal`, and `feesTotal` (bridge → `intent.fees.total`; swap → `sum([buffer, bridgeFees.total])`, via `lib/math.ts`). Composite modals reach into the nested `intent.swap` / `intent.bridge` view-models.

**Failed body (`<FailedBody>`)** — two variants based on `state.failureKind`:
- `cancelled` (set when a mid-execution `UserActionError` fires — signature / allowance / tx-send denied): gray X badge on the destination token icon, "You cancelled" eyebrow, `on <Chain> · <reason>` meta (reason from `friendlyUserActionReason(code)` — "signature declined" / "allowance declined" / "transaction declined"). Body shows a single "No funds moved / Your wallet was untouched. No gas was charged." note.
- `failed` (set on any non-user error): red X badge, "Funds returned" eyebrow, same meta line with the raw error reason. Body shows a "Transaction failed / `<reason>`" note plus any `state.resultLinks` (refund / failed-leg explorer links) rendered as result rows.

Intent-hook denial (`USER_INTENT_HOOK_DENIED`) closes the modal entirely instead of entering the failure UI — nothing started yet, no need to show a state.

**Radix Collapsible** drives every accordion in the modal (`LineItemAccordion`, `SourcesAccordion`, `StepsAccordion`). The animation is CSS-only against Radix's `data-state` attribute on the `.collapsible-content` slot:

```css
.collapsible-content { overflow: hidden; }
.collapsible-content[data-state="open"]   { animation: collapsible-slide-down 200ms ease-out; }
.collapsible-content[data-state="closed"] { animation: collapsible-slide-up   200ms ease-out; }
@keyframes collapsible-slide-down { from { height: 0; } to { height: var(--radix-collapsible-content-height); } }
@keyframes collapsible-slide-up   { from { height: var(--radix-collapsible-content-height); } to { height: 0; } }
```

Toggle button label swap (`Hide Details` / `View Details`) and chevron rotation are both `[data-state]` attribute selectors on the `Collapsible.Trigger` — no React state, no branching in JSX. Adding a new accordion is a `<Collapsible.Root>` + `<Trigger>` + `<Content className="collapsible-content">` with no animation code to write.

**Visibility / dismissal matrix:**

| Phase | Dialog open? | Esc / X / outside-click | Footer button |
|---|---|---|---|
| intent | yes | calls `onDeny` (denies intent + closes) | Confirm |
| executing | yes | blocked (operation in flight) | — |
| completed | yes | dismisses via `onDismissProgress` (closes + resets form) | Done |
| failed | yes | dismisses via `onDismissProgress` | Close |
| closed | no | — | — |

**`ExecutionProgressState`** (in `lib/types.ts`) holds: `phase`, `steps`, `operationType`, `resultLinks`, `header?`, `result?`, `startedAt`, `completedAt?`, `failureKind?`, `failureReason?`. `NormalizedStep` adds `rawState?`, `completedAt?`.

`useExecutionProgress` (in `hooks/useExecutionProgress.ts`) exposes `state`, `openModal(header?)`, `closeModal()`, `handleEvent(ev)`, `handleError(err, opts?)`, and `attachResult(result)`. The hook also logs `plan_preview` / `plan_confirmed` (raw steps + normalized list) and per-step terminal transitions (raw event, raw step, normalized step, all-steps snapshot) to the console — useful for SDK debugging.

### Topbar & tabs

- Topbar (`.topbar`) — `--panel` bg, `--line` border, `--radius-xl`.
- Route tabs (`.route-tabs`) — same surface treatment. Active tab is a tinted pill: `background: var(--primary-soft)`, `color: var(--accent)`. Hover on an inactive tab uses `--accent-soft`. The active state never goes solid filled — Nexus's segmented-control idiom keeps weight low.
- Network switcher — inline-flex group of small ghost buttons with colored dots (`network-dot` mainnet=`--success`, canary=`--warning`, testnet=`--accent`).

### Focus

Global `:focus-visible` is `2px solid var(--accent)` with 2px offset. Components don't override.

### Intent / approval primitives

`src/components/IntentModalShell.tsx` is no longer a Dialog wrapper — it's the shared primitives consumed by FlowModal's intent bodies: `<IntentHero>`, `<LineItem>`, `<LineItemAccordion>`, `<CoverageRow>`, `<GasIcon>`, `<TokenIcon>`. See the **Flow modal** section above for how these compose into Swap / Bridge / Composite intent bodies and how `<CoverageRow>` renders its bars.

---

## Design principles (do this, not that)

1. **No rainbow gradients.** The CTA is a flat solid color. Gradients on buttons read as decoration in this system; Nexus's identity is in the flat black/white pill, not in a hue blend.
2. **One accent.** Nexus has exactly one action color (blue). Do not introduce a second hue for "secondary action" — use the existing surface/border tokens or weight changes instead.
3. **Status colors are reserved for status.** Don't use `--success` for decorative greens or `--danger` for emphasis. They mean "this completed" / "this failed" / "this requires attention" only.
4. **Surfaces are flat, lines are subtle.** Borders are `rgba(...,.08)`-`(.14)` in dark, `#ECECEA`-`#E8E8E7` in light. No heavy 2px borders, no inner glow.
5. **Light mode is canonical.** When designing a new component, mock it in light first. The dark variant should fall out from token overrides — if you need component-level dark-mode overrides, the token system probably needs another semantic var.
6. **Never reference `--nexus-*` from a component.** Always go through a semantic token. If no semantic token fits, add one.
7. **One primary CTA per screen.** Dismiss, cancel, and tertiary actions are secondary or ghost variants.
8. **Hover changes color, not position.** No `transform: scale()` or `translateX()` on hover. Nexus hovers tint the bg/border/text and that's it. Reserve transforms for one-shot mount/celebration animations.
9. **Shadows are neutral.** Use `--cta-shadow` for primary buttons and `--shadow` for panels. Don't apply colored glow shadows (`--accent-glow`, etc.) on functional surfaces — they belong only on the rare decorative element.

---

## Animations

A small set of named keyframe animations is defined in `App.css` and used across components. All are subtle — Nexus is functional and quiet on success; there is no completion spectacle.

| Animation | Purpose |
|---|---|
| `gate-enter` | Component mount entrance — scale + translateY spring |
| `step-pop` | Step icon scale overshoot when a step completes |
| `step-pulse` | Pulsing glow on the active execution step icon |
| `line-appear` | Sequential text reveal on result rows |
| `intent-pulse` | Pulsing dot on `running` status pill |
| `dropdown-in` | Dropdown menu fade-in |
| `token-info-in` | TokenInfoCard hover popover fade + translate |
| `modal-in` / `fade-in` | Modal panel + overlay entrance |
| `exec-step-enter` | Sequential step row entrance in the execution modal |
| `wallet-connect-in` | Wallet button entrance after connect |
| `badge-enter` / `badge-glow` | Status badge entrance + pulsing glow |
| `success-glow` / `success-border-glow` | One-shot celebration on result cards |
| `tx-slide-in` | TxPanel row entrance |
| `modal-shake` | Modal horizontal shake on failure (`.exec-modal-panel--failed`) |
| `spin` | Loading spinner |

**Spring bezier**: `cubic-bezier(0.34, 1.56, 0.64, 1)` — used only on one-shot mount/celebration animations (gate-enter, step-pop, line-appear, etc.). Hover and press transitions use plain `ease` — color-only, no scale or translate.

Failure now has no entrance treatment — the failure UI itself (X badge + reason + "No funds moved" / "Transaction failed" copy) carries the signal. Success has no animation beyond the normal `gate-enter` / `line-appear` reveals.

---

## Numeric handling

All financial / display math goes through `decimal.js` (declared in `package.json` as `decimal.js@10.6.0`, the same version the SDK uses). The thin helpers live in **`src/lib/math.ts`** and are the only entry points the app uses for arithmetic on amounts, values, and fees — `Number()` / `parseFloat()` are reserved for non-precision contexts (simple sign gating like `> 0`, UI rate inputs in StressTest).

| Helper | Use |
|---|---|
| `D(value)` | Coerce `string \| number \| Decimal \| null \| undefined` to `Decimal`. Empty / nullish → `0`. |
| `sum(values)` | Exact addition across an array. Returns `Decimal`. |
| `diff(a, b)` | `a - b` as `Decimal`. |
| `gt(a, b)` / `lte(a, b)` | Boolean comparisons (sign-safe across mixed strings / numbers). |
| `pctOf(have, need)` | `have / need * 100`, clamped to `[0, 100]`, returned as a `number`. Returns `100` when `need <= 0`. |
| `ceilDp(value, dp)` | Ceiling to `dp` decimal places, returned as a fixed-decimal string. Used for fees (`ceil4` in `lib/nexus.ts`). |
| `toFixed(value, dp)` | Fixed-decimal string with `dp` places. Used for totals, USD aggregates. |
| `trimDp(value, dp)` | Round to at most `dp` decimal places, dropping trailing zeros. Goes through `.toFixed(dp)` then strips `0+$` and the trailing `.` via regex. Used for displaying SDK-provided amounts where we want max-N precision without padding (e.g. source-row USDs at `dp=6`). |

**Rules:**
- Never write `Number(stringAmount) + Number(other)` — always use `sum([a, b])` or `D(a).plus(b)`.
- Never write `(amount / divisor).toFixed(2)` — use `D(amount).div(divisor).toFixed(2)` to avoid floating-point drift.
- **Never call `.toString()` on a `Decimal`.** Always go through `.toFixed(dp)` (directly or via a helper). `Decimal.toString()` can emit exponential notation for very small (`< 1e-7`) or very large (`>= 1e21`) values; those would leak into the UI as `1.5e-9` or `1.5e+21`. `trimDp` is the safe way to drop trailing zeros without `.toString()`.
- `formatAmount(value, dp)` in `lib/format.ts` already pins precision via `Decimal.toFixed` before handing off to `toLocaleString` for thousands grouping — pass raw strings/numbers directly; do not pre-`Number()` them.
- When extracting from on-chain bigints (e.g. swap output amounts in `lib/tabs.ts`), convert via `D(bigint.toString()).div(D(10).pow(decimals))`. `bigint` is not assignable to `Decimal`'s constructor directly. (`bigint.toString()` is fine — it's not a `Decimal`.)
- Sorting comparators where the result is just for ordering can use `D(a.value).cmp(D(b.value))` — `cmp` returns `-1 / 0 / 1` and is safe for any decimal string.

**Where this matters:** `intent.sourcesTotal`, `feesTotal`, swap impact / buffer math, coverage-bar `tokenPct` / `gasPct`, source-selector pill totals, balances totals, source modal group aggregates. All of these accept SDK strings, accumulate exactly, and only convert back to `number` at the boundary (sorting, or display rounding via `toFixed`).

---

## Debug shortcuts

| Shortcut | Action |
|---|---|
| **Ctrl+Shift+K** | Preview the success state with a mock completed execution modal |
| **Ctrl+Shift+J** | Preview the failure state with a mock failed execution modal |

(Cmd+Shift+J conflicts with Chrome DevTools on Mac — use Ctrl.)

---

## Where things live

- `src/App.css` lines 1–~150 — all tokens. Edit here to retheme.
- `src/App.css` below — component styles. Read tokens only.
- `src/App.tsx` — palette/theme state (`data-palette`, `data-theme` on `<html>`).
- `src/lib/math.ts` — `decimal.js` helpers; all financial / display math routes through here.
- Fonts wired via `@fontsource-variable/geist`, `@fontsource-variable/space-grotesk`, `@fontsource/geist-mono` in `package.json`.

To preview light mode: toggle the sun/moon icon in the topbar. To inspect tokens: in DevTools, `getComputedStyle(document.documentElement).getPropertyValue('--accent')`.
