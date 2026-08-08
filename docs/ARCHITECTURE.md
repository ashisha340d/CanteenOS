# MenuBoard — Architecture

## 1. What MenuBoard is

MenuBoard is an **operational collaboration platform** for catering operations, canteens,
temples, kitchens and event food service coordination.

Its single responsibility is **operational communication and order collaboration**.

It is not a POS, accounting system, inventory system, CRM or ERP. See
[MENUBOARD_SPEC.md](./MENUBOARD_SPEC.md) for the product requirements and the enforced
boundary list.

## 2. System topology

```
┌──────────────────────────┐        ┌──────────────────────────┐
│  Android app             │        │  Admin Portal            │
│  React Native + Expo     │        │  React + Vite + MUI      │
│  TypeScript              │        │  TypeScript              │
│                          │        │                          │
│  ┌────────────────────┐  │        │  Reads/writes the        │
│  │ SQLite (local DB)  │  │        │  server directly.        │
│  │ SOLE render source │  │        │  No local database.      │
│  └────────────────────┘  │        │                          │
└───────┬────────▲─────────┘        └───────────┬──▲────────────┘
        │ HTTP   │ Socket.IO                    │  │ HTTP
        │ (sync) │ (broadcast)                  │  │
        ▼        │                              ▼  │
┌──────────────────────────────────────────────────────────────┐
│  Backend — Node.js + Express + TypeScript                    │
│                                                              │
│  Routes → Middleware → Validation → Controllers →            │
│  Services → Repositories → MariaDB                           │
│                                                              │
│  Cross-cutting: JWT auth, RBAC, audit, rate limiting,        │
│  Multer media upload, Socket.IO broadcast, logging           │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
                ┌──────────────────────┐
                │  MariaDB (master)    │
                │  + local file store  │
                └──────────────────────┘
```

## 3. Responsibility split (hard boundaries)

| Concern | Android | Admin Portal | Backend |
| --- | --- | --- | --- |
| Login / logout / refresh | Yes | Yes | Yes |
| View boards | Yes | Yes | — |
| Create / edit orders | Yes | Read-only review | API |
| Order thread, mentions | Yes | Read-only review | API |
| Voice notes, photos | Yes (capture) | Read-only review | Upload/serve |
| Acknowledgements | Yes | Read-only review | API |
| Notifications | Yes | — | Emit |
| Offline sync | Yes | No | Sync API |
| User management | **Never** | Yes | API |
| Masters (stations, activities, menu) | Read-only cache | Yes (CRUD) | API |
| Permissions | **Never** | Yes | Enforce |
| Reports | **Never** | Yes | API |
| Settings / configuration | Device prefs only | Yes | API |
| **Billing generation** | **Never** | Yes (explicit action) | Snapshot + audit |
| Audit logs | **Never** | Yes | Write + expose |

The Android application contains **no** billing, pricing, tax, accounting, reporting,
administration, master-maintenance, user-management, permission-management or
system-configuration code. This is a structural rule, not a UI toggle: the Android
codebase has no modules, screens, API clients or SQLite columns for those concerns.

## 4. Repository layout

```
MenuBoard/
├── package.json                 npm workspaces root
├── tsconfig.base.json           shared compiler options
├── docs/
│   ├── MENUBOARD_SPEC.md        product requirements — mission, scope, decisions
│   ├── ARCHITECTURE.md          this file — includes the offline-first sync contract
│   ├── DESIGN_SYSTEM.md         UI/UX vision and standards, both clients
│   ├── API.md                   REST + Socket.IO surface
│   ├── DATABASE.md              MariaDB + SQLite design
│   ├── AGENTS.md                general agent rules (read this first)
│   └── sqlite-schema.sql        the Android local schema
├── tasks/
│   ├── PHASE_3.md .. PHASE_7.md phase-by-phase build briefs
│
├── shared/                      @menuboard/shared — types & enums only, zero runtime deps
│   ├── src/
│   │   ├── enums/               roles, statuses, priorities, notification types
│   │   ├── dto/                 request/response contracts per domain
│   │   ├── sync/                sync envelope + entity name union
│   │   ├── permissions/         RBAC capability matrix (single source of truth)
│   │   └── constants/           limits, order-number format, socket event names
│   └── package.json
│
├── backend/                     @menuboard/backend
│   ├── src/
│   │   ├── config/              env parsing & typed config
│   │   ├── db/
│   │   │   ├── pool.ts          mysql2 connection pool
│   │   │   ├── transaction.ts   withTransaction helper
│   │   │   ├── syncSeq.ts       global monotonic sync cursor allocator
│   │   │   ├── migrations/      forward-only .sql migrations
│   │   │   └── seeds/           idempotent seed data
│   │   ├── middleware/          auth, rbac, validate, rateLimit, errorHandler,
│   │   │                        requestContext, notFound
│   │   ├── models/              row types mapped 1:1 to tables
│   │   ├── repositories/        SQL only — no business rules
│   │   ├── services/            business rules, transactions, audit, events
│   │   ├── controllers/         HTTP in/out only
│   │   ├── routes/              routing tables per domain
│   │   ├── validation/          zod schemas per endpoint
│   │   ├── realtime/            Socket.IO server, auth, rooms, emitters
│   │   ├── utils/               ids, passwords, tokens, files, logger, errors
│   │   ├── app.ts               Express app assembly
│   │   └── server.ts            HTTP + Socket.IO bootstrap
│   └── storage/                 uploaded media (gitignored)
│
├── admin/                       @menuboard/admin — Web Admin Portal (Phase 3)
│                                React + Vite + TypeScript + MUI, npm workspace member
└── app/                         Android operational app (Phase 4+)
                                 Expo + React Native + TypeScript. Deliberately NOT an npm
                                 workspace member (Metro and npm workspaces interact badly);
                                 consumes @menuboard/shared via a `file:../shared` dependency.
                                 Has its own app/AGENTS.md with mobile-specific conventions.
```

