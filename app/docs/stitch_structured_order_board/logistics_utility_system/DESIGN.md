---
name: Logistics Utility System
colors:
  surface: '#f8f9ff'
  surface-dim: '#d0dbed'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e6eeff'
  surface-container-high: '#dee9fc'
  surface-container-highest: '#d9e3f6'
  on-surface: '#121c2a'
  on-surface-variant: '#454652'
  inverse-surface: '#27313f'
  inverse-on-surface: '#eaf1ff'
  outline: '#757683'
  outline-variant: '#c5c5d4'
  surface-tint: '#4257b3'
  primary: '#102b88'
  on-primary: '#ffffff'
  primary-container: '#2e44a0'
  on-primary-container: '#acb9ff'
  inverse-primary: '#b9c3ff'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#6cf8bb'
  on-secondary-container: '#00714d'
  tertiary: '#4e2f00'
  on-tertiary: '#ffffff'
  tertiary-container: '#6d4300'
  on-tertiary-container: '#ffac34'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dde1ff'
  primary-fixed-dim: '#b9c3ff'
  on-primary-fixed: '#001356'
  on-primary-fixed-variant: '#283e9a'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#f8f9ff'
  on-background: '#121c2a'
  surface-variant: '#d9e3f6'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: -0.02em
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 16px
  margin-mobile: 12px
  margin-desktop: 24px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 24px
---

## Brand & Style

This design system is built for high-stakes, high-velocity logistics and order management. The brand personality is **reliable, efficient, and transparent**, prioritizing utility over decoration. The design style follows a **Corporate / Modern** aesthetic with a lean toward **Functional Minimalism**. 

The UI should evoke a sense of calm under pressure. It achieves this through a structured hierarchy that mimics physical order slips and manifests as a digital "Command Center." High information density is balanced with generous whitespace between logical groups to prevent cognitive overload. The interface focuses on legibility, rapid scanning of status updates, and clear task completion markers.

## Colors

The palette is rooted in **Deep Indigo** to establish authority and trust. This primary color is used for active states, navigation, and primary actions. 

- **Success (Emerald Green):** Reserved exclusively for "Completed," "Delivered," or "Confirmed" statuses.
- **Warning (Amber/Tertiary):** Used for delayed orders or items requiring immediate attention.
- **Surface & Background:** The application uses a multi-layered light gray system to differentiate the message feed from the background. 
- **Text:** High-contrast charcoal (#1F2937) ensures AA/AAA accessibility for long-form message reading and data verification.

## Typography

The system utilizes a dual-font approach to separate narrative communication from logistical data.

1.  **Inter:** Used for all UI labels, message content, and navigation. Its high x-height ensures readability on mobile devices during field use.
2.  **JetBrains Mono:** Used for order IDs, tracking numbers, quantities, and timestamps. The monospaced nature ensures that columns of numbers align perfectly, allowing dispatchers to scan for discrepancies quickly.

On mobile devices, headlines scale down to a maximum of 20px to preserve horizontal space for message bubbles and data tables.

## Layout & Spacing

The layout follows a **Fluid Grid** system designed for a three-pane desktop view (Navigation | Thread List | Active Conversation) that collapses into a single-pane view for mobile.

- **Rhythm:** An 8px grid system governs all spacing.
- **Margins:** 16px internal padding for message cards to ensure text doesn't feel cramped against borders.
- **Thread View:** The message feed uses a "center-aligned" logic where structured data blocks take up 85% of the width, while standard messages follow a traditional left/right alignment (Inbound/Outbound).
- **Safe Areas:** On mobile, a fixed bottom action bar (Quick Actions) includes a 24px safe area to prevent accidental triggers during one-handed operation.

## Elevation & Depth

This design system uses **Tonal Layers** and **Low-contrast Outlines** instead of heavy shadows to maintain a "flat and fast" feel.

- **Level 0 (Background):** Lightest gray (#F9FAFB).
- **Level 1 (Cards/Messages):** Pure white (#FFFFFF) with a 1px solid border (#E5E7EB).
- **Level 2 (Active/Hover):** A subtle 4px blur shadow with 5% opacity is applied only to the "Active" message thread or an order card being dragged.
- **Separators:** 1px hairline strokes are used to divide headers and footers within cards, ensuring that meta-data (timestamps, order IDs) is distinct from the primary message body.

## Shapes

The system uses **Soft (0.25rem)** rounding. This subtle curvature maintains a professional, rigid appearance while feeling modern and touch-friendly.

- **Standard Elements:** Buttons, input fields, and small cards use 4px (rounded).
- **Containers:** Main message bubbles and larger order blocks use 8px (rounded-lg).
- **Interactive States:** Checkboxes use 2px rounding to remain distinctive from circular radio buttons.

## Components

### Message Cards & Order Blocks
Message cards are the primary vessel for information. Each card contains a **Header** (User/Status), a **Body** (Message/Data Block), and a **Footer** (Timestamp/Read Receipt). Order blocks nested within messages use a light blue tinted background (#EFF6FF) to distinguish "System Data" from "User Chat."

### Structured Data Blocks
Used for logistics details. These must use the `data-mono` typography. Key-value pairs should be aligned with keys in `label-caps` (Gray-500) and values in `data-mono` (Neutral-900).

### Voice Message Player
A streamlined horizontal bar. The waveform should be simplified into vertical bars that change color from Slate Blue to Primary Indigo as the message plays. Provide `Play/Pause` and `1x/1.5x/2x` speed toggles.

### Quick Action Buttons
Located at the bottom of the thread. Primary actions (Add Order) use a solid fill; secondary actions (Attach, Record) use the ghost-border style with an icon and label.

### Thread/Reply Indicators
Vertical lines (2px width) on the left side of a message to indicate a threaded reply. These should be color-coded to the primary indigo to show connection without cluttering the UI.

### Checkboxes & Status Chips
Status chips use a "Badge" style: light background fill with dark text (e.g., Emerald-100 background with Emerald-800 text). This ensures they are visible but not as heavy as primary buttons.