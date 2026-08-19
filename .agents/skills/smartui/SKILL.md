# Canteen OS UI Engineering Skill

## Mission

Build production-grade Canteen OS interfaces with exceptional visual hierarchy, usability, responsiveness, accessibility, interaction quality, performance, and consistency.

The UI must look intentionally designed and product-specific, never like a generic AI-generated dashboard.

## Platform Classification

Before touching any file, classify the work.

Web:
React + TypeScript + shadcn/ui + Smart UI Community Edition.

Mobile:
Expo + React Native + TypeScript.

Shared:
API contracts, authentication, business logic, validation, types, and data models only. No UI framework.

If a change spans multiple platforms, separate shared logic from platform-specific presentation.

## Web UI Stack

shadcn/ui is the DEFAULT UI system.

Use shadcn/ui for:
Buttons
Inputs
Forms
Cards
Dialogs
Drawers
Sheets
Dropdowns
Menus
Tabs
Navigation
Tooltips
Command interfaces
Badges
Alerts
Typography
Layout primitives
General application UI
Design tokens

Use Smart UI Community Edition for specialized components where it provides meaningful functionality that shadcn/ui does not adequately provide, particularly advanced data-oriented or operational UI.

Smart UI Community Edition and shadcn/ui must coexist cleanly.

Do not use Smart UI Professional.
Do not use Smart UI Enterprise.
Do not use trial-only Smart UI functionality.
Do not introduce paid Smart UI dependencies.

Never use Smart UI Web Components inside the Expo application.

Do not use Smart UI merely because it exists when shadcn/ui is the better implementation.

Do not recreate a shadcn component with Smart UI without a technical reason.

Do not recreate Smart UI functionality with shadcn when the required Community Edition component already exists and is appropriate.

## shadcn Rules

Inspect the project's existing shadcn configuration before adding components.

Check:
components.json
package.json
lockfile
Tailwind version
existing components
aliases
theme variables
icon library
existing component customizations

Use the project's package manager.

Use the shadcn CLI when adding or inspecting shadcn components.

Before overwriting an existing customized component, inspect the diff first.

Preserve existing local customizations unless the requested change explicitly requires replacing them.

Do not manually fetch raw shadcn component files when the CLI can resolve the component.

Do not install components blindly.

Only install what the implementation actually requires.

## Smart UI Verification

Never assume a Smart UI feature exists in Community Edition.

Before using Smart UI:
Inspect the installed package version.
Verify the component exists in the installed Community Edition.
Verify the required functionality is supported.
Verify its current API and imports.

If the required functionality is Pro/Enterprise-only, do not use it.

Implement the equivalent with shadcn/ui, React, CSS, or existing application code.

Do not introduce a paid dependency to solve a UI problem.

## First Action

Before editing:

Identify the platform.
Inspect the actual repository.
Inspect package.json and lockfile.
Inspect existing UI components.
Inspect existing design tokens.
Inspect routing and layouts.
Inspect relevant feature components.
Inspect existing patterns for forms, tables, dialogs, drawers, navigation, loading, errors, and empty states.

Do not assume architecture or dependencies.

Once sufficient evidence exists, implement immediately.

Do not spend excessive time exploring alternatives that will not change the implementation.

## Design Quality

Every screen must have deliberate:

Visual hierarchy.
Information hierarchy.
Spacing.
Typography.
Alignment.
Interaction states.
Responsive behavior.
Accessibility.
Loading behavior.
Empty states.
Error states.
Success states.

Avoid generic SaaS-dashboard aesthetics unless the existing product specifically uses them.

Avoid excessive cards.
Avoid unnecessary gradients.
Avoid decorative UI without functional value.
Avoid excessive rounded containers.
Avoid tiny text.
Avoid excessive shadows.
Avoid inconsistent spacing.
Avoid random colors.
Avoid unnecessary animations.

Canteen OS should have a coherent visual language across the application.

## Design System

Use centralized design tokens.

Define and reuse tokens for:

Colors.
Typography.
Spacing.
Radius.
Borders.
Shadows.
Elevation.
Motion.
Breakpoints.
Component dimensions.

Prefer semantic tokens such as:

background
foreground
muted
border
primary
secondary
success
warning
danger
surface
surface-elevated

