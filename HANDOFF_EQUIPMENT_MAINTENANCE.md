# Handoff — Equipment Monitoring + Maintenance Management

Working document for the Equipment & Maintenance module. Written because it was explicitly
asked for; `docs/AGENTS.md` otherwise bars unsolicited summary/planning files.

**Status:** complete. Shared contract, database, repositories, services, HTTP layer, the Admin
Portal, the Android app and the spec/API/database documentation are all in place and verified —
see §6 for what was built and §8 for how it was checked.

---

## 1. Scope note (read first)

`docs/MENUBOARD_SPEC.md` §3 lists hard exclusions ending "anything not in this document", so a
new Equipment/Maintenance module is formally out of scope until the spec says otherwise. The
spec has an established pattern for this: §3a admitted the Menu Master, §3b admitted the POS,
each as a numbered extension that supersedes the exclusion list.

**This module was built on the user's explicit instruction**, and the matching spec amendment
has landed: `docs/MENUBOARD_SPEC.md` §3c "Equipment Monitoring & Maintenance Management
(extension)" now admits it the same way §3a admitted the Menu Master. The product contract and
the code agree.

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

Revised by `028_equipment_role_scope.sql`. **Monitoring and managing is Manager/Admin;
reporting is User and above; an Employee holds no part of the module.**

| Capability | EMPLOYEE | USER | MANAGER | ADMIN | SUPER_ADMIN |
| --- | :-: | :-: | :-: | :-: | :-: |
| `equipment.report_problem` | | ✔ | ✔ | ✔ | ✔ |
| `maintenance.view` | | ✔ | ✔ | ✔ | ✔ |
| `maintenance.create` | | ✔ | ✔ | ✔ | ✔ |
| `equipment.view` | | | ✔ | ✔ | ✔ |
| `equipment.create` / `.edit` | | | ✔ | ✔ | ✔ |
| `equipment.upload_document` | | | ✔ | ✔ | ✔ |
| `equipment.manage_location` / `.manage_floorplan` | | | ✔ | ✔ | ✔ |
| `maintenance.assign` / `.approve` / `.close` / `.schedule` | | | ✔ | ✔ | ✔ |
| `supplier.view` / `.contact` / `.manage` | | | ✔ | ✔ | ✔ |
| `equipment.delete` / `maintenance.delete` | | | | ✔ | ✔ |

`equipment.report_problem` is narrower than it looks and wider than its name: it grants the two
reads a reporter cannot do without — `GET /equipment/resolve` and `GET /equipment/:id`, both
returning a payload trimmed to the machine's identity and its open problems — plus
`POST /equipment/media`, because the person who may report a fault must be able to show it. It
grants no way to browse the estate.

`ANDROID_FORBIDDEN_CAPABILITIES` is left empty, so the whole module is reachable from the phone —
a Manager gets the monitoring surface there, a User gets scan-and-report.

---

## 4. Data model

23 tables in `backend/src/db/migrations/001_schema.sql`, applied and verified
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
| Migration | `backend/src/db/migrations/001_schema.sql` |
| Row types | `backend/src/models/equipmentRows.ts` (re-exported by `models/rows.ts`) |
| Mappers | `backend/src/models/equipmentMappers.ts` (re-exported by `models/mappers.ts`) |
| Repositories | `backend/src/repositories/EquipmentRepository.ts` (+ `EquipmentLocationRepository`, `EquipmentCategoryRepository`), `backend/src/repositories/MaintenanceRepository.ts` |

---

## 6. The rest of the module

| Area | Files |
| --- | --- |
| Repositories | `SupplierRepository.ts` (master, contacts, service categories, call + WhatsApp logs), `FloorPlanRepository.ts` (plans, pins, unplaced assets) |
| Activity timeline | `services/MaintenanceActivityService.ts` — the one place the operator-facing prose is composed, called by four services inside their own transactions |
| Services | `EquipmentService`, `MaintenanceService`, `SupplierService`, `FloorPlanService`, `EquipmentAiService`, `MaintenanceSchedulerService` |
| Audit | `AuditService.AuditAction` — 29 new members (`equipment.*`, `maintenance.*`, `supplier.*`) |
| Scheduler wiring | `server.ts` starts/stops `maintenanceSchedulerService` beside the YouTube worker; it sweeps every 6 h and on boot |
| HTTP | `validation/schemas.ts` (+~600 lines, all `.strict()`), `EquipmentController`, `MaintenanceController`, `equipment.routes.ts`, `maintenance.routes.ts`, mounted in `routes/index.ts` |
| Admin | `api/equipment.ts`, `hooks/useEquipment.ts`, `pages/Equipment/*` (dashboard, register, detail, locations & categories, floor plan, status/move modals, tone map), `pages/Maintenance/*` (tickets, ticket, schedules, report/assign/complete modals), `pages/Suppliers/SuppliersPage.tsx`, 9 routes, an "Equipment" nav section |
| App | `src/api/equipment.ts`, `app/equipment/*` (list, profile, register, report, my-maintenance, ticket, scan), `src/hooks/useSupplierContact.ts`, `src/components/equipment/*`, entry point on the Boards top bar |
| Docs | `MENUBOARD_SPEC.md` §3c, `API.md` §17c, `DATABASE.md` "Equipment & Maintenance (025…)" |

