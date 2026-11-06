---
name: SettleKit
description: A precise graphite-and-mint workspace for merchant payment operations.
colors:
  primary: "#a3f5c5"
  primary-ink: "#11291b"
  primary-hover: "#c1fbd9"
  background: "#0b0d11"
  surface: "#12151c"
  border: "#282e39"
  foreground: "#f5f7fa"
  secondary-text: "#a5adbd"
  quiet-text: "#8e98ab"
  caution: "#f5cf8e"
  error: "#ffb2ad"
  input-background: "#0e1219"
  input-border: "#3a4554"
  selected-background: "#1b2825"
  selected-text: "#c4f7d9"
  secondary-button: "#19212a"
  secondary-button-text: "#c7d5e5"
typography:
  display:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "34px"
    fontWeight: 620
    lineHeight: 1.2
    letterSpacing: "-1.15px"
  headline:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "33px"
    fontWeight: 620
    lineHeight: 1.22
    letterSpacing: "-1.1px"
  title:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "23px"
    fontWeight: 580
    lineHeight: 1.55
    letterSpacing: "-0.7px"
  body:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 550
    lineHeight: 1.55
  identifier:
    fontFamily: "IBM Plex Mono, Cascadia Mono, monospace"
    fontSize: "0.87em"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  chip: "5px"
  ghost: "6px"
  control: "7px"
  navigation: "8px"
  notice: "9px"
  panel: "15px"
  circle: "100%"
spacing:
  tight: "8px"
  compact: "12px"
  control-x: "16px"
  mobile-frame: "22px"
  mobile-panel: "24px"
  compact-panel: "26px"
  panel: "33px"
  wide-gap: "38px"
  desktop-frame: "44px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.secondary-button}"
    textColor: "{colors.secondary-button-text}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  button-ghost:
    textColor: "{colors.secondary-text}"
    rounded: "{rounded.ghost}"
    size: "44px"
  input:
    backgroundColor: "{colors.input-background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
  navigation-active:
    backgroundColor: "{colors.selected-background}"
    textColor: "{colors.selected-text}"
    rounded: "{rounded.navigation}"
    padding: "11px 12px"
  environment-chip:
    textColor: "#b6c0d0"
    rounded: "{rounded.chip}"
    padding: "5px 9px"
  work-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.panel}"
    padding: "33px"
  status-notice:
    rounded: "{rounded.notice}"
    padding: "14px"
---

# Design System: SettleKit

## Overview

**Creative North Star: "A clear operating workspace"**

The implemented system follows the user's graphite-and-mint fintech brief. Its expression comes from an aligned working shell, readable forms, controlled density and precise feedback. The work surface leads; supporting explanations describe ownership, screening limits and the test environment without competing with the task.

This is a scan of the Phase 1 onboarding implementation, not a speculative dashboard library. Future screens inherit its palette, type and control grammar while choosing layouts appropriate to their own jobs. Route-specific onboarding composition remains in `docs/design/onboarding.md`.

**Key Characteristics:**

- Graphite layers and restrained mint actions.
- Real operational state with explicit unavailable and review outcomes.
- Familiar controls, clear alignment and readable identifiers.
- Border-defined surfaces, without decorative glow or shadows.

## Colors

The frontmatter records the actual CSS values; their names describe function rather than a new palette.

### Primary

- **Settlement Mint:** primary actions, selected/current progress and focus visibility. The dark primary ink keeps action labels readable; the lighter hover mint provides ordinary pointer feedback.

### Neutral

- **Graphite Background / Work Surface:** separate the surrounding workspace from the task area through tonal layering.
- **Quiet Border:** defines work panels and boundaries without heavy outlines.
- **Near-white Foreground / Secondary / Quiet Text:** establish task, explanation and metadata hierarchy.
- **Input Ground / Input Border:** distinguish editable fields from surrounding panels.
- **Selected Background / Selected Text:** give current navigation a modest mint-tinted field.

Caution amber and error rose are semantic status colors, not decorative secondary accents. Source failure must not borrow the visual treatment of a passed check.

**The State Is Evidence Rule.** Positive color is conditional on current successful application state; stale or failed reads cannot retain a fresh allowed appearance.

## Typography

Manrope is self-hosted from `apps/gateway/public/fonts/manrope-variable.ttf`, with its OFL notice alongside. The font is loaded through CSS with swap behavior; builds do not depend on a remote font request. The declared mono stack is reserved for addresses/identifiers; IBM Plex Mono is not bundled, so Cascadia Mono or the system monospace fallback may render those values.

