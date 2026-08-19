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

It is **not** an accounting system, inventory system, CRM or ERP.

As of the Menu Master extension (see §3a), MenuBoard *does* maintain a normalized, priced
menu catalogue — Menus, Menu Categories, Menu Items, Variants, Media, Counters, Printing
Groups, Modifiers and Schedules — and exposes it to POS/MenuBoard-class consumers over the
API. This is deliberately narrow: MenuBoard itself still does not take payments, print
receipts, run a cash drawer, manage inventory, or compute tax. Pricing exists so a menu can
state what something costs and an order line can preserve what it cost when it was sold;
nothing beyond that is in scope.

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

Sales/cashier UI · payments · receipts/printing hardware integration · a general ledger ·
accounting · CRM · customer loyalty · coupon engine · marketing · table ordering · analytics
beyond the seven named reports (§6) · anything not in this document.

Superseded by §3a: **pricing, a Menu Master, counters, printing-group routing, modifiers,
menu scheduling, and QR/web/app/delivery *visibility flags* on a menu item are now in
scope**, as the Menu Master extension.

Superseded by §3b: **a point of sale — a sales/cashier UI, payments, tax computation on a
bill, and an Entity master covering customers, employees and vendors — is now in scope**, on
the Admin Portal only. What remains excluded is receipt/printer and cash-drawer *hardware*
integration, a general ledger, accounting, customer loyalty, a coupon engine, marketing,
customer-facing table ordering, and inventory/stock levels. "Printing Groups" are still
routing metadata (e.g. "Kitchen", "Bar") for an external system to key off — MenuBoard does
not talk to a printer.

Superseded by §3d: **a guest ordering for themselves, at a fixed self-service kiosk standing
in the canteen hall, and paying for it by UPI, is now in scope** — as one more POS client,
not as a second POS. Ordering from a guest's *own* phone (table QR ordering), delivery
platforms, guest accounts and loyalty remain excluded.

If a request maps to what's still on this list, it is out of scope — say so before writing
any code. Do not implement it "just in case," and do not build a generic abstraction whose
obvious purpose is to host one of them later.

### 3a. Menu Master (extension)

`menu_items` (the pre-existing table) remains the **Food Item Master** — one row per dish,
never duplicated per menu. Layered on top, added in `backend/src/db/migrations/001_schema.sql`:

- **`menus`** — configurable named menus (e.g. a canteen's public menu, a function's
  members-only menu). Names/codes are data, never hardcoded enum values.
- **`menu_category_assignments`** — reuses a global `menu_categories` row per menu, with
  per-menu display overrides; never duplicates the category.
- **`menu_item_assignments`** — offers an existing `menu_items` (Food Item Master) row on a
  menu, with per-menu description/preparation method/visibility/channel availability. The
  Food Item Master itself is never modified by an assignment.
- **`menu_item_variants`** — the actual sellable configuration and price (e.g. "Tiny ₹30",
  "Large ₹100" for the same food item on different menus). Zero, one or many per assignment.
- **`media_assets` / `media_assignments`** — a reusable image library (title/alt
  text/dimensions/checksum) linked to Menu/Category-assignment/Item-assignment/Variant rows
  by a polymorphic `(entity_type, entity_id)` pair, mirroring `attachments.owner_type` /
  `owner_id`. An asset is never duplicated for reuse and is refused deletion while any
  assignment still references it.
- **`counters` / `counter_routes`**, **`printing_groups` / `printing_routes`** — operational
  routing metadata for a menu item or variant. Never attached to the Food Item Master
  directly, and never a physical printer/counter driver.
- **`modifier_groups` / `modifiers` / `modifier_assignments`** — "Extra Cheese", "No Onion",
  etc., assignable to a menu item or variant.
- **`menu_schedules`** — configurable day-of-week/time-window availability per menu. Nothing
  named "Morning"/"Evening" is hardcoded; those are ordinary `menus` rows.
- **`order_items`** gained `menu_id`, `variant_id`, `variant_name`, `unit_price`,
  `tax_amount`, `discount_amount`, `line_total` — a snapshot of the sellable configuration
  frozen at the moment the line was created. Changing a menu/variant later (price, name,
  even deleting the menu) can never alter an existing order line; the FKs are `ON DELETE
  RESTRICT` precisely so a historical reference cannot be silently orphaned.

