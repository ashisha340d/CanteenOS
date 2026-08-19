# Handoff — Equipment Monitoring + Maintenance Management

Working document for the Equipment & Maintenance module. Written because it was explicitly
asked for; `docs/AGENTS.md` otherwise bars unsolicited summary/planning files.

**Status:** in progress. Shared contract, database and the first two repositories are done and
verified; services, HTTP layer and both clients are outstanding. Section 6 is the resume point.

---

## 1. Scope note (read first)

`docs/MENUBOARD_SPEC.md` §3 lists hard exclusions ending "anything not in this document", so a
new Equipment/Maintenance module is formally out of scope until the spec says otherwise. The
spec has an established pattern for this: §3a admitted the Menu Master, §3b admitted the POS,
each as a numbered extension that supersedes the exclusion list.

**This module was built on the user's explicit instruction.** The matching spec amendment
(a §3c "Equipment Monitoring & Maintenance (extension)" section) is listed as an outstanding
task in §6 and must land before the module is considered complete, so the product contract and
the code do not disagree.

What stays excluded and was *not* built: IoT ingestion/telemetry storage, a spare-parts
inventory, purchase orders, depreciation/asset accounting, and any automatic technical
diagnosis that is not confirmed by a human.

---

## 2. Architectural decisions

Each of these was a fork in the road; changing one later is expensive.

| Decision | Rationale |
| --- | --- |
| **One module, not two.** Every maintenance row hangs off `equipment.id`; tickets derive location, asset id and supplier from the equipment rather than restating them. | The brief's own requirement — "a unified system rather than two disconnected modules". |
| **Low data entry is architectural, not UI polish.** Only `equipmentId` is required to open a ticket. Asset id, location, supplier, priority, reporter and timestamps are all server-derived. | Everything else follows from this. It is why the DTOs have `*Draft` types and why `captured_via` exists. |
| **AI proposes, the user disposes.** AI output arrives as a `*Draft` type that is never persisted on its own; it is confirmed (and editable) before it becomes a record. `maintenance_problems` stores the AI's suggestion *and* the human's confirmation side by side. | The brief forbids automatic technical diagnosis without confirmation. |
| **No IoT dependency.** `equipment.status` is a human/workflow column. `telemetry_device_id` is a nullable string that nothing reads. There is deliberately **no** telemetry table. | The brief requires full function without sensors. Storing readings nobody consumes would be exactly the "generic abstraction whose obvious purpose is to host a future feature" that `AGENTS.md` forbids. |
| **Files reuse `media_assets` (012).** Photos, documents and voice notes are media-library rows reached by `media_id`, served by the existing signed-URL route (`GET /api/v1/media/:id/file`). This module adds link tables, not a second blob store. | `attachments` (001) was rejected: it is board-scoped and sync-replicated, and equipment belongs to no board. |
| **Audit stays in one place.** No `equipment_audit_logs` table. The global `audit_logs` (001) already records actor, role, action, entity, before/after, ip, user-agent and request id. | Splitting the trail would mean no single query could answer "what did this person change". `maintenance_activities` is a *different* thing and both exist — see below. |
| **`maintenance_activities` is the operator timeline, `audit_logs` is the security record.** Activity rows carry prose (`summary`) written at write time. | A cook should read "Supplier called", not a before/after JSON diff. Writing the prose server-side stops the phone and the portal wording the same event differently. |
| **No sync bookkeeping.** No `revision`/`sync_seq` columns anywhere. REST-served to both clients. | Same posture as tasks (023) and entities/POS (022). Delta-sync participation would require a device-side schema change and a change to the sync contract. |
| **Counters are recomputed, never incremented.** `equipment.open_ticket_count` / `critical_ticket_count` / `next_maintenance_at` / `warranty_expiry` are refreshed from source tables inside the same transaction as the change. | An increment that misses one code path leaves a counter permanently wrong; recomputation is idempotent and self-healing. |
| **Warranty status is derived, never stored.** `warrantyStatusFor()` in shared computes it from the expiry date on every read. | A stored status silently lies three years later. |
| **Floor-plan coordinates are fractions (0..1), never pixels.** | The same pin renders correctly on a phone, on a 4K monitor, and after the plan is re-uploaded at a different size. |
| **Suppliers link to the Entity master rather than duplicating it.** `equipment_suppliers.entity_id` is a nullable FK to `entities` (022, `type='VENDOR'`). | A supplier already in the Entity master is never entered twice; a service outfit nobody has billed still gets a row. |
| **`equipment.report_problem` reaches all the way down to Employee.** | Whoever is standing in front of the broken oven must be able to report it. Withholding this is the fastest way to make the module useless. |

---

## 3. Permission model

