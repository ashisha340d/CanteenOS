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

  MENU_CODE_MAX: 60,
  MENU_NAME_MAX: 150,
  MENU_DESCRIPTION_MAX: 1000,
  MENU_DISPLAY_NAME_MAX: 150,
  MENU_DESCRIPTION_OVERRIDE_MAX: 1000,
  PREPARATION_METHOD_MAX: 2000,
  VARIANT_NAME_MAX: 120,
  VARIANT_CODE_MAX: 60,
  PORTION_NAME_MAX: 80,
  COUNTER_NAME_MAX: 120,
  PRINTING_GROUP_NAME_MAX: 120,
  MODIFIER_GROUP_NAME_MAX: 120,
  MODIFIER_NAME_MAX: 120,
  MEDIA_TITLE_MAX: 200,
  MEDIA_ALT_TEXT_MAX: 300,
  PRICE_MIN: 0,
  PRICE_MAX: 10_000_000,
  /** Ad-hoc order line typed on the spot. Same ceiling as a catalogued dish name. */
  CUSTOM_ITEM_NAME_MAX: 150,
  UNIT_MAX: 30,
  INGREDIENT_NAME_MAX: 150,
  INGREDIENT_CATEGORY_NAME_MAX: 120,

  TAX_PROFILE_CODE_MAX: 40,
  TAX_PROFILE_NAME_MAX: 120,
  TAX_PROFILE_DESCRIPTION_MAX: 500,
  TAX_EXEMPTION_REASON_MAX: 300,
  TAX_REGULATORY_NOTES_MAX: 200,
  /** GST rates are percentages; nothing lawful approaches this, but it bounds the input. */
  TAX_RATE_MAX: 100,
  HSN_SAC_CODE_MAX: 20,
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

/**
 * The authoritative HSN/SAC classification dataset.
 *
 * GSTN publishes no API for this. The workbook below is the file the GST Portal itself serves
 * behind Services > User Services > Search HSN Code > "Download HSN Directory in Excel
 * Format", so it is the official source rather than a third-party mirror. It contains two
 * sheets, HSN_MSTR and SAC_MSTR, each with exactly two columns: code and description. There
 * are no rates in it — that is why rates live on the Tax Profile master instead.
 */
export const GST_MASTER_SOURCE = {
  NAME: 'GST/GSTN',
  URL: 'https://tutorial.gst.gov.in/downloads/HSN_SAC.xlsx',
  HSN_SHEET: 'HSN_MSTR',
  SAC_SHEET: 'SAC_MSTR',
  /** The server rejects HEAD; the download must be a GET. */
  DOWNLOAD_TIMEOUT_MS: 120_000,
  MAX_BYTES: 32 * 1024 * 1024,
  /** A dataset smaller than this is treated as corrupt rather than as mass deactivation. */
  MIN_EXPECTED_RECORDS: 5_000,
} as const;

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
  /**
   * Presence, not data: relayed straight to the board room and never persisted. A missed
   * frame simply means a typing bubble is a beat late, which is why it sits outside the
   * cursor-based sync path entirely.
   */
  TYPING: 'board:typing',
  // Client → server
  JOIN_BOARD: 'board:join',
  LEAVE_BOARD: 'board:leave',
  TYPING_SET: 'board:typing:set',
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
  /** The official GST dataset could not be fetched or was not a valid HSN/SAC workbook. */
  GST_SOURCE_UNAVAILABLE: 'GST_SOURCE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
