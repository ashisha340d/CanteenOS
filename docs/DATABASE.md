# Database Design

- **MariaDB is the master.** Schema: [`backend/src/db/migrations/001_schema.sql`](../backend/src/db/migrations/001_schema.sql).
- **SQLite is the Android render source.** Schema: [`sqlite-schema.sql`](./sqlite-schema.sql).

Both files carry the per-table rationale inline. This page records only the cross-cutting
rules.

## Universal column contract (MariaDB)

| Column | Purpose |
| --- | --- |
| `id CHAR(36)` | UUID v4, client-generatable so offline devices create complete entities |
| `created_at` / `updated_at DATETIME(3)` | UTC, written explicitly by the application |
| `deleted_at DATETIME(3) NULL` | Soft delete — deletes must replicate to offline devices as tombstones |
| `revision INT UNSIGNED` | Bumped per server-applied update; drives `STALE_WRITE` |
| `sync_seq BIGINT UNSIGNED` | Global monotonic cursor; delta pull is `WHERE sync_seq > :cursor` |

## The sync cursor

A single-row `sync_counter` table is the allocator:

```sql
UPDATE sync_counter SET value = LAST_INSERT_ID(value + 1) WHERE id = 1;
SELECT LAST_INSERT_ID();
```

Atomic, row-locked, and portable across MariaDB and MySQL (MariaDB `SEQUENCE` objects were
avoided for that reason). Every insert and update writes the allocated value into the row's
`sync_seq`, **inside the same transaction as the write**. That makes the cursor a total
order over all changes, so a device can resume a pull from any point without missing or
duplicating rows — which a `updated_at`-based cursor cannot guarantee under concurrent
writes.

## Soft delete and unique keys

Unique keys ignore `deleted_at`, so a soft-deleted `username` stays reserved. Two tables
would break under that rule if they used tombstones, so they use status transitions
instead and reuse the same row on re-add:

- `board_members` — `status = 'REMOVED'`, `UNIQUE (board_id, user_id)`
- `acknowledgements` — `UNIQUE (order_id, user_id)`, idempotent upsert

## JSON columns

`LONGTEXT` with a `JSON_VALID` check rather than the `JSON` type, so the schema applies
cleanly to both MariaDB and MySQL. Used for `mentioned_user_ids`, `system_meta`,
`notifications.data`, audit `before_data` / `after_data`, the billing `snapshot`, and
`settings.value`.

## Hierarchy

`Station -> Board`. A `Station` (e.g. Barsana, Mangarh) is the physical site; a `Board`
(e.g. Canteen Board, Dining Hall Board, Prasad Ghar Board) belongs to exactly one station
(`boards.station_id`, `NOT NULL`, `RESTRICT` on delete). Board names are **not** globally
unique — the same board name can exist at two different stations, since membership
(`board_members`) is scoped to the board id, not the name. This is what lets one user hold an
independent role on "Canteen Board" at both Barsana and Mangarh at the same time.

`ActivityType` remains a global master list, independent of both `Station` and `Board`.

## Referential rules

| Relationship | On delete | Why |
| --- | --- | --- |
| `boards.station_id` → `stations` | RESTRICT | A board must never be orphaned from its station; move or archive its boards before deleting a station |
| `orders.board_id` → `boards` | RESTRICT | An order must never be orphaned from its board |
| `order_items.order_id` → `orders` | CASCADE | Items have no life outside their order |
| `order_items.menu_item_id` → `menu_items` | RESTRICT / RESTRICT (on delete / on update) | Master data in use cannot be hard-deleted; deactivate instead. Narrowed from `ON UPDATE CASCADE` by migration 008 for the same reason as `orders.activity_type_id` below — the column is nullable and covered by `ck_order_items_dish`. |
| `thread_messages.board_id` → `boards` | CASCADE | Every message lives on a board feed |
| `thread_messages.order_id` → `orders` | CASCADE | When set, the message is about that order; NULL means a general board post |
| `attachments.owner_id` | no FK | Polymorphic owner; also nullable so media can be uploaded before its owner is pushed |
| `billing_exports.board_id` → `boards` | SET NULL | A snapshot must survive board deletion |
| `audit_logs.actor_id` → `users` | SET NULL | Audit rows are append-only and outlive users |
| `orders.assigned_to` → `users` | SET NULL | Who owns getting the order done, added in migration 009. Unlike `created_by`'s RESTRICT, an unassigned order is an ordinary state, so deleting a user returns their work to the pool rather than blocking the delete |
| `orders.activity_type_id` → `activity_types` | RESTRICT / RESTRICT (on delete / on update) | Not `SET NULL`: MariaDB refuses a `CHECK` constraint over a column whose FK can modify it, and `ck_orders_activity_present` is the more valuable guarantee. Harmless in practice — activity types are soft-deleted and UUID keys never change. **If you add a `CHECK` constraint over a nullable FK column, that FK must use `RESTRICT`/`NO ACTION`** — verified against MariaDB 10.6.27. |