## 5. Backend layering rules

Requests flow in exactly one direction. A layer may only call the layer beneath it.

```
routes
  → middleware (auth → rbac → rate limit → validation)
    → controllers        HTTP concern only: read req, call service, shape response
      → services         business rules, transactions, audit, realtime emission
        → repositories   parameterised SQL, row mapping
          → db pool
```

Enforced conventions (non-negotiable — breaking one produces bugs that are extremely hard to
diagnose later):

1. **Controllers never write SQL and never import repositories.**
2. **Repositories never contain business rules**, never emit events, never write audit rows.
3. **Services own transactions.** A service method either receives an existing connection or
   opens one via `withTransaction`.
4. **Every mutation allocates a `sync_seq`** from `sync_counter`, inside the same transaction
   as the write. A write without a cursor is invisible to sync forever.
5. **Every mutation writes an audit row** through `AuditService`, in that same transaction.
   An audit trail that can disagree with the data is worse than none.
6. **Realtime emission happens after commit**, never inside a transaction — otherwise a
   device can react before the data is visible.
7. **Errors are thrown as `AppError` subclasses** and rendered by the single handler in
   `middleware/errorHandler.ts`. Never `res.status(500).json(...)` in a controller.
8. **Row → DTO mapping happens only in `models/mappers.ts`.** That is why `password_hash`
   cannot leak: no mapper reads it.

### A transaction bug already hit — don't reintroduce it

**Never wrap a call to a self-transactional service in another transaction.** `SyncService`
originally did exactly that. The inner transaction ran on a *different pooled connection*,
so it blocked waiting for the `sync_counter` row lock the outer transaction still held — a
self-deadlock that only unblocked after `innodb_lock_wait_timeout` (~50s), surfacing as
`INTERNAL_ERROR` on sync push and an apparently hung test run.

The fix, now in place: `SyncService` opens **no** transaction of its own. Each domain service
is already atomic internally. Where atomic check-then-act is genuinely required, the
guarantee comes from the service instead — e.g. `orderService.update(..., {
expectedRevision })` performs the optimistic-concurrency check inside its own transaction and
raises `StaleWriteError`, which sync reports as `SUPERSEDED`. If you need retry-on-lock
without a transaction, use `retryOnLockContention` from `db/transaction.ts`.

### A capability-scoping bug already hit — don't reintroduce it

`ATTACHMENT_UPLOAD` is a *board-role* capability, never a global one for `MANAGER`/`USER`.
Guarding the upload route with `requireCapability` (the global-role guard) returned 403 for
every ordinary member. Board-scoped capabilities must be checked with a board-aware guard
(`requireBoardAccess` / `requireResolvedBoardAccess`), or in the service where the board is
only known from the request payload. Before adding `requireCapability(X)` to a new route,
check whether `X` actually appears in `ROLE_CAPABILITIES` for the roles that need it — if it
only appears in `BOARD_ROLE_CAPABILITIES`, it needs a board-aware guard instead. The same
applies to `POST /orders`: the board arrives in the **body**, so no URL-based middleware can
guard it — `OrderService.assertCanCreateOnBoard` does it instead. Any future endpoint that
takes its board from the body must do likewise.

## 6. Offline-first contract (Android)

```
User action
  → write to SQLite (optimistic, immediately durable)
  → UI re-renders from SQLite
  → enqueue row in sync_queue
  → background worker drains queue over HTTP
  → MariaDB applies write, allocates sync_seq
  → Socket.IO broadcasts to board room
  → other devices pull the delta, write SQLite, refresh UI
```

Rules:

1. Every screen reads from SQLite. No screen renders from an API response.
2. All primary keys are **client-generatable UUID v4**, so an offline device can create
   fully-formed entities without server coordination.