Decisions taken while finishing, worth knowing:

- **`POST /equipment/media` is gated by `equipment.report_problem`, not
  `equipment.upload_document`.** An Employee holds the former and not the latter, and the whole
  design rests on a cook photographing the machine that stopped. `upload_document` still gates
  *binding* a document to an asset and the OCR endpoint, which is what it describes.
- **`PATCH /equipment/:id` refuses `status`** rather than silently ignoring it: status moves
  through its own endpoint because that is what writes the history row and the timeline entry.
- **"Open" means `status NOT IN ('CLOSED','CANCELLED')`** everywhere, so a RESOLVED ticket still
  counts against the asset even though the asset is already back in service. Verifying or
  closing it clears the counter.
- **The asset-id scheme is editable from the Settings page** — `equipment.assetIdPrefix` and
  `equipment.assetIdSequenceDigits` were added to `SETTING_DEFINITIONS`, which is a closed set;
  without that the migration's rows would have been unreachable.
- **The phone scans QR codes; nothing renders them.** `equipment.qr_code` holds
  `menuboard://equipment/<assetId>`, which any label printer can encode. `app/equipment/scan.tsx`
  reads it with `expo-camera` (`CameraView` + `useCameraPermissions`, `CAMERA` declared in
  `app.json`) and resolves it through `GET /equipment/resolve`, falling back to typed/pasted
  entry when permission is refused. Rendering a QR image would need `qrcode` and no surface asks
  for one.
- **Warranty and calendar are views, not pages.** Warranty is a filter on the equipment register
  plus a dashboard tile; the "calendar" is the schedules page ordered by due date, because
  "6 days overdue" answers the question a month grid only implies.

---

## 7. Conventions this module follows

Learned from the Tasks module (023/024), which is the closest precedent.

- **Layering**: route → controller → service → repository → `Db`. Controllers never touch SQL;
  repositories never contain business rules. Services own transactions via `withTransaction`.
- **Repositories take a `Db`** (pool *or* connection) so they join the caller's transaction.
- **Every mutation writes an audit row** in the same transaction, via
  `auditService.record(connection, actor, …)`.
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

## 8. Commands and what they reported

```bash
npm run build:shared                        # after any shared/ change — both clients consume dist
npm run migrate                             # forward-only; checksums are enforced
npm run build                               # shared → backend → admin
npm run lint --workspace @menuboard/admin
npm run smoke                               # REST surface, requires a running backend
cd app && npm install && npm run typecheck && npm run lint
```

Last run on this machine:

| Command | Result |
| --- | --- |
| `npm run migrate:status` | 025, 028, 029, 030 APPLIED |
| `npm run build` | passes (shared → backend → admin → kiosk) |
| `npm run lint --workspace @menuboard/admin` | passes, 0 warnings |
| `cd app && npm run typecheck && npm run lint` | both pass |
| Live REST exercise against `localhost:4000` | 39/39 checks, plus the multipart media upload |
| `npm run smoke` | **could not run here** — the dev database's seeded `admin` password is no longer `MenuBoard@2026`, so the script cannot log in. Re-run it with `SEED_PASSWORD=<real password>`; the equipment section added to `scripts/smoke.mjs` covers registration, the ticket ladder, counter refresh, supplier linking, the WhatsApp draft and deletion. |

`shared/dist` must be rebuilt before `app/` installs, per `docs/AGENTS.md`.

One defect outside this module's scope was found while verifying the permission tiers and fixed
rather than left: `audit_logs.actor_role` never gained the `EMPLOYEE` member that 003 added to
`users.role`, so under `STRICT_TRANS_TABLES` every audited EMPLOYEE action — including
`auth.login` — aborted its own transaction. `030_audit_actor_role_employee.sql` widens the enum;
no data changed, because strict mode had refused the inserts outright rather than truncating
them.
