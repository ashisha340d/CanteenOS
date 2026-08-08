# MenuBoard REST + Socket.IO Contract Reference

This document is the authoritative reference for the MenuBoard backend API. It reflects the
route, controller, validation and service code under `backend/src` and the shared DTOs under
`shared/src`. Base path for all API routes is `/api/v1`; a plain health endpoint is exposed at
`/health`.

---

## 1. Common conventions

### 1.1 Headers

| Header | Name in `HEADERS` constant | Required | Purpose |
| --- | --- | --- | --- |
| `Authorization: Bearer <accessToken>` | — | on authenticated routes | JWT access token issued by `POST /auth/login` or `POST /auth/refresh`. |
| `X-Client-Type` | `x-client-type` | on login | `ANDROID` or `ADMIN`. The value is embedded in the access token and all capability checks use the token's client type, not a later header value. |
| `X-Device-Id` | `x-device-id` | on login / refresh / push-token / sync | Stable device identifier used for session binding and push tokens. |
| `X-Request-Id` | `x-request-id` | optional | Correlation id. The backend echoes it back on the same response header and includes it in every error envelope. |
| `X-Idempotency-Key` | `x-idempotency-key` | optional | Reserved header defined in `shared/src/constants/index.ts`; the REST middleware does not currently consume it. Sync idempotency is handled by `clientOpId` inside `POST /sync/push`. |

HTTP headers are case-insensitive; the values above are the exact names exported from
`HEADERS`.

### 1.2 Response envelope

Every response is wrapped in `ApiResponse<T>` (`shared/src/dto/common.ts`):

```typescript
// 200/201 success
interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

// 4xx/5xx error
interface ApiErrorBody {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: ApiFieldError[]; // only for VALIDATION_FAILED
    requestId: string;
  };
}

interface ApiFieldError {
  path: string;
  message: string;
}
```

Paginated list endpoints return the array in `data` and pagination metadata in `meta`:

```typescript
interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
```

### 1.3 Standard error codes

These map to the `AppError` hierarchy in `backend/src/utils/errors.ts`:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | Request body, query or params failed Zod validation. `error.details` contains field-level messages. |
| `UNAUTHENTICATED` | 401 | Missing or malformed bearer token. |
| `TOKEN_EXPIRED` | 401 | Refresh token has expired. |
| `TOKEN_INVALID` | 401 | Access or refresh token cannot be verified / user no longer exists / role changed. |
| `REFRESH_REUSED` | 401 | Refresh token was already consumed; the whole device chain is revoked. |
| `INVALID_CREDENTIALS` | 401 | Login identifier or password is wrong (deliberately generic). |
| `ACCOUNT_INACTIVE` | 403 | User status is `INACTIVE` or `SUSPENDED`. |
| `ADMIN_ROLE_REQUIRED` | 403 | `clientType: "ADMIN"` was used to log in (or refresh) by a role other than `ADMIN`. The Admin Portal is restricted to the `ADMIN` role only — Super Admin, Manager, User and Employee are rejected. |
| `FORBIDDEN` | 403 | Authenticated user lacks the required capability or board role. |
| `CLIENT_NOT_PERMITTED` | 403 | The Android client type is not allowed to use this capability (e.g. billing, user write, master write, reports). |
| `NOT_FOUND` | 404 | Resource or route does not exist. |
| `CONFLICT` | 409 | Business rule conflict: duplicate, stale relation, terminal state, open orders blocking archive, etc. |
| `STALE_WRITE` | 409 | Optimistic concurrency failure (`expectedRevision` mismatch on `PATCH /orders/:orderId`). |
| `INVALID_STATUS_TRANSITION` | 409 | Requested order status change is not in `ORDER_STATUS_TRANSITIONS`. |
| `RATE_LIMITED` | 429 | Too many requests (auth, upload, sync and global API rate limits). |
| `PAYLOAD_TOO_LARGE` | 413 | Uploaded file or request body too large. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | File MIME type not in the allowed image/audio/PDF whitelist. |
| `INTERNAL_ERROR` | 500 | Unexpected server fault; the message is replaced with a generic one. |

In addition, `VALIDATION_FAILED`, `NOT_FOUND`, `FORBIDDEN` and `CONFLICT` are possible on
almost every endpoint when the input is invalid or the referenced resource does not exist or
is not accessible.

### 1.4 Scalars

- `Uuid` — RFC-4122 UUID string.
- `IsoDateTime` — ISO-8601 UTC with milliseconds, e.g. `2026-08-05T09:30:00.000Z`.
- `IsoDate` — `YYYY-MM-DD` calendar date, no timezone.
- `ClockTime` — `HH:mm` wall-clock time, no timezone.

---

## 2. Auth

Base: `/api/v1/auth`

### `POST /auth/login`

- **Auth:** none
- **Rate limit:** `authRateLimit`
- **Body:** `LoginRequest` (`shared/src/dto/auth.ts`)
  - `identifier: string` — username, phone or email
  - `password: string`
  - `deviceId: string`
  - `deviceName?: string | null`
  - `clientType: "ANDROID" | "ADMIN"`
  - `rememberMe?: boolean`
- **Response:** `201 ApiSuccess<LoginResponse>`
  - `LoginResponse` = `{ user: AuthenticatedUser, tokens: AuthTokens, capabilities: string[] }`
- **Notable codes:** `INVALID_CREDENTIALS` (401), `ACCOUNT_INACTIVE` (403), `ADMIN_ROLE_REQUIRED` (403 — `clientType: "ADMIN"` from any role other than `ADMIN`), `RATE_LIMITED` (429).

### `POST /auth/refresh`

- **Auth:** none (uses refresh token)
- **Rate limit:** `authRateLimit`
- **Body:** `RefreshRequest`
  - `refreshToken: string`
  - `deviceId: string`
- **Response:** `200 ApiSuccess<AuthTokens>`
- **Notable codes:** `TOKEN_INVALID` (401), `TOKEN_EXPIRED` (401), `REFRESH_REUSED` (401, revokes device chain).

### `POST /auth/logout`

- **Auth:** bearer
- **Body:** `LogoutRequest`
  - `refreshToken?: string`
  - `allDevices?: boolean` — revokes every session for the user when `true`
- **Response:** `204`

### `GET /auth/me`

- **Auth:** bearer
- **Response:** `200 ApiSuccess<{ user: AuthenticatedUser, capabilities: string[] }>`
  - `capabilities` are the caller's effective capabilities already filtered by client type.

### `POST /auth/password`

- **Auth:** bearer
- **Body:** `ChangePasswordRequest`
  - `currentPassword: string`
  - `newPassword: string` — min 8, max 128