3. Writes are never blocked on connectivity. Failure to reach the server changes only
   `sync_state`, never user-visible behaviour.
4. Nothing is deleted destructively. Deletes are tombstones (`deleted_at`) so they can
   replicate.
5. The sync queue is durable, ordered, idempotent and retried with exponential backoff.

### 6.1 Push

`POST /api/v1/sync/push` — `{ deviceId, items: SyncPushItem[] }`, max 200 items per batch,
applied **in order**.

Only these entities are pushable: `boards`, `orders`, `order_items`, `attachments`,
`thread_messages`, `acknowledgements`. Everything else is server- or Admin-authored, so a
device pulling masters can never push them back.

Each item carries `clientOpId`. The server records it and returns `DUPLICATE` on replay, so
a retry after an ambiguous network failure can never double-apply.

Per-item result:

| Status | Device action |
| --- | --- |
| `APPLIED` | Remove from queue, mark row `SYNCED` |
| `DUPLICATE` | Remove from queue — already applied by an earlier attempt |
| `SUPERSEDED` | Adopt `serverEntity`, remove from queue |
| `REJECTED` | Remove from queue, mark row `FAILED`, surface to the user. Never retry |
| `FAILED` | Keep in queue, retry with backoff |

A single bad item never blocks the batch — results are per item.

### 6.2 Pull

`POST /api/v1/sync/pull` — `{ deviceId, cursor, limit }`.

Returns rows with `sync_seq > cursor`, ordered by `sync_seq`, grouped by entity in dependency
order (users → boards → board_members → masters → orders → order_items → attachments →
thread_messages → acknowledgements → notifications) so foreign keys resolve as the device
applies them in sequence.

`hasMore: true` means pull again immediately. The device advances its stored cursor **only
after the whole page is committed** to SQLite in one transaction, so a crash mid-apply
replays the page rather than skipping it.

A pull returns only what the caller may see: boards they are a member of, orders on those
boards, and their own notifications. Masters and users are visible to all authenticated
callers because every client needs them to render an order.

### 6.3 Conflict resolution

Last-write-wins on `clientTimestamp`, with a revision guard:

1. If the row does not exist → insert, return `APPLIED`.
2. If `baseRevision` is present and does not match the server's `revision` → the server copy
   is newer. Compare `clientTimestamp` to the server `updated_at`:
   - client is newer → apply, return `APPLIED`
   - server is newer → discard, return `SUPERSEDED` with the server entity
3. Field-level merge is deliberately **not** attempted. Orders are edited by one person at a
   time in practice, and a silent field merge would produce an order nobody authored.

Two operations are commutative and so never conflict: **thread messages** are append-only (a
new id always inserts), and **acknowledgements** are idempotent per `(order_id, user_id)` (a
second ack is a no-op).

### 6.4 Retry, media and realtime

- **Retry:** exponential backoff with jitter — 2s, 4s, 8s, 16s, 32s, 60s, then every 60s.
  Reset on success. A network-connected transition triggers an immediate drain, bypassing
  the current backoff gate. `REJECTED` items are terminal — retrying a validation or
  permission failure would loop forever.
- **Media:** attachments sync in two stages. The `attachments` **row** pushes with the order
  — small, fast, enough for the UI to render a placeholder. The **bytes** upload separately
  via `POST /api/v1/attachments/upload`, driven by `upload_state`/`upload_attempts` with its
  own backoff. Downloads are lazy: fetched on first view, cached on-device, keyed by
  `checksum`.
- **Realtime is a hint channel only, never a data channel.** Socket.IO tells a device that
  something changed; the device then pulls through the normal cursor path (see
  [API.md](./API.md) for the event list). This keeps one code path for applying changes, so
  a missed socket event degrades to a slightly later sync rather than a corrupted local
  database. Rooms: `user:<id>` for notifications, `board:<id>` for order/thread activity,
  `masters` for master-data changes.

### 6.5 Guarantees

No data loss (writes are durable in SQLite before any network attempt) · no duplicate
application (`clientOpId` idempotency on push, cursor ordering on pull) · no blocked UI (all
network work is off the render path) · convergence (every device replays the same total
order via `sync_seq` and reaches the same state).

## 7. Identity and access

- Password hashing: bcrypt, cost 12.
- Access token: JWT HS256, short lived (default 15 min), carries `sub`, `role`, `jti`, `did`.
- Refresh token: opaque 256-bit random, SHA-256 hashed at rest in `refresh_tokens`,
  bound to a `device_id`, **rotated on every use**, with reuse detection that revokes the
  whole device chain.
- "Remember login" = the device persists the refresh token; it does not extend access
  token lifetime.