Action-based, composed by nesting (each tier is the one below plus its own grants), declared in
`shared/src/permissions/index.ts` and seeded into `role_capabilities` by the migration. Both
must be edited together — `PermissionsCacheService` serves the DB rows as authoritative.

| Capability | EMPLOYEE | USER | MANAGER | ADMIN | SUPER_ADMIN |
| --- | :-: | :-: | :-: | :-: | :-: |
| `equipment.view` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `equipment.report_problem` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `maintenance.view` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `maintenance.create` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `equipment.upload_document` | | ✔ | ✔ | ✔ | ✔ |
| `supplier.view` | | ✔ | ✔ | ✔ | ✔ |
| `supplier.contact` | | ✔ | ✔ | ✔ | ✔ |
| `equipment.create` / `.edit` | | | ✔ | ✔ | ✔ |
| `equipment.manage_location` / `.manage_floorplan` | | | ✔ | ✔ | ✔ |
| `maintenance.assign` / `.approve` / `.close` / `.schedule` | | | ✔ | ✔ | ✔ |
| `supplier.manage` | | | ✔ | ✔ | ✔ |
| `equipment.delete` / `maintenance.delete` | | | | ✔ | ✔ |

`ANDROID_FORBIDDEN_CAPABILITIES` is left empty, so the whole module is reachable from the phone
for Admin, Manager and User alike — as the brief requires.

---

## 4. Data model

23 tables in `backend/src/db/migrations/025_equipment_maintenance.sql`, applied and verified
against the live database.

```
equipment_floors ─< equipment_areas ─< equipment_locations ─< equipment
                                                                 │
equipment_categories ────────────────────────────────────────────┤
                                                                 │
        ┌────────────────────────────────────────────────────────┼────────────────────────┐
        │                     │                │                 │                        │
equipment_documents   equipment_warranties  equipment_supplier_links   maintenance_schedules
        │                                            │                        │
        │                                    equipment_suppliers ─< supplier_contacts
        │                                            └─< supplier_service_categories
        │                                                                     │
        └──────────────── maintenance_tickets ────────────────────────────────┘
                                  │
     ┌────────────┬───────────────┼────────────────┬──────────────────┐
maintenance_  maintenance_   maintenance_    maintenance_       equipment_call_logs
  problems     attachments    assignments      activities       equipment_whatsapp_logs

equipment_floors ─< floor_plans ─< floor_plan_equipment_positions >─ equipment
equipment_status_history, equipment_location_history  ──────────────>─ equipment
```

Notes:
- **Asset ID** — `MTC-KIT-OVN-001` = `<prefix>-<area segment>-<category segment>-<sequence>`.
  Prefix and sequence width live in `settings` (`equipment.assetIdPrefix`,
  `equipment.assetIdSequenceDigits`), so the scheme is configurable, not compiled in.
- **Ticket number** — `MTK-YYYYMMDD-NNNN`, server-sequential via `nextDailySequence()` with
  `FOR UPDATE`, backed by `uq_maintenance_tickets_daily`. Server-side (unlike order numbers)
  because a ticket is raised online and quoted to a supplier over the phone.
- **Reference data seeded**: 18 equipment categories for bakery/cafe/restaurant/QSR, one Ground
  Floor → Main Kitchen → Main Kitchen location chain, and the asset-id settings. All ordinary
  rows; rename or replace freely. Seeded because the asset-id scheme needs a category segment
  on the very first registration — asking a user to invent "OVN" before photographing an oven
  defeats the design.
- `notifications.type` was extended in-place with nine maintenance kinds so there is one inbox
  and one delivery path (in-app + push), not a parallel notification system.

---

## 5. Completed and verified

| Area | Files |
| --- | --- |
| Shared enums | `shared/src/enums/equipment.ts` (new module, re-exported by `enums/index.ts` so import paths are unchanged); `NotificationType` extended in `enums/index.ts` |
| Shared permissions | `shared/src/permissions/index.ts` — 18 capabilities + role composition |
| Shared limits | `shared/src/constants/index.ts` — `LIMITS.EQUIPMENT_*`, `SUPPLIER_*`, `MAINTENANCE_*` |
| Shared DTOs | `shared/src/dto/equipment.ts` (new, exported from `shared/src/index.ts`) — full wire contract incl. `*Draft` AI types, dashboard and `MyMaintenanceDto` |
| Migration | `backend/src/db/migrations/025_equipment_maintenance.sql` |
| Row types | `backend/src/models/equipmentRows.ts` (re-exported by `models/rows.ts`) |
| Mappers | `backend/src/models/equipmentMappers.ts` (re-exported by `models/mappers.ts`) |
| Repositories | `backend/src/repositories/EquipmentRepository.ts` (+ `EquipmentLocationRepository`, `EquipmentCategoryRepository`), `backend/src/repositories/MaintenanceRepository.ts` |