- **Response:** `204`
- **Behaviour:** all existing sessions for the user are revoked.
- **Notable codes:** `VALIDATION_FAILED` (current password wrong or new password unchanged).

### `POST /auth/push-token`

- **Auth:** bearer
- **Body:** `RegisterPushTokenRequest`
  - `deviceId: string`
  - `pushToken: string`
- **Response:** `204`

---

## 3. Users

Base: `/api/v1/users` — Admin Portal only. `USER_WRITE` and `USER_ROLE_ASSIGN` are in
`ANDROID_FORBIDDEN_CAPABILITIES`, so an `ANDROID` token receives `CLIENT_NOT_PERMITTED` here.

### `GET /users`

- **Auth/capability:** `requireCapability(USER_READ)`
- **Query:** `userListQuerySchema` (extends `pageQuery` + `sortQuery`)
  - `page?: number`
  - `pageSize?: number` — max 100
  - `search?: string`
  - `role?: UserRole`
  - `status?: UserStatus`
  - `sortBy?: string`
  - `sortDir?: "asc" | "desc"`
- **Response:** `200 ApiSuccess<UserDto[]>` with `meta` pagination.

### `GET /users/:id`

- **Auth/capability:** `requireCapability(USER_READ)`
- **Params:** `id: Uuid`
- **Response:** `200 ApiSuccess<UserDto>`

### `POST /users`

- **Auth/capability:** `requireCapability(USER_WRITE)`
- **Body:** `CreateUserRequest`
  - `id?: Uuid`
  - `employeeCode?: string | null`
  - `name: string` — max 150
  - `username: string` — 3–100, `[a-zA-Z0-9._-]`
  - `phone?: string | null` — `+?[0-9]{7,20}`
  - `email?: string | null` — valid email, max 190
  - `password: string` — 8–128
  - `role: UserRole`
  - `status?: UserStatus` — defaults to `ACTIVE`
- **Response:** `201 ApiSuccess<UserDto>`
- **Notable codes:** `CONFLICT` (duplicate username), `FORBIDDEN` (only `SUPER_ADMIN` may assign `SUPER_ADMIN`).

### `PATCH /users/:id`

- **Auth/capability:** `requireCapability(USER_WRITE)`
- **Body:** `UpdateUserRequest` — at least one field required; `password` forces `mustChangePassword`
- **Response:** `200 ApiSuccess<UserDto>`
- **Notable codes:** `CONFLICT` (demoting/deactivating the last active `SUPER_ADMIN`).

### `DELETE /users/:id`

- **Auth/capability:** `requireCapability(USER_WRITE)`
- **Response:** `204`
- **Notable codes:** `VALIDATION_FAILED` (cannot delete own account), `CONFLICT` (last active `SUPER_ADMIN`).

---

## 4. Stations

Base: `/api/v1/stations`

A `Station` is the real-world site a board operates at (e.g. "Barsana", "Mangarh"). It sits
above `Board` in the hierarchy: `Station -> Board`. Reads require `MASTER_READ` (every role);
writes require `MASTER_WRITE` (Admin Portal only), matching every other master data endpoint
(activity types, menu).

### `GET /stations`

- **Query:** `stationListQuerySchema` — `page?, pageSize?, search?, status?: MasterStatus`
- **Response:** `200 ApiSuccess<StationDto[]>` with pagination `meta`.

### `GET /stations/:id`

- **Response:** `200 ApiSuccess<StationDto>`

### `POST /stations`

- **Body:** `CreateStationRequest` — `id?, name (max 120), code? (max 60), description? (max 1000), status?`
- **Response:** `201 ApiSuccess<StationDto>`

### `PATCH /stations/:id`

- **Body:** `UpdateStationRequest` — at least one field required
- **Response:** `200 ApiSuccess<StationDto>`

### `DELETE /stations/:id`

- **Response:** `204`
- **Notable codes:** `CONFLICT` — refused while any board still belongs to this station;
  move or archive its boards first (deactivate the station instead of deleting it if you
  just want it hidden).

## 5. Boards

Base: `/api/v1/boards`

A board always belongs to exactly one station (`stationId`). Board names are **not**
globally unique — "Canteen Board" may exist at both Barsana and Mangarh as two independent
boards with independent membership.

### `GET /boards`

- **Auth:** bearer (route is under global `authenticate`)
- **Query:** `boardListQuerySchema` (extends `pageQuery`)
  - `page?, pageSize?` — max 100
  - `search?: string`
  - `status?: BoardStatus`
  - `stationId?: Uuid` — restrict to boards at one station
  - `withCounts?: boolean` — adds `openOrderCount` and `todayOrderCount` to each item
- **Response:** `200 ApiSuccess<BoardWithMembersDto[]>` with pagination `meta`.
- **Behaviour:** administrators see every board; everyone else sees only boards they actively belong to.

### `POST /boards`

- **Auth/capability:** `requireCapability(BOARD_CREATE)`
- **Body:** `CreateBoardRequest`
  - `id?: Uuid`
  - `stationId: Uuid` — required; the board's station
  - `name: string` — max 120
  - `description?: string | null` — max 1000
  - `color?: string | null` — hex swatch `#RRGGBB`
  - `photoPath?: string | null` — max 500, storage path of an uploaded board photo
  - `members?: { userId: Uuid, boardRole: BoardRole }[]` — max 200; creator is always `OWNER`
- **Response:** `201 ApiSuccess<BoardWithMembersDto>`
- **Notable codes:** `NOT_FOUND` (station or seeded member user does not exist).

### `GET /boards/:boardId`

- **Auth/capability:** `requireBoardAccess(ORDER_READ)`
- **Params:** `boardId: Uuid`
- **Response:** `200 ApiSuccess<BoardWithMembersDto>`

### `PATCH /boards/:boardId`

- **Auth/capability:** `requireBoardAccess(BOARD_UPDATE)`
- **Body:** `UpdateBoardRequest` — at least one field required
  - `stationId?: Uuid` — re-parents the board to a different station
  - `name?: string`
  - `description?: string | null`
  - `color?: string | null` — hex swatch `#RRGGBB`
  - `photoPath?: string | null` — max 500, storage path of an uploaded board photo
  - `status?: BoardStatus`
- **Response:** `200 ApiSuccess<BoardDto>`
- **Notable codes:** `NOT_FOUND` (new `stationId` does not exist).

### `POST /boards/:boardId/archive`

- **Auth/capability:** `requireBoardAccess(BOARD_ARCHIVE)`
- **Response:** `200 ApiSuccess<BoardDto>`
- **Notable codes:** `CONFLICT` (board still has open orders).

