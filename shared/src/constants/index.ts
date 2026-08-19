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

  ENTITY_CODE_MAX: 40,
  ENTITY_NAME_MAX: 150,
  ENTITY_PHONE_MAX: 30,
  ENTITY_EMAIL_MAX: 200,
  ENTITY_ADDRESS_MAX: 500,
  ENTITY_CITY_MAX: 120,
  ENTITY_DEPARTMENT_MAX: 120,
  ENTITY_DESIGNATION_MAX: 120,
  ENTITY_GSTIN_MAX: 15,
  ENTITY_PAN_MAX: 10,
  ENTITY_NOTES_MAX: 1000,

  POS_TABLE_LABEL_MAX: 60,
  POS_ORDER_NOTES_MAX: 1000,
  POS_ORDER_ITEM_NOTES_MAX: 500,
  POS_CANCEL_REASON_MAX: 300,
  POS_PAYMENT_REFERENCE_MAX: 120,
  POS_PAYMENT_NOTES_MAX: 300,
  POS_ITEMS_PER_ORDER_MAX: 200,
  POS_PAYMENTS_PER_ORDER_MAX: 10,
  /** Percentage ceiling for a line or order discount. */
  POS_DISCOUNT_PERCENT_MAX: 100,

  TASK_TITLE_MAX: 200,
  TASK_DESCRIPTION_MAX: 1000,
  /** 24 hours. A longer estimate is a shift, not a task. */
  TASK_ESTIMATE_MINUTES_MAX: 1440,

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
  PASSWORD_MIN: 6,
  PASSWORD_MAX: 128,

  EQUIPMENT_NAME_MAX: 150,
  EQUIPMENT_ASSET_ID_MAX: 40,
  EQUIPMENT_TYPE_MAX: 120,
  EQUIPMENT_BRAND_MAX: 120,
  EQUIPMENT_MODEL_MAX: 120,
  EQUIPMENT_SERIAL_MAX: 120,
  EQUIPMENT_MANUFACTURER_MAX: 150,
  EQUIPMENT_NOTES_MAX: 2000,
  EQUIPMENT_STATUS_NOTE_MAX: 500,
  EQUIPMENT_SPEC_VALUE_MAX: 120,
  /** Free-form spec keys read off a plate; a plate never has more than a handful. */
  EQUIPMENT_SPEC_KEYS_MAX: 20,
  EQUIPMENT_INVOICE_NUMBER_MAX: 80,
  EQUIPMENT_QR_CODE_MAX: 120,
  EQUIPMENT_NFC_TAG_MAX: 120,
  EQUIPMENT_TELEMETRY_DEVICE_MAX: 120,
  /** Three letters, e.g. KIT / OVN. Longer segments make an asset id unreadable. */
  ASSET_SEGMENT_MAX: 4,
  EQUIPMENT_FLOOR_NAME_MAX: 120,
  EQUIPMENT_AREA_NAME_MAX: 120,
  EQUIPMENT_LOCATION_NAME_MAX: 120,
  EQUIPMENT_ROOM_MAX: 120,
  EQUIPMENT_SECTION_MAX: 120,
  EQUIPMENT_POSITION_MAX: 120,
  EQUIPMENT_CATEGORY_NAME_MAX: 120,
  EQUIPMENT_CATEGORY_CODE_MAX: 60,
  EQUIPMENT_DOCUMENT_TITLE_MAX: 200,
  EQUIPMENT_DOCUMENTS_PER_ASSET_MAX: 60,

  SUPPLIER_NAME_MAX: 150,
  SUPPLIER_CODE_MAX: 40,
  SUPPLIER_CONTACT_NAME_MAX: 150,
  SUPPLIER_PHONE_MAX: 30,
  SUPPLIER_EMAIL_MAX: 200,
  SUPPLIER_SERVICE_CATEGORY_MAX: 150,
  SUPPLIER_SERVICE_AREA_MAX: 200,
  SUPPLIER_NOTES_MAX: 1000,

  MAINTENANCE_TITLE_MAX: 200,
  MAINTENANCE_DESCRIPTION_MAX: 2000,
  /** Copied onto every ticket a preventive schedule raises, so it is prose, not a note. */
  MAINTENANCE_INSTRUCTIONS_MAX: 2000,
  MAINTENANCE_RESOLUTION_MAX: 2000,
  MAINTENANCE_PARTS_MAX: 1000,
  MAINTENANCE_NOTE_MAX: 1000,
  MAINTENANCE_TECHNICIAN_NAME_MAX: 150,
  MAINTENANCE_ATTACHMENTS_PER_TICKET_MAX: 30,
  MAINTENANCE_TRANSCRIPT_MAX: 4000,
  /** A WhatsApp message body; the composed maintenance message is far shorter. */
  WHATSAPP_MESSAGE_MAX: 4000,
  /** Longest sensible preventive interval. Anything beyond a year is a yearly schedule. */
  MAINTENANCE_INTERVAL_DAYS_MAX: 3650,
  MAINTENANCE_REMINDER_DAYS_MAX: 90,
  MAINTENANCE_COST_MAX: 100_000_000,

  /* ------------------------------------------- cleaning & hygiene (§3e) */

  CLEANABLE_ASSET_CODE_MAX: 40,
  CLEANABLE_ASSET_NAME_MAX: 150,
  CLEANABLE_ASSET_DESCRIPTION_MAX: 1000,
  CLEANABLE_ASSET_POSITION_NOTE_MAX: 200,
  CLEANABLE_ASSET_NOTES_MAX: 2000,
  CLEANABLE_ASSET_UNAVAILABLE_REASON_MAX: 300,
  CLEANABLE_ASSET_TYPE_CODE_MAX: 60,
  CLEANABLE_ASSET_TYPE_NAME_MAX: 120,

  CLEANING_CHEMICAL_CODE_MAX: 60,
  CLEANING_CHEMICAL_NAME_MAX: 150,
  CLEANING_CHEMICAL_PURPOSE_MAX: 500,
  CLEANING_CHEMICAL_DILUTION_MAX: 60,
  CLEANING_CHEMICAL_APPLICATION_MAX: 300,
  CLEANING_CHEMICAL_STORAGE_MAX: 500,
  CLEANING_CHEMICAL_SAFETY_MAX: 2000,
  /** 100 000 ppm is 10% — past any sensible in-use cleaning dilution. */
  CLEANING_CONCENTRATION_PPM_MAX: 100_000,
  /** Four hours. A longer "contact time" is a soak schedule, not a step. */
  CLEANING_CONTACT_SECONDS_MAX: 14_400,

  CLEANING_TOOL_CODE_MAX: 60,
  CLEANING_TOOL_NAME_MAX: 150,
  CLEANING_TOOL_COLOUR_MAX: 40,
  CLEANING_TOOL_STORAGE_MAX: 200,

  CLEANING_METHOD_CODE_MAX: 60,
  CLEANING_METHOD_NAME_MAX: 120,

  CLEANING_STANDARD_CODE_MAX: 60,
  CLEANING_STANDARD_NAME_MAX: 150,
  CLEANING_STANDARD_ACCEPTANCE_MAX: 2000,
  CLEANING_STANDARD_UNIT_MAX: 40,

  CLEANING_PROCEDURE_CODE_MAX: 60,
  CLEANING_PROCEDURE_NAME_MAX: 200,
  CLEANING_PROCEDURE_DESCRIPTION_MAX: 1000,
  CLEANING_PROCEDURE_CHANGE_NOTE_MAX: 1000,
  CLEANING_PROCEDURE_PPE_MAX: 500,
  CLEANING_PROCEDURE_SAFETY_MAX: 2000,
  CLEANING_STEP_TITLE_MAX: 200,
  CLEANING_STEP_INSTRUCTION_MAX: 2000,
  /** A procedure needing more than this is two procedures. */
  CLEANING_STEPS_PER_VERSION_MAX: 60,

  CLEANING_RULE_CODE_MAX: 60,
  CLEANING_RULE_TASK_NAME_MAX: 200,
  CLEANING_RULE_PURPOSE_MAX: 1000,
  /** Same ceiling as a maintenance interval, for the same reason. */
  CLEANING_INTERVAL_DAYS_MAX: 3650,
  /** A week. Past that a rule wants a due time, not a window. */
  CLEANING_DUE_WITHIN_MINUTES_MAX: 10_080,
  /** A full shift. Anything longer is a project. */
  CLEANING_ESTIMATED_MINUTES_MAX: 480,

  CLEANING_TASK_COMPLETION_NOTE_MAX: 2000,
  CLEANING_TASK_CANCEL_REASON_MAX: 500,
  CLEANING_STEP_SKIP_REASON_MAX: 500,
  CLEANING_STEP_NOTE_MAX: 1000,
  CLEANING_EVIDENCE_CAPTION_MAX: 300,
  CLEANING_EVIDENCE_PER_TASK_MAX: 30,

  CLEANING_VERIFICATION_NOTE_MAX: 2000,
  CLEANING_VERIFICATION_FAILURE_REASON_MAX: 1000,
  CLEANING_VERIFICATION_LABEL_MAX: 200,
  CLEANING_VERIFICATION_RESULTS_MAX: 60,

  CLEANING_CORRECTIVE_FAILURE_SUMMARY_MAX: 1000,
  CLEANING_CORRECTIVE_ACTION_TEXT_MAX: 2000,
  CLEANING_CORRECTIVE_CLOSURE_NOTE_MAX: 2000,

  CLEANING_EVENT_NOTE_MAX: 1000,
  CLEANING_EVENT_DEDUPE_KEY_MAX: 190,
  /** How many events one ingest call may carry. */
  CLEANING_EVENT_BATCH_MAX: 50,

  SKILL_CODE_MAX: 60,
  SKILL_NAME_MAX: 120,
  SKILL_DESCRIPTION_MAX: 1000,
  SKILL_NOTE_MAX: 500,
  SHIFT_CODE_MAX: 40,
  SHIFT_NAME_MAX: 120,
  /** Beyond this many open cleaning tasks the assignment engine skips a candidate. */
  CLEANING_MAX_OPEN_TASKS_CEILING: 200,

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
  /**
   * Accepted only by the Equipment module's own upload endpoint: a fault is often something you
   * can only *show* — a noise, a leak, a flame that will not hold. `attachments` (001) and the
   * Menu Master media library take no video, and neither of their endpoints accepts these.
   */
  VIDEO_MIME_TYPES: ['video/mp4', 'video/quicktime', 'video/webm'] as const,

  IMAGE_MAX_BYTES: 8 * 1024 * 1024,
  AUDIO_MAX_BYTES: 16 * 1024 * 1024,
  DOCUMENT_MAX_BYTES: 20 * 1024 * 1024,
  /** A phone shooting 1080p fills this in roughly half a minute, which is the point. */
  VIDEO_MAX_BYTES: 64 * 1024 * 1024,

  /** Client-side compression target before upload. */
  IMAGE_COMPRESS_MAX_DIMENSION: 1600,
  IMAGE_COMPRESS_QUALITY: 0.7,

  VOICE_NOTE_MAX_DURATION_MS: 5 * 60 * 1000,
  /**
   * Recording ceiling for a fault clip. Long enough to show a cycle failing, short enough that
   * it uploads over a kitchen's Wi-Fi before the reporter gives up.
   */
  VIDEO_MAX_DURATION_SECONDS: 45,
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
 * POS bill numbers, unlike operational order numbers, *are* server-sequential.
 *
 * The offline-creation constraint that forced `ORD-YYYYMMDD-XXXXXX` to be device-generated
 * (docs/MENUBOARD_SPEC.md decision 1) does not apply here: a till is online by definition,
 * and a counter has to hand the customer a bill number that reads as a countable sequence.
 * The daily counter resets each business date, so `POS-20260811-0001` is the first sale of
 * the day at every station.
 */
export const POS_ORDER_NUMBER = {
  PREFIX: 'POS',
  PATTERN: /^POS-\d{8}-\d{4,6}$/,
  SEQUENCE_PAD: 4,
} as const;

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
  /**
   * The customer-facing self-service kiosk (`CustomerKiosk/`). Unattended and physically
   * public, so its session is default-deny: see `KIOSK_ALLOWED_CAPABILITIES`.
   */
  KIOSK: 'KIOSK',
  /**
   * The wall-mounted kitchen/counter display (`kds/`). A signed-in staff member behind an
   * MPIN — not a public device, so it keeps normal capability checks rather than the kiosk's
   * default-deny list.
   */
  KDS: 'KDS',
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
