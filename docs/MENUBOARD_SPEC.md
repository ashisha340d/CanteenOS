# MenuBoard — Product Requirements Document

This is the product-level specification: what MenuBoard is, who it is for, what it must
never become, and the product decisions that follow from that. For *how* the system is
built, see [ARCHITECTURE.md](./ARCHITECTURE.md); for the UI/UX bar, see
[DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md); for the wire contract, see [API.md](./API.md); for
the schema, see [DATABASE.md](./DATABASE.md). Phase-by-phase build instructions live under
[`/tasks`](../tasks).

## 1. What MenuBoard is

MenuBoard is an **operational collaboration platform** for catering operations, canteens,
temples, kitchens and event food service coordination.

Its single responsibility is **operational communication and order collaboration**: people
create boards, post orders describing what needs to be prepared or arranged, discuss those
orders in a thread, attach photos and voice notes, acknowledge that they've seen an order,
move it through status, and complete it — with everything synchronising between an Android
app used on the floor and a web Admin Portal used by management, and working fully offline
on Android.

It is **not** a POS, accounting system, inventory system, CRM or ERP.

Boards live inside **stations**: a `Station` (e.g. Barsana, Mangarh) is the physical site;
each `Board` (e.g. Canteen Board, Dining Hall Board, Prasad Ghar Board) belongs to exactly one
station. Board membership stays scoped to the board itself, never the station, so the same
person can be a member/manager of same-named boards at two different stations at once (e.g.
Canteen Board at Barsana and Canteen Board at Mangarh) with independent roles on each. See
DATABASE.md's Hierarchy section for the schema.

## 2. Who uses it

| Role | Uses | Primary surface |
| --- | --- | --- |
| Kitchen/floor staff, coordinators | Create/view/discuss/acknowledge orders on their boards | Android app |
| Board managers/owners | Same, plus manage board membership of their own boards | Android app only |
| Operations managers | Oversee boards and orders | Android app only |
| Admin | Users, masters, permissions, settings, billing, audit, reports, plus board member management across all boards | Admin Portal only |