`LONGTEXT` + `JSON_VALID` (see above) is used instead of the native `JSON` type for
MySQL/MariaDB portability; the driver returns strings, and `utils/json.ts` is the only place
that converts them.

## Ad-hoc order lines

`order_items` names its dish in exactly one of two ways, enforced by `ck_order_items_dish`
(migration 008):

| `menu_item_id` | `custom_item_name` | Meaning |
| --- | --- | --- |
| set | `NULL` | A catalogued dish, joined to `menu_items` |
| `NULL` | set | An ad-hoc dish typed on the order |

Ad-hoc lines exist because a kitchen cannot wait for an Admin to register a master record
mid-service. They are **order-scoped free text and never create a `menu_items` row**, so the
Android master cache stays read-only (`docs/MENUBOARD_SPEC.md` §3).

Consequences elsewhere, all deliberate:

- **Shopping lists** cannot explode an ad-hoc line into ingredients — it has no recipe — so
  `ShoppingListService` reports it under `missingRecipes` rather than dropping it silently.
- **Billing** joins `menu_items` with a `LEFT JOIN`, not `INNER`, or the line would vanish
  from the invoice. It bills under its typed name in the `Custom items` category.
- **Recipes** are unavailable for such a line, so the recipe sheet does not open for one.

## Android-side differences

The SQLite schema adds local-only columns (`sync_state`, `sync_error`, `server_sync_seq`,
`local_path`, `upload_state`, `upload_attempts`) and the `sync_queue` outbox. It contains
**no** billing, reporting, audit, permission or system-configuration tables — the Android
app has no such responsibility.

## Migrations

Forward-only `.sql` files in `backend/src/db/migrations`, applied in filename order by
`npm run migrate --workspace @menuboard/backend`. Each applied file is recorded in
`schema_migrations` with a SHA-256 checksum; a changed checksum aborts the run rather than
silently diverging.

The pre-deployment `001`..`039` series was squashed into a single `001_schema.sql` — the
tables plus the reference rows those files seeded, generated from a database built by applying
them in order. `backend/scripts/squash-migrations.ts` is what produced it and re-proves the
result; `backend/scripts/stamp-baseline.ts` repoints an already-migrated database at the
baseline. Nothing is squashed again once there is production data: from `002` on, every
schema change is a new file.

**When a role, status or type gains a member, widen every enum that lists it.** 003 added
`EMPLOYEE` to `users.role` but left the copy in `audit_logs.actor_role`; under
`STRICT_TRANS_TABLES` the out-of-range value aborted the audit INSERT, and because that row is
written on the caller's connection it took the whole transaction with it — an EMPLOYEE could
not start a task or even log in, since `auth.login` is audited too.
`030_audit_actor_role_employee.sql` closes it.

## Menu Master (012_menu_master.sql)

