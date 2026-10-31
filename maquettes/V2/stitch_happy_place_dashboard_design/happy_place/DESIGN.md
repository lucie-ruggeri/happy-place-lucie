---
name: Happy Place
colors:
  surface: '#fbf9f8'
  surface-dim: '#dbdad9'
  surface-bright: '#fbf9f8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f3f2'
  surface-container: '#efedec'
  surface-container-high: '#e9e8e7'
  surface-container-highest: '#e4e2e1'
  on-surface: '#1b1c1b'
  on-surface-variant: '#444748'
  inverse-surface: '#303030'
  inverse-on-surface: '#f2f0ef'
  outline: '#747878'
  outline-variant: '#c4c7c7'
  surface-tint: '#5e5e5e'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1b1c1c'
  on-primary-container: '#848483'
  inverse-primary: '#c7c6c6'
  secondary: '#715859'
  on-secondary: '#ffffff'
  secondary-container: '#fcdbdb'
  on-secondary-container: '#775e5f'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#281717'
  on-tertiary-container: '#987d7e'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e3e2e2'
  primary-fixed-dim: '#c7c6c6'
  on-primary-fixed: '#1b1c1c'
  on-primary-fixed-variant: '#464747'
  secondary-fixed: '#fcdbdb'
  secondary-fixed-dim: '#debfbf'
  on-secondary-fixed: '#281717'
  on-secondary-fixed-variant: '#584142'
  tertiary-fixed: '#fbdbdb'
  tertiary-fixed-dim: '#debfbf'
  on-tertiary-fixed: '#281717'
  on-tertiary-fixed-variant: '#574142'
  background: '#fbf9f8'
  on-background: '#1b1c1b'
  surface-variant: '#e4e2e1'
typography:
  headline-xl:
    fontFamily: Comfortaa
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Comfortaa
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Comfortaa
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Comfortaa
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
  headline-sm:
    fontFamily: Comfortaa
    fontSize: 16px
    fontWeight: '500'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.06em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.08em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 12px
    letterSpacing: 0.1em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.25rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-tablet: 2rem
  margin-desktop: 3rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system establishes an executive, distraction-free digital workplace for high-velocity recruiting operations. It translates the "Happy Place" ethos into a rigorously ordered, functional atmosphere where clarity and peace of mind replace executive fatigue and visual noise.

Targeted at recruitment consultants, talent partners, and operations leaders handling complex hiring pipelines, the interface conveys precision, understated warmth, and systematic calm. The design philosophy blends functional minimalism with warm editorial structure:
- **Atmospheric Restraint:** A warm ecru canvas eliminates the stark sterility of pure digital white while keeping contrast effortless and ergonomic.
- **Instrumental Precision:** Structured white cards framed by hairline borders organize information into clear operational envelopes, discarding gratuitous social feeds, decorative illustrations, or skeuomorphic clutter.
- **Architectural Harmony:** Geometric softness in headlines balances the technical, monospace discipline of operational metadata and the neutral clarity of body records.

## Colors

The palette is engineered around high typographic legibility, grounded physical surfaces, and soft operational signaling.

### Canvas & Surface Hierarchy
- **Base Canvas (`#FBF9F8`):** Warm ecru foundation providing an unhurried, anti-glare work surface.
- **Container Surface (`#FFFFFF`):** Pure white modular cards and operational sheets floating cleanly on the canvas.
- **Structural Stroke (`#E6E6E1`):** A hairline 1px border that crisply delineates content regions without relying on deep shadows.

### Core Ink & Action
- **Primary Ink / Solid Action (`#171818`):** Deep anthracite used for key interactive triggers, primary icons, and high-emphasis textual headers. Ensures uncompromised contrast against light surfaces.
- **Muted Ink (`#5B5D5E`):** Secondary text, timestamps, and column labels maintaining strict readability while establishing hierarchy.
- **Subtle Ink (`#8C8E8F`):** Placeholder text, inactive tab states, and disabled controls.

### Functional Accents & System States
- **Soft Powder Accent (`#FCDBDB` base / `#DEBFBF` border & active ring):** Delicate blush tones reserved for candidate status chips, pipeline stage pills, filter highlights, and active navigation indicators. Never used for destructive states.
- **Success (`#2F7D4A` on `#DFF3E4`):** Soft meadow green background framed with `#2F7D4A` borders and typography for confirmed placements, validated credentials, and signed contracts.
- **Alert & Error (`#BA1A1A` on `#FFDAD6`):** Soft rose-coral background with crisp `#BA1A1A` borders and text for vetting rejections, missing pipeline data, and SLA breaches.

## Typography

The typography system harmonizes three distinct typographic roles to optimize clarity across heavy candidate and client workflows:

1. **Comfortaa (Headlines & Section Anchors):** Provides soft, humane geometry that relieves the sterile tension typical of corporate databases. Used selectively for module titles, primary page headers, and high-level metric summaries.
2. **Inter (Body & Narrative Data):** The workhorse typeface for candidate notes, job specifications, and client email correspondence. High x-height, neutral tone, and exceptional legibility across dense paragraph layouts.
3. **JetBrains Mono (Metadata, Indicators, & Identifiers):** Employed in small-caps and uppercase treatments for candidate IDs, contract numbers, interview times, status badges, and column identifiers. Brings rigorous, tabular order to enterprise data grids.

## Layout & Spacing

The layout is built upon a balanced 12-column grid system prioritizing structured workspace modules over endless scroll streams.

