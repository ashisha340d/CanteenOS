# Database Design

- **MariaDB is the master.** Schema: [`backend/src/db/migrations/001_core_schema.sql`](../backend/src/db/migrations/001_core_schema.sql).
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