All of the above is Admin Portal / MASTER_WRITE-gated, exactly like the pre-existing menu
category/menu item CRUD it extends — nothing here weakens `ANDROID_FORBIDDEN_CAPABILITIES`
(§3, "The Android exclusion is structural, not cosmetic" still holds; Android gets no
pricing/master-maintenance UI as part of this extension). A resolved read API
(`GET /api/v1/menus/by-code/:code/tree`) exists for POS/MenuBoard-class *external* consumers
to fetch one published menu's full category → item → variant tree with resolved media,
without needing to understand the relational model.

### 3b. Point of Sale and the Entity master (extension)

Added in `backend/src/db/migrations/001_schema.sql`. The POS is an Admin-Portal
surface; the Android app gains nothing from this extension.

- **`entities`** — the party master. One row per customer, employee, vendor or other body,
  discriminated by `type`. Deliberately **one** table: the same person is routinely a
  customer at the counter and an employee on the payroll, and three parallel tables would
  duplicate them and lose the link. Carries a standing `discount_percent`, a `credit_limit`
  and a running `account_balance` that only ACCOUNT settlements and their reversals move.
  An EMPLOYEE row may point at the login account of the same person via `linked_user_id`.
- **`pos_orders` / `pos_order_items` / `pos_payments`** — the till. A POS ticket is a
  different object from an operational `orders` row: no board, no activity, no pax
  requirement, no offline origin. `order_type` is the fulfilment (dine-in / takeaway /
  delivery / quick sale); "named" is derived from whether an entity or an entity name is on
  the ticket, so the two are orthogonal and a scheduled delivery for a named customer shows
  under both. `status` is DRAFT → SCHEDULED → OPEN → COMPLETED, with CANCELLED available
  throughout.
- **Bill numbers *are* server-sequential** (`POS-YYYYMMDD-NNNN`, reset per business date),
  unlike order numbers. Decision 1 below forced device-generated order numbers because
  offline creation is mandatory; a till is online by definition, and a counter has to hand
  the customer a countable number.
- **Money is resolved server-side, never accepted from the client.** A line arrives as a menu
  item, a variant and a quantity; `PosService` resolves the price from the Menu Master
  (per-menu catalogue price → variant price → base price) and the tax from the line's tax
  profile (§3a/021), then freezes every amount onto the line. Rounding happens exactly once,
  at the bill total.
- **The payment ledger is append-only.** A settled bill is never edited; `void` writes
  offsetting negative `pos_payments` rows and leaves the originals in place.
- Capabilities: `ENTITY_READ`/`ENTITY_WRITE` and `POS_READ`/`POS_OPERATE`/`POS_CHECKOUT`/
  `POS_VOID`, seeded into `role_capabilities` by 022. A counter operator is an ordinary
  `USER`; registering a party and reversing a settled sale start at `MANAGER`.

Still excluded, and not made reachable by this extension: printer/cash-drawer hardware, a
general ledger, accounting, loyalty, coupons, and inventory.

### 3c. Equipment Monitoring & Maintenance Management (extension)

Added in `backend/src/db/migrations/001_schema.sql`. Unlike §3a and §3b, this
extension reaches **both** clients and reaches further down the roster than any other module:
the person standing in front of a broken oven is the person who must be able to report it.

- **One module, not two.** An equipment record and its maintenance history are the same
  object seen from two angles. Every maintenance row hangs off `equipment.id`, and a ticket
  derives its asset id, location and supplier from the equipment rather than restating them.
- **Low data entry is architectural, not UI polish.** Opening a ticket requires an
  `equipmentId` and nothing else; the asset id, location, supplier, priority, reporter and
  timestamps are all resolved server-side. `captured_via` records which path a row came in
  through, so the module can be measured against its own premise.