### Layout Rhythm
- **Operational Alignment:** Content conforms to a clean, fixed max-width container (1440px max) on desktop screens, avoiding overextended horizontal eye travel during candidate record reviews.
- **Canvas Gaps:** Sections maintain a generous rhythmic cadence (`space-xl`), ensuring candidate lists, client account blocks, and pipeline statistics remain clearly segmented.
- **Internal Card Padding:** Default interactive cards utilize `space-lg` (24px) for desktop padding, dropping to `space-md` (16px) on compact viewports to maximize screen real estate.

### Responsive Behavior
- **Mobile (< 768px):** Single-column stack. Outer margin drops to 16px (`margin`). Multi-stage interview boards collapse into segmented tabbed panels.
- **Tablet (768px - 1024px):** 6-column grid with 24px gutters. Secondary sidebars collapse into persistent off-canvas drawers.
- **Desktop (> 1024px):** Full 12-column system with 24px gutters and 48px outer canvas padding. Facilitates split views (e.g., candidate dossier alongside active pipeline feedback).

## Elevation & Depth

This design system deliberately eschews heavy drop shadows, colored blurs, and dramatic z-axis layering. Visual hierarchy is achieved through crisp planar containment:

- **Border-Box Structural Planarity:** Visual separation is driven primarily by 1px solid hairline borders (`#E6E6E1`) overlaid against the ecru background (`#FBF9F8`).
- **Subtle Surface Lift:** For interactive floating menus, modal dossiers, and dropdown pickers, depth is rendered exclusively via an ultra-faint, desaturated ambient border-box shadow: `0 1px 3px rgba(23, 24, 24, 0.04), 0 4px 12px rgba(23, 24, 24, 0.02)`.
- **Active State Depth:** Hovering over a card or table row does not elevate the element upward; instead, it sharpens the structural border to `#171818` or washes the background to an ultra-subtle off-white tint (`#FDFCFC`).

## Shapes

The geometric signature is disciplined, calibrated at an 8px (`0.5rem`) base corner radius:

- **Modular Cards & Inputs:** Rigorously pinned to 8px (`roundedness: 2`). This radius harmonizes directly with the circular terminal strokes of the Comfortaa headers while keeping forms and data tables strictly architectural.
- **Badges & Pipeline Pills:** Use full round caps (`9999px`) to immediately distinguish small-format status chips from rectangular content containers.
- **Modal Containers & Sheets:** Maintained at 12px (`0.75rem`) to frame larger viewports without softening the professional rigor of the UI.

## Components

### Buttons
- **Primary:** Solid anthracite `#171818` background, `#FFFFFF` text in Inter Medium (14px), 8px border-radius, 10px 18px padding. No shadow. Hover: transitions to `#2D2F2F`. Active: subtle scale down (0.99).
- **Secondary / Ghost:** `#FFFFFF` background, 1px solid `#E6E6E1` border, `#171818` text. Hover: border shifts to `#171818` with zero background fill change.
- **Tertiary:** Pure text button in `#171818`, no border, underlines on hover.

### Badges & Chips
- **Neutral / Meta:** White background, 1px solid `#E6E6E1`, JetBrains Mono uppercase (11px, 500 weight), `#5B5D5E` text.
- **Accent (Powder Pink):** Background `#FCDBDB`, border 1px solid `#DEBFBF`, text `#171818`, JetBrains Mono uppercase.
- **Success:** Background `#DFF3E4`, border 1px solid `#2F7D4A`, text `#2F7D4A`, JetBrains Mono uppercase.
- **Error:** Background `#FFDAD6`, border 1px solid `#BA1A1A`, text `#BA1A1A`, JetBrains Mono uppercase.

### Cards
- **Dossier Card:** Pure white `#FFFFFF` surface, 1px solid `#E6E6E1` border, 8px corner radius. Padding is 24px. Header features Comfortaa section title, subhead in Inter, and trailing status badge in JetBrains Mono.
- **Action Card (Interactive):** Same specs as Dossier Card. On hover: border transition to `#171818`, cursor pointer.

### Form Inputs & Selects
- **Text Inputs:** `#FFFFFF` background, 1px solid `#E6E6E1` border, 8px border-radius, 12px 14px padding. Text is Inter Regular 14px in `#171818`. Focus state: 1px solid `#171818` with an additional 2px outer ring in `#FCDBDB`.
- **Validation Error State:** Border becomes 1px solid `#BA1A1A`, background tints subtly to `#FFDAD6` (opacity 25%), error feedback line displayed below in `#BA1A1A` using JetBrains Mono 11px.

### Selection Controls
- **Checkboxes:** 18x18px square, 4px border-radius, 1px solid `#E6E6E1` border. Checked: `#171818` fill with a sharp white checkmark.
- **Radio Buttons:** 18x18px circular, 1px solid `#E6E6E1` border. Checked: white fill with a solid 8px `#171818` concentric dot.

### Data Lists & Tables
- **Rows:** Alternating subtle line separators using 1px solid `#E6E6E1`. Zero row drop shadows.
- **Headers:** JetBrains Mono uppercase 11px, letter-spacing 0.08em, text `#5B5D5E`, sticky positioning with `#FBF9F8` background.
- **Row Hover:** Background switches from `#FFFFFF` to `#FBF9F8`.

### Pipeline Stage Bar (Recruitment Specific)
- Horizontal segmented progress track consisting of connected 8px rounded pill tags. Active stage uses `#FCDBDB` fill with `#DEBFBF` outline; completed stages use `#DFF3E4` with `#2F7D4A` text and icons.