Verified so far:
- `npm run build:shared` — passes.
- `npm run migrate` — 025 applied cleanly to the live database (297 ms).

---

## 6. Outstanding — resume here

In dependency order. Nothing below has been started unless stated.

1. **`backend/src/repositories/SupplierRepository.ts`** — supplier master, `supplier_contacts`,
   `supplier_service_categories`, plus the call/WhatsApp log tables.
2. **`backend/src/repositories/FloorPlanRepository.ts`** — plans and pin positions.
3. **Services** (`backend/src/services/`):
   - `EquipmentService` — registration, asset-id allocation, status/location change (each
     writing history + activity), documents, warranties, supplier links, QR payload.
   - `MaintenanceService` — ticket lifecycle (`canTransitionMaintenanceStatus` in shared is the
     authority), assignment, completion, activity timeline, counter refresh, notifications.
   - `SupplierService`, `FloorPlanService`.
   - `EquipmentAiService` — photo→identification, document→OCR, voice/text→problem
     classification. Must reuse `GeminiService` (`generateGeminiText`, `transcribeAudio`,
     `extractJson`) and degrade to a clear "not configured" error when `GEMINI_API_KEY` is
     unset, exactly like the recipe importer. **The module must stay fully usable with AI off.**
   - `MaintenanceSchedulerService` — sweep due schedules into tickets
     (`listDueSchedulesWithoutTicket` is already written to be idempotent), advance `next_due_at`,
     raise due/overdue/warranty notifications.
4. **HTTP layer** — `validation/schemas.ts` additions (zod, `.strict()`), `EquipmentController`,
   `MaintenanceController`, `equipment.routes.ts`, `maintenance.routes.ts`, mounted in
   `routes/index.ts`. Media upload for this module needs its own endpoint gated by
   `equipment.upload_document` rather than reusing the `MASTER_WRITE`-gated media route.
5. **Admin web** (`admin/src/`) — `api/equipment.ts`, `hooks/useEquipment.ts`, pages for
   dashboard, list/cards, detail, floor plan, tickets, calendar, suppliers, warranty, schedules;
   route entries in `routes.tsx` and a nav section in `layouts/navigation.ts`.
6. **Android app** (`app/`) — `src/api/equipment.ts`; screens under `app/equipment/` for scan/
   register (camera→AI→confirm), profile, report problem (photo + voice), my maintenance,
   complete work; `Linking` for `tel:` and `wa.me`; QR handled via deep link + typed asset id.
   **Note:** camera-based QR scanning would need `expo-camera` (a native dep requiring a
   rebuild). The plan is deep-link + manual asset-id entry unless the user asks for the dep.
7. **Spec amendment** — add §3c to `docs/MENUBOARD_SPEC.md` (see §1 above).
8. **Verification** — `npm run build`, `npm run lint --workspace @menuboard/admin`,
   `cd app && npm run typecheck && npm run lint`, `npm run smoke`.

---

## 7. Conventions this module follows

Learned from the Tasks module (023/024), which is the closest precedent.

- **Layering**: route → controller → service → repository → `Db`. Controllers never touch SQL;
  repositories never contain business rules. Services own transactions via `withTransaction`.
- **Repositories take a `Db`** (pool *or* connection) so they join the caller's transaction.
- **Every mutation writes an audit row** in the same transaction, via
  `auditService.record(connection, actor, …)`. New `AuditAction` members are needed.
- **Validation**: zod schemas in `backend/src/validation/schemas.ts`, always `.strict()`, using
  the `text()` / `optionalText()` / `enumOf()` / `pageQuery` helpers from `validation/common.ts`.
- **Responses**: `ok()` / `created()` / `paginated()` / `noContent()` from `utils/http.ts`.
- **Signed media URLs** are minted per response by `signMenuMediaUrl(mediaId, userId)` and never
  stored — which is why every mapper returning a file takes the viewing user's id.
- **Admin UI**: shadcn/ui + Tailwind, `PageHeader` / `ListToolbar` / `DataTable` /
  `EntityCardGrid` / `StatTile`, TanStack Query hooks, `notify.fromError(err)`, capability gates
  via `useAuth().hasCapability`.
- **App UI**: expo-router file routes, `src/theme/tokens.ts` for every colour and spacing value
  (nothing hardcoded), `useCapabilities().has()` for gating, online-only API modules that treat a
  failed request as an ordinary outcome rather than an exception.

## 8. Commands

```bash
npm run build:shared                        # after any shared/ change — both clients consume dist
npm run migrate                             # forward-only; checksums are enforced
npm run build                               # shared → backend → admin
npm run lint --workspace @menuboard/admin
npm run smoke                               # REST surface, requires a running backend
cd app && npm install && npm run typecheck && npm run lint
```

`shared/dist` must be rebuilt before `app/` installs, per `docs/AGENTS.md`.
