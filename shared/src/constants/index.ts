/** Limits, formats and wire constants shared by every client. */

export const LIMITS = {
  STATION_NAME_MAX: 120,
  STATION_CODE_MAX: 60,
  STATION_DESCRIPTION_MAX: 1000,
  BOARD_NAME_MAX: 120,
  BOARD_DESCRIPTION_MAX: 1000,
  BOARD_PHOTO_PATH_MAX: 500,
  ACTIVITY_NAME_MAX: 120,
  CUSTOM_ACTIVITY_MAX: 150,
  MENU_CATEGORY_NAME_MAX: 120,
  MENU_ITEM_NAME_MAX: 150,
  /** Ad-hoc order line typed on the spot. Same ceiling as a catalogued dish name. */
  CUSTOM_ITEM_NAME_MAX: 150,
  UNIT_MAX: 30,
  INGREDIENT_NAME_MAX: 150,
  INGREDIENT_CATEGORY_NAME_MAX: 120,
  RECIPE_DESCRIPTION_MAX: 200,
  RECIPE_YIELD_NOTE_MAX: 200,
  RECIPE_CHEF_NOTES_MAX: 1000,
  RECIPE_STEP_TEXT_MAX: 2000,
  RECIPE_STEPS_PER_RECIPE_MAX: 100,
  RECIPE_INGREDIENTS_PER_RECIPE_MAX: 200,
  VENUE_MAX: 200,
  ORDER_ITEM_NOTES_MAX: 1000,
  THREAD_BODY_MAX: 4000,
  USER_NAME_MAX: 150,
  USERNAME_MAX: 100,
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 128,

  PAX_MIN: 0,
  PAX_MAX: 1_000_000,
  QUANTITY_MIN: 0,
  QUANTITY_MAX: 1_000_000,

  ORDER_ITEMS_PER_ORDER_MAX: 200,
  ATTACHMENTS_PER_OWNER_MAX: 30,
  MENTIONS_MAX: 50,

  PAGE_SIZE_DEFAULT: 25,
  PAGE_SIZE_MAX: 100,

  SYNC_PULL_LIMIT_DEFAULT: 500,
  SYNC_PULL_LIMIT_MAX: 2000,
  SYNC_PUSH_BATCH_MAX: 200,
} as const;

export const MEDIA = {
  IMAGE_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp'] as const,
  AUDIO_MIME_TYPES: ['audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/webm'] as const,
  DOCUMENT_MIME_TYPES: ['application/pdf'] as const,

  IMAGE_MAX_BYTES: 8 * 1024 * 1024,
  AUDIO_MAX_BYTES: 16 * 1024 * 1024,
  DOCUMENT_MAX_BYTES: 20 * 1024 * 1024,

  /** Client-side compression target before upload. */
  IMAGE_COMPRESS_MAX_DIMENSION: 1600,
  IMAGE_COMPRESS_QUALITY: 0.7,

  VOICE_NOTE_MAX_DURATION_MS: 5 * 60 * 1000,
} as const;

export const ORDER_NUMBER = {
  PREFIX: 'ORD',
  /** ORD-YYYYMMDD-XXXXXX — see docs/SCOPE.md decision 1. */
  PATTERN: /^ORD-\d{8}-[0-9A-HJKMNP-TV-Z]{6}$/,
  SUFFIX_LENGTH: 6,
} as const;

/** Crockford base32 — excludes I, L, O and U to avoid transcription errors. */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const SOCKET_EVENTS = {
  // Server → client
  ENTITY_CHANGED: 'entity:changed',
  ORDER_CHANGED: 'order:changed',
  THREAD_MESSAGE_CREATED: 'thread:message:created',
  ACKNOWLEDGEMENT_CREATED: 'acknowledgement:created',
  NOTIFICATION_CREATED: 'notification:created',
  BOARD_MEMBERSHIP_CHANGED: 'board:membership:changed',
  MASTER_CHANGED: 'master:changed',
  SYNC_HINT: 'sync:hint',
  // Client → server
  JOIN_BOARD: 'board:join',
  LEAVE_BOARD: 'board:leave',
} as const;

export const SOCKET_ROOMS = {
  user: (userId: string): string => `user:${userId}`,
  board: (boardId: string): string => `board:${boardId}`,
  masters: (): string => 'masters',
} as const;

/**
 * Identifies the calling application. Sent as the `X-Client-Type` header and embedded in
 * the access token so the backend can enforce the Android capability prohibitions.
 */
export const ClientType = {
  ANDROID: 'ANDROID',
  ADMIN: 'ADMIN',
} as const;
export type ClientType = (typeof ClientType)[keyof typeof ClientType];

export const HEADERS = {
  CLIENT_TYPE: 'x-client-type',
  DEVICE_ID: 'x-device-id',
  REQUEST_ID: 'x-request-id',
  IDEMPOTENCY_KEY: 'x-idempotency-key',
} as const;

export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  REFRESH_REUSED: 'REFRESH_REUSED',
  FORBIDDEN: 'FORBIDDEN',
  CLIENT_NOT_PERMITTED: 'CLIENT_NOT_PERMITTED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  STALE_WRITE: 'STALE_WRITE',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ADMIN_ROLE_REQUIRED: 'ADMIN_ROLE_REQUIRED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