Do not scatter arbitrary color values throughout components.

Do not introduce one-off visual styles when an existing token or component can be reused.

## Typography

Use a deliberate type hierarchy:

Page title.
Section title.
Component title.
Body.
Secondary text.
Metadata.
Labels.
Numerical data.

Do not make every heading bold.

Do not make operational metadata unnecessarily small.

Prices, quantities, totals, counts, sales figures, and other numerical values must have clear visual hierarchy and consistent alignment.

## Layout

Use the appropriate layout system.

CSS Grid:
Structured multi-column layouts and dashboards.

Flexbox:
One-dimensional alignment and component composition.

Avoid absolute positioning for normal page layout.

Avoid unnecessary fixed heights.

Avoid layouts that break with long text or dynamic content.

Maintain consistent content widths and gutters.

Use an 8px-oriented spacing system unless the existing product system dictates otherwise.

## Responsive Design

Responsive design must be intentional.

Desktop:
Optimize for productivity, scanning, and multi-column workflows.

Tablet:
Reduce density while preserving operational functionality.

Mobile:
Optimize for touch, readability, vertical flow, and focused actions.

Never simply shrink a desktop dashboard onto a phone.

Dense desktop tables should become appropriate mobile structures such as:

Lists.
Expandable rows.
Sections.
Drawers.
Bottom sheets.
Focused detail views.
Conversation views.

## Mobile UI

Expo Mobile must use native React Native patterns.

Do not port Smart UI Web Components into Mobile.

Do not copy desktop web layouts into Mobile.

For operational or conversational workflows such as orders, tasks, notifications, staff communication, and kitchen communication, use messaging-app ergonomics where appropriate.

Conversation list:
Avatar or icon.
Title.
Latest activity.
Timestamp.
Unread state.
Status.

Conversation:
Message/event bubbles.
Timestamp.
Status indicators.
Contextual actions.
Quick actions.
Composer/action area.

Use Canteen OS branding and terminology.

Do not clone WhatsApp branding, assets, logos, or proprietary visual identity.

## Interaction Design

Every interactive component must have clear states:

Default.
Hover.
Focus.
Pressed.
Disabled.
Loading.
Success.
Error.

Buttons must communicate action hierarchy.

Use one visually dominant primary action per context.

Secondary actions should remain visually subordinate.

Destructive actions must be clearly distinguishable.

Do not make unrelated actions look equally important.

## Forms

Forms must have:

Visible labels.
Correct input types.
Logical grouping.
Inline validation.
Useful error messages.
Loading state.
Submit state.
Keyboard navigation.
Logical tab order.

Never rely on placeholders as the only field labels.

Do not ask users to re-enter information already available in application state.

## Tables and Data

Use tables when users need rapid comparison and scanning.

Tables should provide appropriate:

Column hierarchy.
Numerical alignment.
Row density.
Sorting.
Filtering.
Pagination or virtualization when required.
Sticky headers where useful.
Loading state.
Empty state.
Error state.

Do not add complex table functionality merely for visual sophistication.

For very large datasets, prioritize rendering performance.

## Operational UI

For POS, KDS, kitchen, staff, orders, inventory, tasks, and operational screens:

Prioritize speed of recognition and action.

Important information should be immediately visible.

Prioritize:
Order/task identity.
Status.
Quantity.
Time.
Priority.
Assigned person.
Required action.

Minimize unnecessary interaction steps.

Use large enough controls for rapid interaction.

Support keyboard workflows where appropriate on desktop.

Do not sacrifice operational efficiency for decorative design.

## Navigation

Users must always understand:

Where they are.
What section they are viewing.
What actions are available.
How to return or navigate elsewhere.

Use persistent navigation where the product requires it.

Use breadcrumbs only when hierarchical navigation benefits the user.

Avoid excessive nested navigation.

## Dialogs, Drawers, and Sheets

Use a dialog for focused decisions or short tasks.

Use a drawer/sheet for contextual workflows that should preserve the underlying page.

Use a dedicated page for large or complex workflows.

Do not put an entire application inside a modal.

Support:
Keyboard focus.
Escape.
Accessible labels.
Clear close action.
Loading.
Error handling.

## Feedback

Use the correct feedback mechanism.