- Two authorisation planes, both enforced server-side:
  - **Global role** — `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `USER`.
  - **Board membership role** — `OWNER`, `MANAGER`, `MEMBER`, `VIEWER`.
- The capability matrix lives in `shared/src/permissions` and is the single source of
  truth used by the backend guard and displayed by the Admin Portal.
- **Admin Portal login is additionally gated on the exact `ADMIN` role**, on top of the
  capability matrix: `AuthService.login`/`AuthService.refresh` reject `clientType: "ADMIN"`
  for every other role (Super Admin, Manager, User, Employee) with `ADMIN_ROLE_REQUIRED`,
  before a session is ever issued. This is a hard identity-plane gate, not a capability —
  it exists so only the account operating the portal can reach it, regardless of what the
  capability matrix would otherwise permit.
- `BOARD_MEMBER_MANAGE` is held globally by the `ADMIN` role (via `ADMIN_CAPABILITIES`).
  Because `ADMIN` also has `BOARD_READ_ALL`, `requireBoardAccess` reaches any board, giving
  the Admin Portal the ability to add or remove members on all boards. Board `OWNER` and
  `MANAGER` roles still hold the same capability, but only for their own board.

Middleware helpers in `middleware/authorize.ts`:

| Helper | Use for |
| --- | --- |
| `requireCapability(cap)` | Global capabilities only — administration endpoints |
| `requireBoardAccess(cap)` | Routes keyed on `:boardId` |
| `requireResolvedBoardAccess(cap, resolver)` | Routes keyed on `:orderId` / `:messageId` |
| `denyClient(ClientType.ANDROID)` | Blocking a whole route group from the mobile app |

See the capability-scoping bug callout in §5 before adding a new `requireCapability` guard.

## 8. Billing posture

Billing is an Admin-Portal-only, explicitly triggered, one-way snapshot.

```
Operations create orders → work completed → Admin reviews
  → Admin clicks "Generate Billing"
    → backend freezes a snapshot into billing_exports (immutable JSON payload)
    → audit row written with generated_by / generated_at / billing_version
    → export artefact produced
```

Operational orders are never mutated by billing generation and continue to exist
independently. The Android app has no billing endpoint reachable from its token scope,
no billing screens and no billing fields in SQLite.

## 9. Non-functional posture

| Requirement | How it is met |
| --- | --- |
| Modular | Workspace packages; one folder per layer; one file per domain |
| Scalable | Stateless backend, pooled DB, room-scoped sockets, cursor-paged sync |
| Offline first | SQLite as render source + durable sync queue |
| Strong typing | `strict` TS everywhere; shared DTOs; zod validation at the edge |
| Error handling | Typed `AppError` hierarchy, single handler, structured codes |
| Retry logic | Backoff in sync worker and media uploader; idempotent server writes |
| Logging | Structured JSON logs with request id, actor id, duration |
| Security | HTTPS-only posture, helmet, RBAC, rate limits, validation, audit trail |

## 10. Production notes (added Phase 7)

These are operational requirements for a real deployment, not code the application can enforce
on its own — see `backend/.env.example` for the corresponding settings and their inline
rationale.

- **`JWT_SECRET`** must be a real, random, ≥32-character value generated per environment, never
  the placeholder shipped in `.env.example`. `config/index.ts` already refuses to boot in
  production if the secret still contains the literal string `change-me`; it cannot detect a
  *weak but different* secret, so this is an operational discipline, not just a code guard.
- **`TRUST_PROXY=true` and `FORCE_HTTPS=true`** must both be set once the backend sits behind a
  real TLS-terminating reverse proxy or load balancer. Left at their safe local-dev default of
  `false`, `TRUST_PROXY` would misattribute every request's IP to the proxy itself (breaking
  per-identifier auth rate limiting and audit-log IP attribution) and `FORCE_HTTPS` would not
  enable HSTS.
- **The rate limiter is in-memory (`express-rate-limit`'s default store), scoped to a single
  Node process.** This is correct and sufficient for one backend instance. Horizontally scaling
  to multiple instances behind a load balancer, without also moving to a shared store (e.g. a
  Redis-backed `express-rate-limit` store), silently multiplies every configured ceiling by the
  instance count — each instance enforces its own independent counter. Do not scale horizontally
  without addressing this first.
- **Server-side image/media processing is intentionally out of scope.** Compression, resizing
  and thumbnailing are a client (Android app) concern by design (`docs/SCOPE.md`); the backend
  only validates mime type, size ceilings and stores the bytes as received. This posture was
  re-confirmed, not changed, in Phase 7.
- **Migrations and backups** are the operator's responsibility at deploy time
  (`npm run migrate` / `npm run migrate:status` from `backend/`); there is no automatic
  migration-on-boot, and no backup automation exists in this repository — provision it at the
  database/infrastructure layer.
- **`LOG_LEVEL=info`** is the production default; `debug` is for local troubleshooting only and
  is verbose enough to be a minor operational cost at scale.