The page title uses the display token; wallet-entry headlines use the headline token; section titles use the title token. Supporting prose and controls primarily use the body/label scale. Small status metadata can be more compact. On phones the page title reduces to 29px and form inputs increase to 16px. Code uses tabular numerals and long wallet addresses wrap without losing their full value.

**The Operational Type Rule.** Use monospace for code and identifiers, not as a general fintech costume. Keep a clear hierarchy through weight, scale and spacing.

## Layout

Desktop uses a fixed workspace rail (226px), a top bar (76px) and a centered content region capped at 1260px. The initial setup grid has a flexible work area and a 270px supporting column, separated by the wide-gap token. Main content uses the desktop-frame gutter. At 1500px and above, the work area is capped at 620px, the supporting column becomes 280px and the gap grows to 50px.

At 1100px the rail and gutters contract. At 900px the main grid becomes a single column and introductory support copy is removed while functional status remains. At 600px the rail becomes a compact top brand row, auxiliary rail controls are hidden, gutters use the mobile-frame token and forms retain full-width usable controls. Breakpoint values are recorded in the sidecar, not introduced as new global token groups.

Group labels and their fields tightly; separate distinct tasks more generously. The observed panel padding varies with viewport, rather than forcing a rigid universal spacing scale.

## Elevation & Depth

There are no implementation shadows. Depth comes from the graphite background, the slightly lifted work surface, darker editable fields and single-pixel borders. Hover changes color without introducing glow or new apparent layers. Preserve this flat, tonal depth vocabulary.

**The Flat Surface Rule.** A new surface uses tonal separation and a border before considering any additional elevation treatment.

## Shapes

Work panels have the panel radius; controls use the smaller control radius. Navigation, notices and small chips have their own observed compact corners. Circles mark status/progress or compact geometric brand elements. Do not turn every item into a pill or add nested decorative containers.

## Components

### Buttons

Primary buttons use mint with dark ink, compact corners and clear action verbs. The connect action expands to the work-area width and has a larger minimum height (48px); general primary actions have a 42px minimum. Secondary buttons use a muted dark field with a visible border. Ghost actions have 44px square targets. Disabled controls use reduced opacity and a not-allowed cursor. Hover changes the fill; active buttons translate by one pixel.

Focus is a mint two-pixel outline with a five-pixel offset. Normal feedback transitions last 150ms with ease-out. The spinner is functional loading feedback, not a decorative entrance animation.

### Inputs / Fields

Fields have persistent visible labels, dark editable grounds, a single-pixel stroke and compact corners. Focus uses a mint outline with a two-pixel offset. Invalid fields use the error border and an associated readable error message; help text explains the expected value. Phone inputs use the larger observed size to remain legible. Do not erase unsaved edits during background status refreshes.

### Chips and Status Notices

Environment chips label the test boundary. Screening badges distinguish passed checks from held/unavailable states with text as well as color. Inline notices pair an icon, explicit outcome and recovery action where applicable; no ornamental notification modal is needed for routine form feedback.

### Cards / Containers

The work panel is a bounded functional area, not a repeated icon-card marketing grid. Use its surface, single border, panel radius and viewport-specific padding. Settlement addresses are functional readable data fields, not pretend account-balance tiles.

### Navigation

The rail contains only the current working setup route. Active navigation uses the selected palette and a clear current-page indication. The compact screen removes the rail rather than squeezing hidden future routes into tiny targets. Preserve the skip link and obvious keyboard focus. Do not add inactive product modules before their behavior exists.

### Progress and Feedback

Three ordered setup steps represent actual identity/profile/check facts. Their numbers carry sequence; successful states replace the number with a check. Selection, caret, scrollbars and focus inherit the graphite/mint system. Reduced-motion preferences collapse transitions/animations to a single minimal update.

## Do's and Don'ts

### Do:

- Do preserve the graphite/mint palette and flat working surfaces.
- Do show real application state with readable text and recovery actions.
- Do keep full wallet values accessible and allow long identifiers to wrap.
- Do inspect the actual mobile and desktop layouts after material changes.
- Do honor keyboard focus and reduced-motion preferences.

### Don't:

- Don't show fake balances, market decoration or inactive future navigation.
- Don't describe a stale or unavailable screening result as passed.
- Don't use gradients, halos or heavy shadows to replace useful content.
- Don't treat a successful build or a visual snapshot as proof of every user state.