Toast:
Short-lived confirmation.

Inline feedback:
Contextual validation or information.

Dialog:
Important decisions.

Banner:
Page-level or system-level conditions.

Do not hide critical information exclusively inside transient toasts.

## Animation

Animation must communicate state, hierarchy, or spatial relationships.

Use subtle, short transitions.

Animate:
Opening.
Closing.
Reordering.
Loading.
State changes.
Navigation.

Avoid decorative continuous animation.

Avoid excessive bounce effects.

Avoid animation that delays user interaction.

Respect reduced-motion preferences.

## Accessibility

Target WCAG 2.2 AA.

Ensure:

Semantic HTML.
Keyboard navigation.
Visible focus.
Accessible names.
Correct labels.
Logical heading hierarchy.
Sufficient contrast.
Accessible form controls.
Screen-reader-compatible interactions.
Appropriate touch targets.
No information conveyed only through color.

Never remove focus indicators without providing an accessible alternative.

## Component Architecture

Use the existing component architecture before creating new abstractions.

Prefer:

UI primitives
→ composed UI components
→ feature components
→ page composition

Create reusable components when the same visual structure or behavior is genuinely repeated.

Do not create abstractions prematurely.

Do not duplicate components with slightly different styling.

Keep business logic separate from presentation.

## State Architecture

Separate:

Server state.
UI state.
Form state.
Navigation state.

Use the existing application state architecture.

Do not introduce another state-management library unless genuinely required.

Do not duplicate server state unnecessarily.

## Shared Logic

Business rules must exist once.

Shared code owns:

Validation.
Business rules.
API contracts.
Types.
Data models.
Authentication rules.

Web and Mobile consume shared logic.

Do not reimplement business rules independently in Web and Mobile.

## Performance

Avoid unnecessary renders.

Virtualize genuinely large lists.

Lazy-load expensive features where appropriate.

Optimize image sizes.

Avoid unnecessary dependencies.

Avoid loading assets that are not needed.

Do not introduce premature optimization that damages maintainability.

## Visual Verification

After implementation, inspect the rendered UI.

Verify:

Alignment.
Spacing.
Typography.
Responsive behavior.
Overflow.
Long text.
Large numerical values.
Large datasets.
Loading states.
Empty states.
Error states.
Hover states.
Focus states.
Disabled states.
Small screens.
Large screens.

Fix visible defects before completion.

## Code Quality

Remove redundant code encountered during implementation.

Remove dead imports.

Remove unused components.

Remove duplicated styles.

Reuse existing components where appropriate.

Do not introduce unrelated dependencies.

Follow existing repository conventions unless they demonstrably conflict with this skill.

## Implementation Workflow

Classify.

Inspect.

Verify dependencies.

Verify shadcn configuration.

Verify Smart UI Community Edition capability where applicable.

Identify existing patterns.

Implement.

Remove redundant/dead code encountered during implementation.

Run relevant tests.

Run the relevant production/build verification.

Inspect the rendered result.

Fix defects.

Stop.

## Hard Restrictions

Never use Smart UI Professional.

Never use Smart UI Enterprise.

Never use trial-only Smart UI functionality.

Never use Smart UI Web Components in Expo Mobile.

Never replace working mobile architecture merely to match Web visually.

Never duplicate shared business logic.

Never install unrelated dependencies.

Never create documentation as part of implementation.

Never create README files.

Never create migration reports.

Never create architecture reports.

Never create changelogs.

Never spend excessive time on theoretical alternatives after the repository provides sufficient evidence.

## Definition of Done

The implementation is complete only when:

The correct platform technology was used.

shadcn/ui is used as the default Web UI system.

Smart UI Community Edition is used only where appropriate.

No prohibited Smart UI dependency was introduced.

The UI follows the existing Canteen OS design language.

The interface is responsive.

The interaction states are complete.

Loading, empty, error, and success states exist where relevant.

Accessibility requirements are satisfied.

The implementation reuses existing components appropriately.

Shared business logic remains shared.

Dead and redundant implementation code introduced or encountered during the change has been removed where safe.

Relevant tests pass.

Relevant build verification passes.

The rendered UI has been inspected and obvious defects have been corrected.

Stop after completing the implementation.