---

## 6. Board members

Base: `/api/v1/boards/:boardId/members` (the board routes above are prefixed `/api/v1`).

### `GET /boards/:boardId/members`

- **Auth/capability:** `requireBoardAccess(ORDER_READ)`
- **Response:** `200 ApiSuccess<BoardMemberDto[]>`

### `PUT /boards/:boardId/members`

- **Auth/capability:** `requireBoardAccess(BOARD_MEMBER_MANAGE)` (granted globally to `ADMIN` and scoped to a board for `OWNER`/`MANAGER` board roles)
- **Body:** `UpsertBoardMemberRequest`
  - `userId: Uuid`
  - `boardRole: BoardRole`
- **Response:** `200 ApiSuccess<BoardMemberDto>`
- **Notable codes:** `NOT_FOUND` (user or board), `CONFLICT` (removing the last `OWNER`).

### `DELETE /boards/:boardId/members/:userId`

- **Auth/capability:** `requireBoardAccess(BOARD_MEMBER_MANAGE)` (granted globally to `ADMIN` and scoped to a board for `OWNER`/`MANAGER` board roles)
- **Params:** `boardId: Uuid`, `userId: Uuid`
- **Response:** `204`
- **Notable codes:** `NOT_FOUND` (member not active), `CONFLICT` (last owner).

### `GET /boards/:boardId/eligible-members`

- **Auth/capability:** `requireBoardAccess(BOARD_MEMBER_MANAGE)` (granted globally to `ADMIN` and scoped to a board for `OWNER`/`MANAGER` board roles)
- **Query:** `boardEligibleMembersQuerySchema`
  - `search?: string` — max 190
- **Response:** `200 ApiSuccess<BoardEligibleUserDto[]>` — active users not already a member of this board, max 50.
- **Why this exists rather than reusing `GET /users`:** `GET /users` requires the *global*
  `USER_READ` capability, which a plain `USER`-role account holding board `OWNER`/`MANAGER`
  does not have. This endpoint is gated on `BOARD_MEMBER_MANAGE` instead, which is held
  globally by `ADMIN` and scoped to a board for `OWNER`/`MANAGER` board roles, so they can
  pick a member to add without needing global user-management rights (still Admin-Portal-only,
  per `docs/MENUBOARD_SPEC.md`).

---

## 7. Board feed

Base: `/api/v1/boards/:boardId/messages`