Global roles: `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `USER`. Board membership roles: `OWNER`,
`MANAGER`, `MEMBER`, `VIEWER`. Both planes are enforced server-side from the single
capability matrix in `shared/src/permissions` — see ARCHITECTURE.md §7.

**Admin Portal sign-in is restricted to the `ADMIN` global role only** — Super Admin,
Manager, User and Employee accounts cannot sign in with `clientType: "ADMIN"` (enforced in
`AuthService.login`/`AuthService.refresh`, error code `ADMIN_ROLE_REQUIRED`). Super Admin
still holds the superset of capabilities in the permission matrix for API/data purposes,
but has no portal to exercise them from.

## 3. Hard exclusions — never implement

POS · sales · cashier · payments · receipts · taxes · inventory · purchase orders · Kitchen
Display System · accounting · ledger · CRM · customer loyalty · coupon engine · marketing ·
delivery management · QR ordering · table ordering · analytics beyond the seven named
reports (§6) · anything not in this document.

If a request maps to that list, it is out of scope — say so before writing any code. Do not
implement it "just in case," and do not build a generic abstraction whose obvious purpose is
to host one of them later.

### The Android exclusion is structural, not cosmetic

The Android codebase (`app/`) must contain **no module, screen, route, API client, store
slice or SQLite column** for: billing, pricing, taxes, accounting, reports, administration,
master maintenance (creating/editing/deleting stations, activity types, menu categories,
menu items), user management, permission management, or system configuration.

This is enforced server-side: `ANDROID_FORBIDDEN_CAPABILITIES` in
`shared/src/permissions/index.ts` is stripped from the token at login, so an Admin signed in
on the mobile app gets `CLIENT_NOT_PERMITTED` from those endpoints. Do not weaken that.
Android reads master data as a **read-only synchronised cache** and never originates a write
to it.

An **ad-hoc order line** is not an exception to this. When a dish has no master record yet,
the order carries the name as free text on its own line (`order_items.custom_item_name`);
no `menu_items` row is created, so the catalogue remains Admin-owned and the cache remains
read-only. If that dish becomes part of the standing menu, an Admin registers it in the
Admin Portal — the Android app never promotes an ad-hoc line into the catalogue.

## 4. Core objects and lifecycle

- **Board** — a workspace (e.g. a kitchen, an event) with members and orders.
- **Order** — a request for food/service on a board: activity, venue, pax, required
  date/time, priority, a list of order items (a catalogued menu item *or* an ad-hoc name
  typed on the spot, plus quantity + unit + notes + mentions), attachments, a discussion
  thread, and acknowledgements. Status transitions are validated server-side
  (`INVALID_STATUS_TRANSITION`).
- **Thread message** — append-only discussion on an order; `SYSTEM`-typed messages record
  status changes/acks/edits as history (there is no separate history table — see decision 2
  below).
- **Acknowledgement** — idempotent per `(order_id, user_id)`; records that a member has seen
  an order.
- **Attachment** — a photo or voice note, uploaded in two stages (row first, bytes async) so
  large media never blocks posting an order.
- **Notification** — server-generated, per-user, surfaced on both clients.
- **Master data** — stations, activity types, menu categories, menu items: Admin-managed,
  read-only everywhere else. An order may name a dish outside this catalogue (see "Order"
  above); doing so never adds to it.

## 5. Offline-first as a product requirement, not an implementation detail

The Android app must work with no connectivity: creating, editing and discussing orders,
attaching media, and acknowledging all work immediately and durably offline, and converge
across devices once connectivity returns. This drives real product decisions (client-
generated order numbers, no field-level merge on conflicting edits, append-only threads) —
see [ARCHITECTURE.md §6](./ARCHITECTURE.md#6-offline-first-contract-android) for the full
sync contract.

## 6. Reports — exactly seven

Orders by board · orders by date · orders by user · completed orders · pending orders ·
activity summary · billing export history. No eighth report exists anywhere in the product.

## 7. Billing — a snapshot, not a billing system

MenuBoard does not price, invoice, or manage payments. "Billing Generation" is a single
Admin-only, explicitly triggered, one-way action that freezes a snapshot of a board's
completed orders for a period into an immutable, auditable export record (see
[ARCHITECTURE.md §8](./ARCHITECTURE.md#8-billing-posture)). It never mutates the underlying
orders and never introduces a computed money total — there is no pricing model in this
system, and displaying one would imply there is.

## 8. Product decisions taken to satisfy hard requirements

These are settled; do not revisit them without a real new requirement forcing it.

1. **Order numbers are not server-sequential.** Offline creation is mandatory, so numbers
   are device-generated: `ORD-YYYYMMDD-XXXXXX` (Crockford base32 of the order UUID). Unique
   without coordination, stable from creation.
2. **Order History = system thread messages.** No dedicated history table exists in the
   specified SQLite schema, so status changes/acks/edits are `thread_messages` rows with
   `message_type = 'SYSTEM'` and replicate through the normal sync path.
3. **Mentions are JSON arrays** on `order_items` / `thread_messages` — no mention tables.
4. **Permissions are a code-defined capability matrix** (`shared/src/permissions`), not DB
   rows — no permissions table, and the four global roles / four board roles are fixed. The
   Admin Portal's Permissions page is a read-only viewer of this matrix, not an editor.
5. **Push tokens live on `refresh_tokens`** (already per-device) instead of a new table.
6. **Tables added beyond the originally specified lists:** `schema_migrations` and
   `sync_counter` (infrastructure), plus `settings` — the Admin Portal's "Settings"
   responsibility must persist somewhere.

## 9. Business rules worth knowing

Not obvious from the schema or API alone — don't reintroduce a bug by assuming otherwise:

- **A thread reply notifies thread participants** — prior authors plus the order creator —
  not every board member, which would be unusably noisy. Mentions always notify regardless.
  If the product wants all-members behaviour, that's a deliberate change to
  `ThreadService.post`, not a bug fix.
- **The first acknowledgement advances a `PENDING` order to `ACKNOWLEDGED` automatically**,
  so the board reflects that someone picked it up without anyone changing status by hand.
- **`COMPLETED` and `CANCELLED` are terminal.** A completed order cannot be edited or
  reopened; it stays visible on today's board with a Done treatment.

## 10. Acceptance bar

A feature is not done because the UI renders. It is done when: it matches this spec and the
architecture/API contracts exactly, it has no placeholder/mock/TODO code, it works against
the real backend end to end, and it respects every hard exclusion above. See the relevant
file under `/tasks` for the per-phase acceptance checklist.