See [MENUBOARD_SPEC.md §3a](./MENUBOARD_SPEC.md#3a-menu-master-extension) for the product
framing. `menu_items` (Food Item Master) and `menu_categories` (global category master) are
unchanged by this migration — everything below only *references* them:

`menus` → `menu_category_assignments` (→ `menu_categories`) and `menu_item_assignments`
(→ `menu_items`) → `menu_item_variants`. Media (`media_assets` / `media_assignments`),
routing (`counters`/`counter_routes`, `printing_groups`/`printing_routes`) and
(`modifier_groups`/`modifiers`/`modifier_assignments`) attach to a `menu_item_assignment` or
`menu_item_variant` via a polymorphic `(entity_type, entity_id)` pair — the same pattern
`attachments.owner_type`/`owner_id` already uses, chosen for consistency rather than a
strongly-typed join table per entity kind. `menu_schedules` attaches to a `menu`.

`order_items` gained `menu_id`, `variant_id`, `variant_name`, `unit_price`, `tax_amount`,
`discount_amount`, `line_total`, all nullable/defaulted so pre-existing rows and non-catalog
(ad-hoc) lines are unaffected. Both new foreign keys are `ON DELETE RESTRICT`, matching the
existing `fk_order_items_menu_item` convention: nothing in this schema is ever hard-deleted
(soft delete only), so the constraint exists purely as a guarantee, never expected to fire.

## Entities and Point of Sale (022_entities_and_pos.sql)

See [MENUBOARD_SPEC.md §3b](./MENUBOARD_SPEC.md#3b-point-of-sale-and-the-entity-master-extension)
for the product framing.

`entities` is a **single** party master discriminated by `type`
(`CUSTOMER`/`EMPLOYEE`/`VENDOR`/`OTHER`), not three tables: the same person is routinely a
customer at the counter and an employee on the payroll. `code` is server-allocated per type
(`CUS-0001`, `EMP-0001`, …) from `MAX(...) FOR UPDATE` inside the inserting transaction, and
is unique across every type. `account_balance` is maintained *only* by `ACCOUNT` settlements
and their reversals, always in the same transaction as the `pos_payments` row that moved it.

`pos_orders` → `pos_order_items` (`ON DELETE CASCADE`) and `pos_payments` (`ON DELETE
CASCADE`). Catalogue references (`menu_id`, `menu_item_id`, `variant_id`, `tax_profile_id`)
and the party reference (`entity_id`) are all `ON DELETE RESTRICT`, so a historical bill can
never be orphaned.

Three things differ from the rest of the schema, deliberately:

- **No `sync_seq`, and no `sync_counter` allocation.** Like `tax_profiles` (021) and
  `youtube_recipe_imports` (011), these are counter/Admin-Portal tables that never replicate
  to Android. `pos_orders.revision` exists but is *optimistic concurrency only* (two
  terminals on one ticket → `STALE_WRITE`); it is not a sync cursor.
- **Bill numbers are server-sequential**, `POS-YYYYMMDD-NNNN`, guarded by
  `uq_pos_orders_daily_sequence (business_date, daily_sequence)` and allocated under
  `SELECT … FOR UPDATE`. This is the opposite of `orders.order_number` (device-generated,
  see MENUBOARD_SPEC decision 1) because a till is online by definition.
- **Four foreign keys say `ON UPDATE RESTRICT` where the rest of the schema says CASCADE**
  (`pos_orders.entity_id`, `pos_order_items.menu_item_id`, `pos_payments.entity_id`).
  MariaDB refuses a `CHECK` constraint on any column whose foreign key carries a cascading
  referential action, and these columns appear in `ck_pos_orders_quick_sale_anonymous`,
  `ck_pos_order_items_dish` and `ck_pos_payments_account_named`.
  `008_ad_hoc_order_items.sql` already made the same trade for the same reason. Primary keys
  are UUIDs and are never updated, so the two actions are indistinguishable in practice.

Money is `DECIMAL(14,2)` throughout and rates are `DECIMAL(6,3)`, matching `tax_profiles`.
Every amount on `pos_order_items` is a frozen snapshot written by `PosService`; the client
never supplies one for a catalogue line.

## Equipment & Maintenance (025_equipment_maintenance.sql)

See [MENUBOARD_SPEC.md §3c](./MENUBOARD_SPEC.md#3c-equipment-monitoring--maintenance-management-extension)
for the product framing. 23 tables, one module:

```
equipment_floors ─< equipment_areas ─< equipment_locations ─< equipment
equipment_categories ────────────────────────────────────────┘
        equipment ─< equipment_documents · equipment_warranties ·
                     equipment_supplier_links >─ equipment_suppliers ─< supplier_contacts
                                                                    └─< supplier_service_categories
                  ─< maintenance_schedules ─< maintenance_tickets
                                                   ├─< maintenance_problems
                                                   ├─< maintenance_attachments
                                                   ├─< maintenance_assignments
                                                   └─< maintenance_activities
                  ─< equipment_status_history · equipment_location_history
                  ─< equipment_call_logs · equipment_whatsapp_logs
equipment_floors ─< floor_plans ─< floor_plan_equipment_positions >─ equipment
```

Decisions that differ from the rest of the schema, deliberately:

- **No `revision`/`sync_seq` anywhere.** Like tasks (023) and entities/POS (022), the module is
  REST-served to both clients and takes no part in the Android delta-sync engine.
- **No telemetry table.** `equipment.status` is a human/workflow column;
  `equipment.telemetry_device_id` is a nullable string nothing reads, so a sensor can be
  associated with an asset later without a schema change. Storing readings nobody consumes
  would be the speculative abstraction MENUBOARD_SPEC §3 forbids.
- **No `equipment_audit_logs`.** The global `audit_logs` records every mutation.
  `maintenance_activities` is a *different* table and both exist: it is the operator-facing
  timeline, whose `summary` is prose composed server-side at write time so the phone and the
  portal can never word the same event differently.
- **Files reuse `media_assets` (012)** through `media_id` link columns —
  `equipment_documents`, `maintenance_attachments`, `floor_plans`. `attachments` (001) is not
  reused: it is board-scoped and sync-replicated, and equipment belongs to no board.
- **Counters are recomputed, never incremented.** `equipment.open_ticket_count`,
  `critical_ticket_count`, `next_maintenance_at`, `last_maintenance_at` and `warranty_expiry`
  are refreshed from their source tables inside the transaction that changed them
  (`EquipmentRepository.refresh*`). "Open" means `status NOT IN ('CLOSED','CANCELLED')`, so a
  RESOLVED-but-unverified ticket still counts even though the asset is back in service.
- **Warranty *status* is never stored** — only `warranty_expiry`, from which
  `warrantyStatusFor()` derives the status on every read.
- **Asset ids and ticket numbers are server-allocated.** `equipment.asset_id`
  (`MTC-KIT-OVN-001`) comes from the area and category `asset_segment` columns plus the
  `equipment.assetIdPrefix` / `equipment.assetIdSequenceDigits` settings, read `FOR UPDATE`;
  `maintenance_tickets` carries `(business_date, daily_sequence)` with a unique key, exactly
  like POS bill numbers and for the same reason.
- **Floor-plan coordinates are `DECIMAL(6,5)` fractions** with a `CHECK` bounding them to
  0..1, never pixels.
- `notifications.type` was extended in place with nine maintenance kinds rather than adding a
  parallel notification table, so there is one inbox and one delivery path.

Two follow-up migrations belong to the same module:

- **`028_equipment_role_scope.sql`** — data only, no DDL. It re-seeds `role_capabilities` so
  monitoring and managing sit at MANAGER and above, reporting at USER and above, and an
  EMPLOYEE holds no part of the module. `PermissionsCacheService` serves these rows as
  authoritative, so they must stay in step with `shared/src/permissions/index.ts`.
- **`029_media_audio_type.sql`** — `media_assets.media_type` gains `AUDIO`. 012 created the
  library for images; equipment voice notes had no honest member and were being written as
  `VIDEO`, which stopped being tolerable once fault clips made that value real. Existing rows
  are left untouched, because a pre-029 `VIDEO` row cannot be reclassified without guessing.
- **`031_kiosk_devices.sql`** — `kiosk_devices`, the self-service stand registry. Each row is
  one stand: `code` (what the tablet stores and quotes, unique), `label`, `menu_code`,
  `station_id`, the on-screen names, the UPI payee, `receipt_transport` (`USB`/`NETWORK` —
  there is no browser route), `category_order`, `status`, and `last_seen_at`.
  - **No `sync_seq`.** A kiosk stand is Admin Portal configuration, never an entity the
    Android app caches, so it stays out of the sync ledger the same way `settings` does.
  - `category_order` is **JSON, not a join table**, holding `menu_category_assignments.id`
    values. It is an ordering preference of a presentation surface rather than a
    relationship, and it is read as a filter over whatever the menu currently holds — ids the
    menu no longer has are ignored, and categories the list does not mention fall to the end
    in the menu's own order. That asymmetry is the point: adding a category in the Menu Master
    must never make dishes invisible at a stand nobody remembered to re-sort.
  - `last_seen_at` is written on profile reads **without bumping `revision`**. A stand being
    switched on is not an edit to its configuration, and treating it as one would make every
    row in the portal look freshly changed once a minute.

## Digital Menu Board screens (032_menu_board_screens.sql)

One table, `menu_board_screens`: the bilingual menu displays above the counter. Columns are
`code` (unique, and what appears in the screen's URL), `name`, `menu_code`, `poll_seconds`,
`config` (JSON), `status`, and `last_seen_at`.

The board used to be a separate program with its own copy of the menu in a spreadsheet, which
is how a price could be right at the till and wrong on the wall at the same time. Everything a
board shows now resolves from Menu Master; what is left in this table is only what genuinely
belongs to a *screen* rather than to a menu.

- **No `sync_seq`.** Like `kiosk_devices` (031) and `settings`, a screen is Admin Portal
  configuration, never an entity the Android app caches.
- `menu_code` is a **code, not a foreign key** to `menus.id`, matching `kiosk_devices.menu_code`:
  a screen names the menu it wants and keeps naming it across a re-import that gives the menu a
  new row id. **Blank is meaningful** — it defers to the `pos.default_menu_code` setting, so a
  single-menu operation configures its menu once instead of once per screen.
- `config` is **JSON, not columns**. It holds the house name, the typography and spacing (the
  keys carried over from the old workbook's `Settings` sheet), the three-column arrangement,
  and the Today-panel/celebration/ad settings. It is read whole by one renderer and never
  queried, filtered or joined on — the same reasoning as `kiosk_devices.category_order`. The
  seeded row carries the values the workbook held, so the first board to load looks unchanged.
  Times in it are `HH:mm` strings, never Excel time serials, which deserialise to a 1899
  timestamp the board's time parser cannot read.
- `last_seen_at` is written on snapshot reads **without bumping `revision`**, for the same
  reason as `kiosk_devices`: a screen switching on is not an edit to its configuration, and
  here it would also change the snapshot's own revision hash on every single request.

The morning menu is **not** a column here. It resolves from `menu_item_schedules` (014) —
MORNING shift, today's weekday. `menu_items.always_available` is deliberately excluded from
that lookup: it defaults to `1` on every row, so folding it in would place every dish in every
shift and leave the shift unable to narrow anything.