The board feed is the single, unified message timeline for a board — the app's primary
screen. It is the same `thread_messages` entity documented in [§10](#10-thread-messages);
this section only adds the board-scoped read/write endpoints.

Every message carries `boardId`. `orderId` is **optional**:

- `orderId === null` — a general board post (text, voice note, attachment).
- `orderId` set — the message is *about* that order (a comment, a correction, a voice note),
  and renders nested under that order's card in the same feed rather than in a separate screen.

Orders themselves appear in the feed as `SYSTEM`/`ORDER_CREATED` rows written by
`OrderService.create()` in the same transaction as the order; the app renders them as the
structured order card (date/time/venue/pax + line items + acknowledgements). `systemMeta` is
a display snapshot — the `orders` row stays authoritative for live status.

### `GET /boards/:boardId/messages`

- **Auth/capability:** `requireBoardAccess(THREAD_READ)`
- **Query:** `boardFeedQuerySchema`
  - `limit?: number` — max 100, default 50
  - `before?: IsoDateTime` — keyset cursor, newest first
- **Response:** `200 ApiSuccess<ThreadMessageDto[]>` — the whole board feed, both general posts
  and order-scoped messages, in one chronological page.

### `POST /boards/:boardId/messages`

- **Auth/capability:** `requireBoardAccess(THREAD_POST)`
- **Body:** `CreateThreadMessageRequest` (see §10) — `orderId` may be set to attach the message
  to an order, or omitted for a general board post.
- **Response:** `201 ApiSuccess<ThreadMessageDto>`

Deleting (unsending) uses the existing `DELETE /thread/:messageId` in §10.

### `GET /boards/:boardId/eligible-members`

- **Auth/capability:** `requireBoardAccess(BOARD_MEMBER_MANAGE)` (granted globally to `ADMIN` and scoped to a board for `OWNER`/`MANAGER` board roles)
- **Query:** `boardEligibleMembersQuerySchema`
  - `search?: string` — max 190
- **Response:** `200 ApiSuccess<BoardEligibleUserDto[]>` — active users not already a member of this board, max 50.
- **Why this exists rather than reusing `GET /users`:** `GET /users` requires the *global*
  `USER_READ` capability, which a plain `USER`-role account holding board `OWNER`/`MANAGER`
  does not have. This endpoint is gated on `BOARD_MEMBER_MANAGE` instead, which is held
  globally by `ADMIN` and scoped to a board for `OWNER`/`MANAGER` board roles, so they can
  pick a member to add without needing global user-management rights (still Admin-Portal-only,
  per `docs/MENUBOARD_SPEC.md`).

---

## 8. Masters

Mounted at `/api/v1/` (not under `/masters`). Reads require `MASTER_READ` (held by every
authenticated role). Writes require `MASTER_WRITE`, which is in
`ANDROID_FORBIDDEN_CAPABILITIES`, so Android clients get `CLIENT_NOT_PERMITTED` for writes.

### 6.1 Activity types

#### `GET /activity-types`

- **Auth/capability:** `requireCapability(MASTER_READ)`
- **Query:** `masterListQuerySchema`
- **Response:** `200 ApiSuccess<ActivityTypeDto[]>` with pagination `meta`.

#### `POST /activity-types`

- **Auth/capability:** `requireCapability(MASTER_WRITE)`
- **Body:** `ActivityTypeWriteRequest` (`createActivityTypeSchema`)
  - `name: string` — max 120
  - `description?, status?, sortOrder?, icon?: string | null`
- **Response:** `201 ApiSuccess<ActivityTypeDto>`
- **Behaviour:** `isSystem` is always `false` for user-created activity types.

#### `PATCH /activity-types/:id`

- **Auth/capability:** `requireCapability(MASTER_WRITE)`
- **Body:** `Partial<ActivityTypeWriteRequest>`
- **Response:** `200 ApiSuccess<ActivityTypeDto>`

#### `DELETE /activity-types/:id`

- **Auth/capability:** `requireCapability(MASTER_WRITE)`
- **Response:** `204`
- **Notable codes:** `CONFLICT` (system activity types may only be deactivated, not deleted).

### 6.2 Menu categories

#### `GET /menu-categories`

- **Auth/capability:** `requireCapability(MASTER_READ)`
- **Query:** `masterListQuerySchema`
- **Response:** `200 ApiSuccess<MenuCategoryDto[]>` with pagination `meta`.

#### `POST /menu-categories`

- **Auth/capability:** `requireCapability(MASTER_WRITE)`
- **Body:** `MenuCategoryWriteRequest` (`createMenuCategorySchema`)
  - `name: string` — max 120
  - `description?, status?, sortOrder?, imagePath?: string | null`
- **Response:** `201 ApiSuccess<MenuCategoryDto>`

#### `PATCH /menu-categories/:id`

- **Auth/capability:** `requireCapability(MASTER_WRITE)`
- **Body:** `Partial<MenuCategoryWriteRequest>`
- **Response:** `200 ApiSuccess<MenuCategoryDto>`

#### `DELETE /menu-categories/:id`

- **Auth/capability:** `requireCapability(MASTER_WRITE)`
- **Response:** `204`
- **Notable codes:** `CONFLICT` (category still contains menu items).

### 6.3 Menu items

#### `GET /menu-items`

- **Auth/capability:** `requireCapability(MASTER_READ)`
- **Query:** `menuItemListQuerySchema` (extends `masterListQuerySchema`)
  - plus `categoryId?: Uuid`
- **Response:** `200 ApiSuccess<MenuItemDto[]>` with pagination `meta`.

#### `POST /menu-items`

- **Auth/capability:** `requireCapability(MASTER_WRITE)`
- **Body:** `MenuItemWriteRequest` (`createMenuItemSchema`)
  - `id?: Uuid`
  - `categoryId: Uuid`
  - `name: string` — max 150
  - `unit: string` — max 30
  - `description?, status?, sortOrder?, imagePath?: string | null`
- **Response:** `201 ApiSuccess<MenuItemDto>`
- **Notable codes:** `NOT_FOUND` (category does not exist).

#### `PATCH /menu-items/:id`

- **Auth/capability:** `requireCapability(MASTER_WRITE)`
- **Body:** `Partial<MenuItemWriteRequest>`
- **Response:** `200 ApiSuccess<MenuItemDto>`
- **Notable codes:** `NOT_FOUND` (new category does not exist).

#### `DELETE /menu-items/:id`

- **Auth/capability:** `requireCapability(MASTER_WRITE)`
- **Response:** `204`
- **Notable codes:** `CONFLICT` (item appears on one or more orders).

---

## 9. Orders

Base: `/api/v1/orders`

### `GET /orders`

- **Auth:** bearer
- **Query:** `orderListQuerySchema` (extends `pageQuery`)
  - `page?, pageSize?` — max 100
  - `search?: string`
  - `boardId?: Uuid`
  - `status?: OrderStatus[]` — repeated or comma-separated
  - `priority?: OrderPriority[]` — repeated or comma-separated
  - `activityTypeId?: Uuid`
  - `createdBy?: Uuid`
  - `dateFrom?: IsoDate`
  - `dateTo?: IsoDate`
- **Response:** `200 ApiSuccess<OrderDto[]>` with pagination `meta`.
- **Behaviour:** non-administrators only see orders on boards they belong to; administrators see all orders, optionally filtered by `boardId`.

### `POST /orders`

- **Auth:** bearer (board membership / `ORDER_CREATE` is checked inside `OrderService` because the board arrives in the body)
- **Body:** `CreateOrderRequest`
  - `id?: Uuid` — client-generated UUID for offline sync
  - `orderNumber?: string` — `ORD-YYYYMMDD-XXXXXX`; generated automatically if omitted
  - `boardId: Uuid`
  - `activityTypeId?: Uuid | null`
  - `customActivity?: string | null` — max 150
  - `venue: string` — max 200
  - `pax: number` — int, 0–1,000,000
  - `requiredDate: IsoDate`
  - `requiredTime: ClockTime`
  - `priority?: OrderPriority` — defaults to `NORMAL`
  - `items: CreateOrderItemRequest[]` — min 1, max 200
  - `attachmentIds?: Uuid[]` — max 30
- **Validation rules:** either `activityTypeId` must be provided or `customActivity` must be non-empty; and every item must supply exactly one of `menuItemId` / `customItemName` (see §10).
- **Response:** `201 ApiSuccess<OrderDetailDto>`
- **Notable codes:** `CONFLICT` (duplicate order number), `NOT_FOUND` (board/activity/menu item), `VALIDATION_FAILED` (activity missing, or an item naming its dish both ways or neither), `FORBIDDEN` (not a member or `VIEWER` role).

### `GET /orders/:orderId`

- **Auth/capability:** `requireResolvedBoardAccess(ORDER_READ)`
- **Response:** `200 ApiSuccess<OrderDetailDto>`

### `PATCH /orders/:orderId`

- **Auth/capability:** `requireResolvedBoardAccess(ORDER_UPDATE)`
- **Body:** `UpdateOrderRequest`
  - all fields optional except at least one real update required
  - `activityTypeId?, customActivity?, venue?, pax?, requiredDate?, requiredTime?, priority?`
  - `items?: CreateOrderItemRequest[]` — full replacement when present
  - `expectedRevision?: number` — optimistic concurrency guard
- **Response:** `200 ApiSuccess<OrderDetailDto>`
- **Notable codes:** `CONFLICT` (order is `COMPLETED` or `CANCELLED`), `STALE_WRITE` (`expectedRevision` mismatch), `INVALID_STATUS_TRANSITION` not used here (status changes go to the status endpoint).

### `POST /orders/:orderId/assign`

- **Auth/capability:** `requireResolvedBoardAccess(ORDER_ASSIGN)` — Manager and above, or board `OWNER`/`MANAGER`
- **Body:** `AssignOrderRequest`
  - `assignedTo: Uuid | null` — null returns the order to the pool
- **Response:** `200 ApiSuccess<OrderDto>`
- **Behaviour:** idempotent (re-sending the current assignee is a no-op); writes an `ORDER_ASSIGNED` system event; notifies **only the new assignee**, not the whole board. Does **not** move `status` — assignment is independent of the lifecycle.
- **Notable codes:** `VALIDATION_FAILED` (assignee is not a member of this board), `CONFLICT` (order is billed), `NOT_FOUND`.

### `POST /orders/:orderId/status`

- **Auth/capability:** `requireResolvedBoardAccess(ORDER_STATUS_UPDATE)`
- **Body:** `UpdateOrderStatusRequest`
  - `status: OrderStatus`
  - `note?: string | null` — max 1000
- **Response:** `200 ApiSuccess<OrderDto>`
- **Behaviour:** idempotent for the current status. Permitted transitions are:
  - `PENDING` → `ACKNOWLEDGED`, `WORK_IN_PROGRESS`, `CANCELLED`
  - `ACKNOWLEDGED` → `WORK_IN_PROGRESS`, `COMPLETED`, `CANCELLED`
  - `WORK_IN_PROGRESS` → `COMPLETED`, `CANCELLED`
  - `COMPLETED` → (none)
  - `CANCELLED` → (none)
- **Notable codes:** `INVALID_STATUS_TRANSITION` (409), `NOT_FOUND`.

---

## 10. Order items

There are no standalone REST endpoints for individual order items. Items are embedded in:

- `CreateOrderRequest.items` — array of `CreateOrderItemRequest`
- `UpdateOrderRequest.items` — full replacement of the order's item set

### `CreateOrderItemRequest` shape

- `id?: Uuid`
- `menuItemId?: Uuid | null` — a catalogued dish
- `customItemName?: string | null` — max 150; an ad-hoc dish typed on the order
- `quantity: number` — 0–1,000,000, at most 3 decimal places
- `unit?: string` — defaults to the menu item's unit, or `NOS` for an ad-hoc line
- `notes?: string | null` — max 1000
- `mentionedUserIds?: Uuid[]` — max 50 (deduplicated)
- `sortOrder?: number` — defaults to array index

**Validation rule — exactly one of `menuItemId` / `customItemName` must be supplied.**
Supplying both, or neither, returns `VALIDATION_FAILED` on `items`. A blank or whitespace-only
`customItemName` counts as absent.

An ad-hoc line lets a kitchen order something with no master record yet, without waiting for
an Admin. It is order-scoped free text and **does not create a `menu_items` row** — see
`docs/DATABASE.md` §"Ad-hoc order lines" for the effect on shopping lists, billing and recipes.

### `OrderItemDto` shape

Mirrors the above once resolved: `menuItemId: Uuid | null`, `customItemName: string | null`,
with the same exclusivity guarantee (`ck_order_items_dish`). `menuItemName` remains a
denormalised display field, populated only for catalogued lines; clients should render
`customItemName ?? menuItemName`.

Returned in `OrderDetailDto.items` as `OrderItemDto`.

---

## 11. Thread messages

Base: `/api/v1/orders/:orderId/thread` and `/api/v1/thread/:messageId`

A thread message always carries `boardId`. `orderId` is optional — set when the message is
about a specific order, `null` for a general board post. The endpoints in this section are the
order-scoped view of that entity; [§6](#6-board-feed) is the board-wide view of the same rows.

### `GET /orders/:orderId/thread`

- **Auth/capability:** `requireResolvedBoardAccess(THREAD_READ)`
- **Query:** `threadListQuerySchema`
  - `limit?: number` — max 100, default 50
  - `before?: IsoDateTime` — keyset cursor, newest first
- **Response:** `200 ApiSuccess<ThreadMessageDto[]>`

### `POST /orders/:orderId/thread`

- **Auth/capability:** `requireResolvedBoardAccess(THREAD_POST)`
- **Body:** `CreateThreadMessageRequest`
  - `id?: Uuid`
  - `orderId?: Uuid | null` — only meaningful on the board-feed endpoint (§6); on this route the
    path's `:orderId` wins
  - `parentMessageId?: Uuid | null`
  - `body?: string | null` — max 4000
  - `mentionedUserIds?: Uuid[]`
  - `attachmentIds?: Uuid[]` — max 30
- **Validation:** at least one of `body` (non-empty) or `attachmentIds` (non-empty) must be present.
- **Response:** `201 ApiSuccess<ThreadMessageDto>`
- **Behaviour:** mentions are filtered to active board members; replies notify thread participants. System event `ORDER_CREATED` etc. are also represented as `SYSTEM` messages.

### `DELETE /thread/:messageId`

- **Auth/capability:** `requireResolvedBoardAccess(THREAD_READ)` (the route only requires `THREAD_READ`; the controller then checks `THREAD_DELETE_ANY` board capability or own authorship)
- **Response:** `204`
- **Notable codes:** `FORBIDDEN` (system history entries cannot be deleted; or not the author and lacking `THREAD_DELETE_ANY`), `NOT_FOUND`.

---

## 12. Acknowledgements

Base: `/api/v1/orders/:orderId/acknowledgements`

### `GET /orders/:orderId/acknowledgements`

- **Auth/capability:** `requireResolvedBoardAccess(ORDER_READ)`
- **Response:** `200 ApiSuccess<{ acknowledgements: AcknowledgementDto[], pendingUserIds: Uuid[] }>`

### `POST /orders/:orderId/acknowledgements`

- **Auth/capability:** `requireResolvedBoardAccess(ORDER_ACKNOWLEDGE)`
- **Body:** `CreateAcknowledgementRequest`
  - `id?: Uuid`
  - `note?: string | null` — max 1000
- **Response:** `201 ApiSuccess<AcknowledgementDto>`
- **Behaviour:** idempotent per `(order_id, user_id)`. A first acknowledgement on a `PENDING` order automatically transitions it to `ACKNOWLEDGED` and writes a `SYSTEM` message.
- **Notable codes:** `FORBIDDEN` (not a board member).

### `DELETE /orders/:orderId/acknowledgements`

- **Auth/capability:** `requireResolvedBoardAccess(ORDER_ACKNOWLEDGE)`
- **Response:** `204`
- **Behaviour:** withdraws the signed-in user's own acknowledgement.
- **Notable codes:** `NOT_FOUND` (no active acknowledgement to withdraw).

---

## 13. Attachments

Base: `/api/v1/attachments`

Media upload is a two-stage process: (1) `POST /attachments/upload` creates the row and stores
the bytes; (2) `POST /attachments/bind` links an unbound attachment to its owner (order or
thread message). Downloads use signed, time-limited URLs.

### `POST /attachments/upload`

- **Auth:** bearer (board-scoped upload capability is checked inside `AttachmentService`)
- **Rate limit:** `uploadRateLimit`
- **Middleware:** `uploadSingleMedia` (Multer) expects multipart field `file`
- **Query:** `uploadQuerySchema`
  - `attachmentId?: Uuid` — client-generated UUID for the attachment row
  - `ownerType: "ORDER" | "THREAD_MESSAGE"`
  - `ownerId?: Uuid` — may be omitted if the attachment is uploaded before the owner exists
  - `durationMs?: number` — voice note duration in ms, max 5 minutes
  - `width?: number`
  - `height?: number`
- **File limits:**
  - Images: `image/jpeg`, `image/png`, `image/webp`, max 8 MB
  - Audio: `audio/m4a`, `audio/mp4`, `audio/aac`, `audio/mpeg`, `audio/webm`, max 16 MB
  - Documents: `application/pdf`, max 20 MB
- **Response:** `201 ApiSuccess<AttachmentUploadResult>`
  - `AttachmentUploadResult = { attachment: AttachmentDto, url: string }`
- **Notable codes:** `UNSUPPORTED_MEDIA_TYPE` (415), `PAYLOAD_TOO_LARGE` (413), `CONFLICT` (owner already has 30 attachments), `FORBIDDEN` (caller cannot attach to this board).

### `POST /attachments/bind`

- **Auth:** bearer
- **Body:** `bindAttachmentsSchema`
  - `attachmentIds: Uuid[]` — min 1, max 30
  - `ownerType: "ORDER" | "THREAD_MESSAGE"`
  - `ownerId: Uuid`
- **Response:** `200 ApiSuccess<{ bound: number }>`
- **Notable codes:** `FORBIDDEN` (caller lacks attach permission for the board).

### `GET /attachments/:id/url`

- **Auth:** bearer
- **Params:** `id: Uuid`
- **Response:** `200 ApiSuccess<{ url: string }>`
- **Behaviour:** mints a fresh signed URL. Access is re-verified before the URL is issued.

### `GET /attachments/:id/file` — public download

- **Auth:** none (signed URL only)
- **Query:** `attachmentFileQuerySchema`
  - `expires: string` — Unix timestamp in seconds
  - `uid: Uuid` — authorised user id
  - `sig: string` — HMAC signature
- **Response:** raw file stream with `Content-Type`, `Content-Length`, `Cache-Control: private, max-age=86400` and `Content-Disposition: inline; filename="..."`.
- **Notable codes:** `FORBIDDEN` (invalid or expired signature, or membership has changed), `NOT_FOUND` (file missing).

### `DELETE /attachments/:id`

- **Auth:** bearer (no route-level capability guard — the same board-vs-global ambiguity as
  `POST /attachments/upload` means `AttachmentService.remove` performs the check itself)
- **Response:** `204`
- **Behaviour:** the uploader may always delete their own attachment. Deleting someone else's
  attachment additionally requires `ATTACHMENT_DELETE_ANY` — granted globally to
  `SUPER_ADMIN`/`ADMIN`, or per-board to `OWNER` only (see `BOARD_ROLE_CAPABILITIES`). Fixed in
  Phase 7: a plain `MEMBER` (or `MANAGER`, who also lacks this capability) previously could
  delete another member's attachment merely by not being a `VIEWER`; this is now enforced
  correctly and covered by `backend/scripts/smoke.mjs`'s "Attachment delete authorization"
  section.
- **Notable codes:** `NOT_FOUND`, `FORBIDDEN`.

---

## 14. Notifications

Base: `/api/v1/notifications` — always operates on the signed-in user's own inbox.

### `GET /notifications`

- **Auth:** bearer
- **Query:** `notificationListQuerySchema` (extends `pageQuery`)
  - `page?, pageSize?`, `search?`
  - `unreadOnly?: boolean`
- **Response:** `200 ApiSuccess<NotificationDto[]>` with pagination `meta`.

### `GET /notifications/unread-count`

- **Auth:** bearer
- **Response:** `200 ApiSuccess<{ unread: number }>`

### `POST /notifications/read`

- **Auth:** bearer
- **Body:** `markReadSchema`
  - `ids: Uuid[]` — min 1, max 500
- **Response:** `200 ApiSuccess<{ updated: number, cursor: number }>`
- **Behaviour:** emits `sync:hint` to the user's socket room if any rows changed.

### `POST /notifications/read-all`

- **Auth:** bearer
- **Response:** `200 ApiSuccess<{ updated: number, cursor: number }>`
- **Behaviour:** emits `sync:hint` if any rows changed.

### `DELETE /notifications/:id`

- **Auth:** bearer
- **Params:** `id: Uuid`
- **Response:** `200 ApiSuccess<{ removed: boolean, cursor: number }>`
- **Behaviour:** permanently removes the notification from the caller's own inbox via a
  tombstone (`deleted_at`), so it drops out of `GET /notifications` immediately and other
  signed-in devices pick up the removal on their next sync pull. Emits `sync:hint` on success.
- **Notable codes:** `NOT_FOUND` (already removed, or not this user's notification).

---

## 15. Sync

Base: `/api/v1/sync` — all routes require `SYNC_USE` and use `syncRateLimit`.

### `GET /sync/status`

- **Auth/capability:** `requireCapability(SYNC_USE)`
- **Response:** `200 ApiSuccess<{ cursor: number, serverTime: IsoDateTime }>`

### `POST /sync/push`

- **Auth/capability:** `requireCapability(SYNC_USE)`
- **Body:** `SyncPushRequest`
  - `deviceId: string` — max 120
  - `items: SyncPushItem[]` — min 1, max 200
- **Response:** `200 ApiSuccess<SyncPushResponse>`
  - `results: SyncPushItemResult[]`
  - `cursor: number`
  - `serverTime: IsoDateTime`
- **Pushable entities:** `boards`, `orders`, `order_items`, `attachments`, `thread_messages`, `acknowledgements`. Pushing any other entity returns `REJECTED`.

See the dedicated **Sync endpoints** section below for the per-item result status semantics.

### `POST /sync/pull`

- **Auth/capability:** `requireCapability(SYNC_USE)`
- **Body:** `SyncPullRequest`
  - `deviceId: string`
  - `cursor: number` — last applied cursor; `0` for full initial sync
  - `limit?: number` — max 2000, default 500
  - `entities?: SyncEntity[]` — restrict to a subset; omitted means all
- **Response:** `200 ApiSuccess<SyncPullResponse>`
  - `changes: SyncChangeSet` — groups rows by entity in dependency order
  - `cursor: number`
  - `hasMore: boolean`
  - `serverTime: IsoDateTime`

---

## 16. Admin

Base: `/api/v1/admin` — the whole group uses `denyClient(ClientType.ANDROID)` at the mount
point, so every route returns `CLIENT_NOT_PERMITTED` for an `ANDROID` token regardless of role.
Individual routes then require their specific capability.

### 14.1 Dashboard

#### `GET /admin/dashboard`

- **Auth/capability:** `requireCapability(REPORT_READ)`
- **Response:** `200 ApiSuccess<DashboardSummary>`

### 14.2 Permissions

#### `GET /admin/permissions`

- **Auth/capability:** `requireCapability(PERMISSION_READ)`
- **Response:** `200 ApiSuccess<{ roleCapabilities, boardRoleCapabilities, androidForbiddenCapabilities }>`
- **Behaviour:** returns the exact matrices from `shared/src/permissions/index.ts` so the Admin Portal renders what the backend enforces.

### 14.3 Reports

#### `GET /admin/reports/:kind`

- **Auth/capability:** `requireCapability(REPORT_READ)`
- **Params:** `kind: ReportKind` (`ORDERS_BY_BOARD`, `ORDERS_BY_DATE`, `ORDERS_BY_USER`, `COMPLETED_ORDERS`, `PENDING_ORDERS`, `ACTIVITY_SUMMARY`, `BILLING_EXPORT_HISTORY`)
- **Query:** `reportQuerySchema`
  - `dateFrom: IsoDate` (required)
  - `dateTo: IsoDate` (required)
  - `boardId?: Uuid`
  - `userId?: Uuid`
  - `activityTypeId?: Uuid`
  - `page?, pageSize?` — max 100
- **Response:** `200 ApiSuccess<{ kind: ReportKind, rows: T[] }>`
  - For `COMPLETED_ORDERS`, `PENDING_ORDERS` and `BILLING_EXPORT_HISTORY` an additional `page: Paginated<never>` meta object is returned.
- **Notable codes:** `VALIDATION_FAILED` (`dateTo` before `dateFrom`), `VALIDATION_FAILED` (unknown report kind).

### 14.4 Billing

#### `GET /admin/billing`

- **Auth/capability:** `requireCapability(BILLING_READ)`
- **Query:** `billingListQuerySchema` (extends `pageQuery`)
  - `boardId?, status?, dateFrom?, dateTo?, page?, pageSize?`
- **Response:** `200 ApiSuccess<BillingExportDto[]>` with pagination `meta`.

#### `GET /admin/billing/:id`

- **Auth/capability:** `requireCapability(BILLING_READ)`
- **Response:** `200 ApiSuccess<BillingExportDto>`

#### `GET /admin/billing/:id/snapshot`

- **Auth/capability:** `requireCapability(BILLING_READ)`
- **Response:** `200 ApiSuccess<BillingSnapshot>`
- **Behaviour:** returns the immutable JSON snapshot exactly as generated; it is never recomputed.

#### `POST /admin/billing/generate`

- **Auth/capability:** `requireCapability(BILLING_GENERATE)`
- **Body:** `GenerateBillingRequest`
  - `boardId?: Uuid | null`
  - `periodFrom: IsoDate`
  - `periodTo: IsoDate`
  - `notes?: string | null`
- **Response:** `201 ApiSuccess<BillingExportDto>`
- **Notable codes:** `VALIDATION_FAILED` (period inverted), `CONFLICT` (no completed orders in period), `NOT_FOUND` (board).

#### `POST /admin/billing/:id/status`

- **Auth/capability:** `requireCapability(BILLING_GENERATE)`
- **Body:** `billingStatusSchema`
  - `status: "FINALIZED" | "CANCELLED"`
- **Response:** `200 ApiSuccess<BillingExportDto>`
- **Notable codes:** `CONFLICT` (export is already terminal), `VALIDATION_FAILED` (cannot return to `GENERATED`).

### 14.5 Audit

#### `GET /admin/audit`

- **Auth/capability:** `requireCapability(AUDIT_READ)`
- **Query:** `auditListQuerySchema` (extends `pageQuery`)
  - `actorId?, action?, entityType?, entityId?, boardId?, dateFrom?, dateTo?, page?, pageSize?`
- **Response:** `200 ApiSuccess<AuditLogDto[]>` with pagination `meta`.

#### `GET /admin/audit/:entityType/:entityId`

- **Auth/capability:** `requireCapability(AUDIT_READ)`
- **Params:** `entityType: string` (trim, 1–60), `entityId: string` (trim, 1–64)
- **Response:** `200 ApiSuccess<AuditLogDto[]>` — up to 100 rows.

### 14.6 Settings

#### `GET /admin/settings`

- **Auth/capability:** `requireCapability(SETTINGS_READ)`
- **Response:** `200 ApiSuccess<SettingDto[]>`

#### `PUT /admin/settings/:key`

- **Auth/capability:** `requireCapability(SETTINGS_WRITE)`
- **Params:** `key: string` (trim, 1–120)
- **Body:** `settingValueSchema`
  - `value: unknown`
- **Response:** `200 ApiSuccess<SettingDto>`
- **Notable codes:** `NOT_FOUND` (unknown setting key), `VALIDATION_FAILED` (value fails the setting's validator).

Currently defined settings (from `SettingsService`):

- `orders.default_priority` — `LOW`/`NORMAL`/`HIGH`/`URGENT`
- `orders.require_acknowledgement` — boolean
- `notifications.push_enabled` — boolean
- `sync.pull_limit` — integer 50–2000
- `media.orphan_sweep_hours` — integer 1–720
- `organisation.name` — string 1–150

---

## 17. Socket.IO

The Socket.IO server is attached to the same HTTP listener as the REST API. It is a **hint
channel only**; payloads never carry full entity bodies. Clients pull deltas through the normal
`POST /sync/pull` cursor path after receiving a hint.

### 15.1 Connection and authentication

```javascript
const socket = io(BASE_URL, {
  auth: { token: accessToken },
  // or pass the token in the Authorization header at handshake
});
```

The server accepts the access token from `socket.handshake.auth.token` or from the
`Authorization: Bearer ...` handshake header. It verifies the token and rejects suspended or
missing users with `UNAUTHENTICATED`. Connection parameters:

- `pingTimeout: 25_000`
- `pingInterval: 20_000`
- `maxHttpBufferSize: 1e5`

### 15.2 Rooms

| Room | Name | Purpose |
| --- | --- | --- |
| Per-user | `user:<userId>` | Personal notifications and `sync:hint`. |
| Per-board | `board:<boardId>` | Order, thread, acknowledgement and membership activity for a board. |
| Global masters | `masters` | Master-data change hints for all authenticated sockets. |

On connection the server automatically joins the personal room, the `masters` room and every
board the user is an active member of.

### 15.3 Client → server events

| Event | Payload | Behaviour |
| --- | --- | --- |
| `board:join` | `string` (board id) or `{ boardId: string }` | Membership is re-verified before joining `board:<boardId>`. |
| `board:leave` | `string` (board id) or `{ boardId: string }` | Leaves `board:<boardId>`. |

### 15.4 Server → client events

| Event | Direction | Payload | Emitted from |
| --- | --- | --- | --- |
| `entity:changed` | S→C | `{ boardId, entities: SyncEntity[], cursor }` | `SyncService.push` (touched boards, `orders`/`thread_messages`/`acknowledgements`), `BoardService.update` (`boards`), `AttachmentService.announce` (`attachments`), `ThreadService.remove` (`thread_messages`), `AcknowledgementService.withdraw` (`acknowledgements`) |
| `order:changed` | S→C | `{ boardId, orderId, cursor }` | `OrderService.create`, `OrderService.update`, `OrderService.updateStatus` |
| `thread:message:created` | S→C | `{ boardId, orderId, messageId, cursor }` | `ThreadService.post` |
| `acknowledgement:created` | S→C | `{ boardId, orderId, userId, cursor }` | `AcknowledgementService.acknowledge` |
| `notification:created` | S→C | `{ notificationId, cursor }` | `NotificationService.publish` (called by order/thread/ack/board services) |
| `board:membership:changed` | S→C | `{ boardId, cursor }` | `BoardService.create`, `BoardService.upsertMember`, `BoardService.removeMember` — sent to both the `board:<id>` room and each affected `user:<id>` room |
| `master:changed` | S→C | `{ entity, cursor }` | `MasterService` create/update/delete for any master entity |
| `sync:hint` | S→C | `{ cursor }` | `NotificationService.markRead` and `NotificationService.markAllRead` |

### 15.5 Event constants

All names come from `SOCKET_EVENTS` in `shared/src/constants/index.ts`:

```typescript
SOCKET_EVENTS = {
  // server → client
  ENTITY_CHANGED: 'entity:changed',
  ORDER_CHANGED: 'order:changed',
  THREAD_MESSAGE_CREATED: 'thread:message:created',
  ACKNOWLEDGEMENT_CREATED: 'acknowledgement:created',
  NOTIFICATION_CREATED: 'notification:created',
  BOARD_MEMBERSHIP_CHANGED: 'board:membership:changed',
  MASTER_CHANGED: 'master:changed',
  SYNC_HINT: 'sync:hint',
  // client → server
  JOIN_BOARD: 'board:join',
  LEAVE_BOARD: 'board:leave',
};
```

---

## 18. Sync endpoints (short reference)

For the conceptual narrative (offline queue, retry, conflict resolution) see
`docs/ARCHITECTURE.md` §6. This section only records the exact wire shapes used by the
Android sync engine.

### `POST /api/v1/sync/push`

**Request body:** `SyncPushRequest`

```typescript
interface SyncPushRequest {
  deviceId: string;
  items: SyncPushItem[]; // min 1, max 200
}

interface SyncPushItem {
  clientOpId: Uuid;          // idempotency key for the device queue
  entity: PushableEntity;      // 'boards' | 'orders' | 'order_items' | 'attachments' | 'thread_messages' | 'acknowledgements'
  entityId: Uuid;
  op: 'UPSERT' | 'DELETE';
  payload: Record<string, unknown> | null; // full entity for UPSERT, null for DELETE
  clientTimestamp: IsoDateTime;
  baseRevision?: number;
}
```

**Response body:** `SyncPushResponse`

```typescript
interface SyncPushResponse {
  results: SyncPushItemResult[];
  cursor: number;
  serverTime: IsoDateTime;
}

interface SyncPushItemResult {
  clientOpId: Uuid;
  entity: PushableEntity;
  entityId: Uuid;
  status: SyncResultStatus;
  serverEntity?: unknown;
  errorCode?: string;
  errorMessage?: string;
}
```

`SyncResultStatus` values:

- `APPLIED` — server accepted the change; remove from queue.
- `DUPLICATE` — already applied by an earlier attempt; remove from queue.
- `SUPERSEDED` — server copy won last-write-wins; adopt `serverEntity`.
- `REJECTED` — terminal failure (validation, permission, missing parent); do not retry.
- `FAILED` — transient failure; retry with backoff.

### `POST /api/v1/sync/pull`

**Request body:** `SyncPullRequest`

```typescript
interface SyncPullRequest {
  deviceId: string;
  cursor: number;        // last applied cursor; 0 for full initial sync
  limit?: number;        // max 2000, default 500
  entities?: SyncEntity[]; // subset filter; omitted means all
}
```

`SyncEntity` = `users` | `boards` | `board_members` | `stations` | `activity_types` |
`menu_categories` | `menu_items` | `orders` | `order_items` | `attachments` |
`thread_messages` | `acknowledgements` | `notifications`.

**Response body:** `SyncPullResponse`

```typescript
interface SyncPullResponse {
  changes: SyncChangeSet;
  cursor: number;
  hasMore: boolean;
  serverTime: IsoDateTime;
}
```

`SyncChangeSet` has one array per `SyncEntity` containing the corresponding DTOs (e.g.
`orders: OrderDto[]`, `thread_messages: ThreadMessageDto[]`, etc.).

### `GET /api/v1/sync/status`

**Response:**

```typescript
{ cursor: number; serverTime: IsoDateTime }
```

---

## 19. Notes and things to double-check

- ~~`DELETE /attachments/:id` has no route-level capability guard...`~~ **Fixed in Phase 7.**
  `AttachmentService.remove` now checks `ATTACHMENT_DELETE_ANY` (globally, or per-board via
  `BOARD_ROLE_CAPABILITIES`) before letting a caller delete someone else's attachment; see §12
  above and `backend/src/services/AttachmentService.ts`'s `assertMayDeleteAny`.

- `reportQuerySchema` in `backend/src/validation/schemas.ts` does not include `status`, even
  though `ReportQuery` in `shared/src/dto/reports.ts` declares `status?: OrderStatus[]`.
  Sending `?status=...` on `/admin/reports/:kind` will be rejected with `VALIDATION_FAILED`.

- `notification.routes.ts` imports `NotificationController` from
  `../controllers/AdminController.ts` rather than from a dedicated controller file. The
  controller is correctly exported from `AdminController.ts`, so this is a code-style quirk, not
  a functional bug.

- `DELETE /thread/:messageId` requires `Capability.THREAD_READ` at the route level; actual
  deletion authority is then decided by the controller using the resolved board role and the
  `THREAD_DELETE_ANY` capability. This is intentional but subtle.

- The `X-Idempotency-Key` header is defined in `shared/src/constants/index.ts` but the backend
  REST middleware does not read it. Sync idempotency is carried by `clientOpId` instead.

- `POST /orders` and `POST /attachments/upload` cannot use URL-based capability middleware
  because the owning board is only known after parsing the body / query. Authorisation is
  performed inside `OrderService` and `AttachmentService` respectively.