- **AI proposes, the user disposes.** Photograph→identification, document→OCR and
  text/voice→problem classification return `*Draft` types that are never persisted on their
  own; they are confirmed (and editable) before they become records, and
  `maintenance_problems` keeps the AI's suggestion beside the human's confirmation. **An
  automatic technical diagnosis nobody confirmed is never produced.** With `GEMINI_API_KEY`
  unset the three AI endpoints refuse with a clear message and every other part of the module
  — registration, reporting, scheduling, supplier contact — works unchanged.
- **No IoT dependency.** `equipment.status` is a human/workflow column set by people and by
  the ticket lifecycle. `telemetry_device_id` is a nullable string that nothing reads, so a
  sensor can be associated with an asset later without a schema change. There is deliberately
  **no telemetry table**: storing readings nobody consumes would be exactly the "generic
  abstraction whose obvious purpose is to host a future feature" this section forbids.
- **Asset ids are server-allocated** — `MTC-KIT-OVN-001` = prefix · area segment · category
  segment · sequence, with the prefix and sequence width configurable through `settings`.
  **Ticket numbers are server-sequential** (`MTK-YYYYMMDD-NNNN`) for the same reason POS bill
  numbers are: a ticket is raised online and quoted to a supplier over the phone.
- **Files reuse the `media_assets` library** (§3a/012) through link tables, served by the
  existing signed-URL route. The module adds no second blob store, and `attachments` (001) is
  not reused because it is board-scoped while equipment belongs to no board.
- **Audit stays in one place.** There is no `equipment_audit_logs`; the global `audit_logs`
  records every mutation. `maintenance_activities` is a different thing and both exist: it is
  the operator-facing timeline, written as prose at write time, while `audit_logs` remains the
  security record.
- **Derived state is never stored.** Warranty status is computed from the expiry date on every
  read; ticket counters, next-service dates and warranty expiry are recomputed from their
  source tables inside the transaction that changed them, never incremented.
- **Floor-plan coordinates are fractions (0..1), never pixels**, so a plan re-uploaded at a
  different size keeps every pin where it was.
- **Suppliers link to the Entity master** (§3b) through a nullable `entity_id` rather than
  duplicating it, and the WhatsApp/call wording is composed server-side so the phone and the
  portal cannot word the same request differently. Nothing is *sent* by the server: it returns
  a `wa.me` link the client opens, and records that it did.
- **Two audiences, deliberately unequal** (seeded by 025, corrected by 028 — the grants in
  `role_capabilities` and in `shared/src/permissions/index.ts` must always agree):
  - **Monitoring and managing is Manager and Admin.** `equipment.view` and everything above it
    — the register, the dashboard, floor plans, the location and category masters, timelines,
    schedules, the supplier master and supplier contact — is an office job.
  - **Reporting is User and above.** `equipment.report_problem` grants exactly two reads —
    resolve one machine by its QR code or asset id, and read that machine, both returning a
    payload trimmed to its identity and the problems already open against it — plus the media
    upload that carries the photo or video of the fault, and `maintenance.create` /
    `maintenance.view` to open the ticket and follow it. It grants **no** way to browse the
    estate: a reporter sees the machine in front of them and no other.
  - **An Employee holds no part of the module.** They carry out work handed to them; a fault
    report opens a ticket somebody is then accountable for.
  - Deleting an asset or a ticket — which erases its history — is **Admin**.
  - `ANDROID_FORBIDDEN_CAPABILITIES` stays empty, so the whole module is reachable from the
    phone: a Manager gets the monitoring surface there, a User gets scan-and-report.
- **A fault report carries photos *and* video.** `MEDIA.VIDEO_MIME_TYPES` is accepted by this
  module's upload endpoint alone — not by `attachments` (001) and not by the Menu Master media
  library — because a noise, a leak or a flame that will not hold cannot be photographed.

Still excluded, and not made reachable by this extension: IoT ingestion and telemetry storage,
a spare-parts inventory, purchase orders, depreciation and asset accounting, and any automatic
technical diagnosis that a human has not confirmed.

### 3d. Self-service ordering kiosk (extension)

The `CustomerKiosk/` workspace: a guest-facing web app run full-screen in a tablet browser
(kiosk mode) on a stand in the hall. A guest reads the menu, builds an order, pays by UPI and
takes a printed GST bill with their token number. Nobody signs in; nobody stands behind it.

