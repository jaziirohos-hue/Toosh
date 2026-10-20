---
name: Somali Financial Clarity
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#404941'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#707a71'
  outline-variant: '#bfc9bf'
  surface-tint: '#216b43'
  primary: '#004225'
  on-primary: '#ffffff'
  primary-container: '#0a5c36'
  on-primary-container: '#89d2a2'
  inverse-primary: '#8dd6a6'
  secondary: '#006398'
  on-secondary: '#ffffff'
  secondary-container: '#5bb8fe'
  on-secondary-container: '#00476e'
  tertiary: '#523200'
  on-tertiary: '#ffffff'
  tertiary-container: '#714600'
  on-tertiary-container: '#ffb34d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#a8f3c1'
  primary-fixed-dim: '#8dd6a6'
  on-primary-fixed: '#002110'
  on-primary-fixed-variant: '#00522e'
  secondary-fixed: '#cce5ff'
  secondary-fixed-dim: '#93ccff'
  on-secondary-fixed: '#001d31'
  on-secondary-fixed-variant: '#004b73'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 34px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
  title-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  title-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-numeric-lg:
    fontFamily: JetBrains Mono
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 28px
  label-numeric-md:
    fontFamily: JetBrains Mono
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
  label-numeric-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-ui:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

This design system establishes a high-trust, data-dense financial environment tailored for mobile users tracking EVC Plus mobile money SMS streams across Somalia. The interface merges Google Material Design 3 surface hierarchies with bespoke fintech precision, prioritizing legibility, reassurance, and instantaneous transaction categorization.

### Personality & Emotional Tenor
- **Trustworthy & Authoritative:** Evokes institutional dependability through grounded deep forest tones and meticulous numerical precision.
- **Clarity Under Scrutiny:** Optimizes data parsing for ambiguous SMS trails, rendering numbers, decimal values, and transaction states immediately discernible under high outdoor sunlight.
- **Respectful & Native:** Embraces Somali financial terms ("Haraagii ugu dambeeyay", "Dhaqdhaqaaq", "Soo galay", "Baxay") as core interface architecture rather than afterthought localizations.

### Design Movement
The visual language operates on a **Refined Modern Utility** baseline. It utilizes layered tonal elevations, precise hairline segmentations (1px neutral borders), and localized physical cues (soft diffused elevation drops) to provide clear touch targets without unnecessary ornamentation.

## Colors

The palette grounds the application in the recognizable deep forest green associated with financial stability, growth, and mobile money ecosystems in East Africa. Semantic roles are distinct and non-negotiable to prevent cognitive errors when auditing fast-paced micro-transactions.

### Primary & Functional Roles
- **Primary (`#0A5C36`):** Deep Forest Green. Anchors top app bars, primary action buttons ("Kaydi"), verified security indicators, and high-level balance totals.
- **Secondary (`#0284C7`):** Sky Teal. Reserved strictly for system status, SMS listener daemon sync indicators, network handshake badges, and active data connections.
- **Tertiary (`#F59E0B`):** Amber Gold. Denotes items requiring user review ("Sugaya kala saarid"), ambiguous SMS parsing, or unconfirmed merchant receipts.
- **Neutral (`#64748B`):** Slate. Manages secondary labels, timestamp typography, divider rules, inactive tab affordances, and offline states.

### Semantic Transaction Tokens
- **Incoming ("Soo galay"):** `#047857` (Text & Icon), `#ECFDF5` (Surface Container). Always paired with `+` symbol prefix.
- **Outgoing ("Baxay"):** `#B91C1C` (Text & Icon), `#FEF2F2` (Surface Container). Always paired with `-` symbol prefix.
- **Awaiting / Pending ("Sugaya"):** `#D97706` (Text & Icon), `#FFFBEB` (Surface Container). Paired with an alert/clock indicator.
- **Surface Canvas:** `#F8FAFC` base application background with layered `#FFFFFF` cards, bounded by `#E2E8F0` hairline strokes.

## Typography

Typography solves a core fintech challenge: rendering variable-length Somali text strings while keeping monetary figures aligned down to three decimal floats (`$54.585`, `$0.750`).

### Font Pairings
- **Primary (Plus Jakarta Sans):** Provides modern geometric forms with open counters, maintaining legibility on lower-density Android screens. Used for headings, transaction counter-party names, and interface navigation.
- **Monospaced Numerical System (JetBrains Mono):** Applied to all monetary values, balance strings, phone numbers, and raw SMS reference tokens. Prevents layout jitter during live balance updates and ensures vertical decimal alignment in transaction tables.

### Numerical Guidelines
- Always render currency identifiers as prefixes with no space for standard USD amounts (`$12.500`) or standard SOS notation (`45,000 SLSH`).
- Maintain consistent tabular figures across list views to ensure immediate vertical scanning across incoming ("Soo galay") and outgoing ("Baxay") logs.