- **It is a POS client, not a second POS.** The kiosk writes the same `pos_orders` /
  `pos_order_items` / `pos_payments` rows through the same `PosService`, over the same
  `POST /pos/orders` and `POST /pos/orders/:id/checkout` endpoints the counter uses. There
  are no kiosk tables, no kiosk pricing path and no second tax engine. Money and tax are
  still resolved server-side from the Menu Master and the line's tax profile (§3b), so a
  tablet in a public hall cannot sell a thali for one rupee. A kiosk sale is an ordinary
  TAKEAWAY ticket and appears on the POS dashboard beside the counter's own.
- **The kiosk session is default-deny.** `ClientType.KIOSK` exists alongside `ANDROID` and
  `ADMIN`, and its capabilities are *intersected with an allowlist* —
  `KIOSK_ALLOWED_CAPABILITIES` = `MASTER_READ`, `POS_READ`, `POS_OPERATE`, `POS_CHECKOUT` —
  rather than filtered through a denylist. The polarity is the opposite of the Android rule
  on purpose: a phone is held by an identified member of staff, a kiosk is unattended
  furniture, and the token on it must be assumed readable by whoever picks the device up.
  Administrative accounts are refused a kiosk session outright, on login *and* on refresh.
- **One published menu, one screen.** The kiosk reads
  `GET /menus/by-code/:code/tree` for the menu named in its own configuration and renders
  every visible item in a single scrolling view, grouped by category but never gated behind a
  category drill-down: a guest must be able to see the whole canteen at once. Availability
  and the per-menu visibility flags (§3a) decide what appears; nothing is hidden in kiosk
  code that the Admin Portal did not hide in the data.
- **The estimate is data, not decoration.** "Ready in ~14 min · 7:42 PM" is computed from
  `preparation_time_minutes` on the item/variant, which the resolved tree now carries. Where
  the Menu Master states no preparation time, the kiosk shows no promise.
- **UPI is the only tender, and the QR is a demo until a gateway exists.** The kiosk composes
  a standard `upi://pay` intent and renders it as a QR. No payment gateway is integrated, so
  settlement is not verified with a bank — the demo path is explicitly flagged in the UI and
  behind `VITE_KIOSK_DEMO_PAYMENT`. Whatever replaces it must settle through the same
  checkout endpoint and record an ordinary `UPI` `pos_payments` row; it must not grow a
  second settlement path. Cash, card and account tender stay at the staffed counter.
- **The bill is printed by ESC/POS, and the hardware exclusion is now bounded rather than
  absolute.** MenuBoard drives exactly one class of device — a thermal receipt printer — and
  only ever to print a bill for a sale it has already settled. There are two routes and they
  emit the same bytes, because the encoder and the bill composer live in
  `@menuboard/shared`: the kiosk writes to a printer attached to its own tablet over WebUSB,
  and the backend writes to a networked counter printer over RAW/9100. Which one a stand
  tries first is a field on its row in the registry; the other is the fallback.
  - There is **no third route**. An HTML rendering printed through the browser's own dialog
    existed and was removed rather than demoted: it produced an approximation of a tax
    document on whatever paper the tablet's default printer held, took seconds to rasterise,
    and raised a modal an unattended guest could not dismiss. Worse than any of those, it
    made a misconfigured stand look like a working one. A stand either drives a printer as a
    printer or prints at the counter.
  - The printer's **destination is never named by the client**. The network route prints to
    the host in `pos.printer_host`; accepting one from a tablet in a public hall would make
    the endpoint an arbitrary outbound TCP connection with the server's network position.
  - Receipts are **Latin-only**. A thermal printer has no Devanagari glyphs and cannot be
    taught any, so the bill stays in English — which is also what a tax document should be.
  - Still excluded: cash drawers, customer displays, weighing scales, card terminals, label
    printers, and any device MenuBoard would have to *read* from.