## Layout & Spacing

The layout is built for native Android viewports, strictly following an 8-point spatial system (with 4-point micro-adjustments for badges and compact chips).

### Screen Constraints & Margins
- **Canvas Margins:** Mobile standard margin is `1rem` (16px), expanding to `1.5rem` (24px) on tablet viewports.
- **Component Padding:** Standard transactional card padding is `space-md` (16px), giving sufficient interior clearance for multi-line SMS context alongside floating monetary badges.
- **Stack Gaps:** Transaction item lists must maintain an exact `space-sm` (8px) distance between adjacent cards when separated, or `0px` with a 1px internal border divider when organized as a grouped table view.
- **Android Touch Targets:** All clickable interactive areas (categorization chips, icon buttons, calendar controls) adhere to a minimum size of 48×48dp regardless of their visual footprint.

## Elevation & Depth

Visual hierarchy uses subtle surface elevation rather than harsh drop shadows, preventing visual clutter in multi-item lists.

### Elevation Tiers
- **Surface Level 0 (Base Canvas):** `#F8FAFC`. Houses the application framework, system status areas, and unselected filter groups.
- **Surface Level 1 (Resting Cards & Lists):** `#FFFFFF`. Bound by a crisp 1px stroke of `#E2E8F0`. Shadow: `0px 1px 3px rgba(15, 23, 42, 0.05)`.
- **Surface Level 2 (Active Modals, Bottom Sheets, Sync Status Bar):** `#FFFFFF`. Shadow: `0px 8px 24px -4px rgba(15, 23, 42, 0.08), 0px 2px 6px -1px rgba(15, 23, 42, 0.04)`.
- **Surface Level 3 (Floating Action Button & Alert Overlays):** `#0A5C36`. Tinted shadow: `0px 10px 20px -3px rgba(10, 92, 54, 0.25)`.

### Border Discipline
All card borders use solid 1px `#E2E8F0`. Never omit the border stroke on white surfaces; it maintains separation between nested cards and the `#F8FAFC` base under varying outdoor display contrast conditions.

## Shapes

The design system uses deliberate, rounded geometry that softens technical transactional data while maintaining clear organizational boundaries.

### Corner Radius Implementation
- **Cards & Primary Modules:** 16px (`rounded-lg`) to 24px (`rounded-xl`). Balance hero modules at the top of "Guud" use 24px; regular transaction list cards use 16px.
- **Input Fields & Text Areas:** 8px (`rounded-base`). Maintains an architectural, precise appearance suited for numeric entry and search queries.
- **Badges, Chips, and Status Tags:** 12px pill shapes (`rounded-full` or 9999px). Encloses status labels ("Soo galay", "Baxay", "Sugaya") into self-contained units distinct from interactive buttons.
- **Bottom Sheets:** 24px top-left and top-right radii; bottom corners remain flush with screen edges.

## Components

### Transaction Items (`Dhaqdhaqaaq`)
- **Structure:** 3-column layout inside a Level 1 card.
  - Left: 40×40dp rounded-full container indicating direction: emerald for incoming (`+`), red for outgoing (`-`), amber for pending.
  - Center: Recipient/Sender title (Plus Jakarta Sans, SemiBold 14px), relative timestamp ("5 daqiiqo ka hor", 12px Slate), and optional merchant category pill.
  - Right: Monospaced amount formatted using JetBrains Mono (SemiBold 15px), colored according to transaction type, positioned directly above running balance ("Haraa: $X.XXX", 11px Slate).

### Status Sync Bar (`Xaaladda`)
- Compact 36dp persistent pill or full-width banner docked beneath top navigation.
- Sky teal surface (`#F0F9FF`) with `#0284C7` border and pulsating 8dp status dot when listener is running; transitions to neutral slate (`#F1F5F9`) with icon alert when SMS permissions are suspended or device is offline.

### Action Buttons
- **Primary Button ("Kaydi"):** Full-width or auto-width 48dp height, solid `#0A5C36` background, white label, 8dp corner radius. Hover/active states darken to `#074025`.
- **Secondary / Dismiss Button ("Jooji"):** Ghost style with `#64748B` border, transparent background, text in `#334155`.

### Categorization Chips
- 32dp height, 12dp rounded borders. Inactive state: `#F1F5F9` background, `#475569` text. Active state: `#ECFDF5` background, `#047857` border and text.

### Balance Summary Hero Card ("Haraagii ugu dambeeyay")
- Primary 24px rounded card rendered in deep emerald `#0A5C36` with high-contrast `#FFFFFF` monospaced figures (`label-numeric-lg`). Includes micro-actions: quick-refresh trigger, copy balance string, and visual split metrics for total daily income vs total daily spend.