- **A settled bill may be sent to the guest's own WhatsApp.** Over Meta's WhatsApp Cloud API,
  as an approved template, to a number the guest types on the kiosk's own number pad after
  paying. It is optional at three levels and silent at all of them: unset credentials, the
  `kiosk.whatsapp_bill_enabled` setting, and the guest declining. This is not messaging —
  MenuBoard gains no inbox, no conversation and no way to reach a guest again; it sends one
  copy of one document the guest asked for, and audits that it did.
- **How a kiosk looks is the organisation's decision, not the device's.** Skin
  (`kiosk.skin`, four of them), language (`kiosk.language_mode` — English, हिंदी, or both at
  once), the greeting (`kiosk.greeting` / `kiosk.greeting_hi`), whether the kiosk may suggest
  a drink or a sweet before payment (`kiosk.recommendations`), the idle timeout, the receipt
  width and footer, and the **billing identity** (`organisation.legal_name`,
  `organisation.address_line`, `organisation.gstin`) are set once in the Admin Portal and read
  by every kiosk from `GET /pos/kiosk-profile`. A GSTIN is a registration, and four tablets in
  one hall must not be able to issue bills under four different ones. A guest may switch the
  language for their own order; the kiosk drops that choice on reset.
- **A stand is a row, not a browser's local storage.** `kiosk_devices` holds every
  self-service stand — its code, its menu, its station, its payee VPA, its printer route, and
  the order it shows categories in — and is edited in the Admin Portal under **Kiosks**. The
  tablet's entire local state is the *code* of the stand it is standing at; it quotes that on
  `GET /pos/kiosk-profile?device=CODE` and is told everything else. This is what makes a hall
  of six stands administrable: the settings can be compared side by side, changing them is
  audited (`kiosk.device.*`), and re-pointing the hall at a festival menu is one edit rather
  than six walks. A stand deleted or deactivated unbinds its tablet at the next poll.
  - The **one thing that cannot move to the portal** is the WebUSB grant: a browser hands a
    USB device only to a gesture made on the machine it is plugged into. Pairing therefore
    stays on the tablet's staff screen, which is otherwise reduced to picking the stand.
  - The **category order is a per-stand override**, not a replacement for the menu's own
    `sort_order` — anything the operator did not place falls to the end in the menu's order,
    so adding a category in the Menu Master can never make dishes invisible at a stand
    nobody remembered to re-sort.
  - The kiosk's category rail **filters and never persists**. Every guest arrives on "All";
    a stand that opened on the previous guest's filter would show the next person a menu with
    most of it missing and no way to know that is what they were looking at.
- **The kiosk never reverses anything.** No void, no refund, no edit after settlement. A
  mistake is handled by staff in the Admin Portal, which holds `POS_VOID`.

Still excluded, and not made reachable by this extension: ordering from the guest's own phone
(table/QR ordering), delivery platforms, guest accounts, loyalty, coupons, promotional
content, cash or card tender at the kiosk, and hardware integration beyond the receipt
printer described above.

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
- **Menu Master** — see §3a: menus, menu category/item assignments, variants (with price),
  media library, counters, printing groups, modifiers, schedules. Admin-managed, exposed
  read-only to POS/MenuBoard-class consumers.
- **Equipment** — see §3c: a physical asset with a server-allocated asset id, a location on
  the floor/area/location tree, a human-set status, documents, warranties, supplier links and
  preventive schedules. Its maintenance tickets and their operator timeline are part of the
  same object, not a separate system.
- **POS ticket** — see §3b: a counter sale with server-sequential bill number, frozen line
  amounts and an append-only payment ledger. A kiosk sale (§3d) is one of these, raised by
  the guest instead of by an operator; there is no separate kiosk order object.

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

MenuBoard does not invoice or manage payments. "Billing Generation" is a single Admin-only,
explicitly triggered, one-way action that freezes a snapshot of a board's completed orders
for a period into an immutable, auditable export record (see
[ARCHITECTURE.md §8](./ARCHITECTURE.md#8-billing-posture)). It never mutates the underlying
orders. The Menu Master extension (§3a) does introduce prices — on `menu_item_variants`, and
frozen per-line on `order_items` at sale time — but `billing_exports` itself is unchanged:
it still snapshots order/pax counts, not a computed money total. Building an invoice/payment
total out of the new price fields remains out of scope.

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
