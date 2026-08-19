import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Typed configuration. Parsed once at boot and validated eagerly so a misconfigured
 * deployment fails immediately rather than on the first request that needs the value.
 */

type NodeEnv = 'development' | 'test' | 'production';
type LogLevel = 'error' | 'warn' | 'info' | 'debug';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, received "${raw}"`);
  }
  return parsed;
}

function boolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const nodeEnv = optional('NODE_ENV', 'development') as NodeEnv;
const isProduction = nodeEnv === 'production';
const packageRoot = path.resolve(__dirname, '../..');

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters');
}
if (isProduction && jwtSecret.includes('change-me')) {
  throw new Error('JWT_SECRET still holds its placeholder value; refusing to start in production');
}

export const config = {
  env: nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  port: integer('PORT', 4000),
  publicUrl: optional('PUBLIC_URL', `http://localhost:${integer('PORT', 4000)}`).replace(/\/+$/, ''),
  corsOrigins: list('CORS_ORIGINS', ['http://localhost:5173']),
  packageRoot,

  db: {
    host: optional('DB_HOST', 'localhost'),
    port: integer('DB_PORT', 3306),
    user: optional('DB_USER', 'root'),
    password: optional('DB_PASSWORD', ''),
    database: optional('DB_NAME', 'menuboard'),
    connectionLimit: integer('DB_CONNECTION_LIMIT', 15),
  },

  auth: {
    jwtSecret,
    issuer: optional('JWT_ISSUER', 'menuboard'),
    audience: optional('JWT_AUDIENCE', 'menuboard-clients'),
    accessTokenTtlMinutes: integer('ACCESS_TOKEN_TTL_MINUTES', 15),
    refreshTokenTtlDays: integer('REFRESH_TOKEN_TTL_DAYS', 30),
    bcryptRounds: integer('BCRYPT_ROUNDS', 12),
  },

  media: {
    root: path.resolve(packageRoot, optional('MEDIA_ROOT', 'storage/media')),
    tmp: path.resolve(packageRoot, optional('MEDIA_TMP', 'storage/tmp')),
    urlTtlMinutes: integer('MEDIA_URL_TTL_MINUTES', 120),
  },

  /**
   * The Digital Menu Board page, served at `/menu-board` so a wall screen needs a URL and
   * nothing else.
   *
   * It is a single hand-written HTML file with no build step, which is why this points at a
   * source path rather than at a `dist/` — there is nothing to compile. The default reaches out
   * of the backend package to its sibling in the workspace; `MENU_BOARD_PAGE` overrides it for
   * a deployment that lays the two out differently.
   */
  menuBoard: {
    pagePath: path.resolve(
      packageRoot,
      optional('MENU_BOARD_PAGE', '../digitalmenu/index.html'),
    ),
  },

  /**
   * The offline speech model served to devices after login. Not bundled in the APK — the
   * multilingual Whisper Base weights are ~148 MB.
   *
   * `VOICE_MODEL_VERSION` is the operator's declaration of which weights these are. Bump it
   * whenever the file is replaced: it is how an already-installed device learns an update
   * exists without downloading the file to compare checksums.
   */
  voiceModel: {
    directory: path.resolve(packageRoot, optional('VOICE_MODEL_DIR', 'storage/voice-model')),
    fileName: optional('VOICE_MODEL_FILE', 'ggml-base.bin'),
    modelName: optional('VOICE_MODEL_NAME', 'whisper-base-multilingual'),
    version: optional('VOICE_MODEL_VERSION', '1.0.0'),
    // Longer than the media TTL: a 148 MB download on a weak connection can outlive a
    // two-hour window, and a mid-download expiry would strand the resume.
    urlTtlMinutes: integer('VOICE_MODEL_URL_TTL_MINUTES', 720),
  },

  security: {
    trustProxy: boolean('TRUST_PROXY', false),
    forceHttps: boolean('FORCE_HTTPS', false),
    rateLimitWindowMs: integer('RATE_LIMIT_WINDOW_MINUTES', 1) * 60_000,
    rateLimitMax: integer('RATE_LIMIT_MAX', 300),
    authRateLimitMax: integer('AUTH_RATE_LIMIT_MAX', 10),
  },

  logLevel: optional('LOG_LEVEL', 'info') as LogLevel,

  /**
   * The zone dates are rendered in for humans — on a printed bill, in a WhatsApp message.
   * Storage stays UTC; this is presentation only, and a canteen's receipt must read in the
   * time the hall keeps rather than the time its server happens to be booted in.
   */
  displayTimeZone: optional('DISPLAY_TIME_ZONE', 'Asia/Kolkata'),

  /**
   * AI-assisted recipe authoring (free-text/photo/voice -> structured recipe draft) and the
   * ingredient/menu-item "Auto Translate" buttons. Both degrade gracefully when unset: the
   * regex-based `recipe-parser.service` import still works without a key, only the
   * AI-resolution and audio-transcription steps need one. Ported from the sibling
   * "ashram_kitchen" system — see E:\VSKorder\HANDOVER_INGREDIENT_RECIPE.md.
   */
  gemini: {
    apiKey: optional('GEMINI_API_KEY', ''),
    apiUrl: optional('GEMINI_API_URL', 'https://generativelanguage.googleapis.com/v1beta'),
    model: optional('GEMINI_MODEL', 'gemini-1.5-flash'),
  },

  /**
   * YouTube Recipe Downloader. yt-dlp does the metadata/caption/audio fetching; the analysis
   * itself uses the Gemini config above. `YTDLP_PATH` may point at a binary or be a
   * `python -m yt_dlp` style prefix — anything the shell can execute.
   */
  youtube: {
    ytdlpPath: optional('YTDLP_PATH', 'yt-dlp'),
    /** Refuse to process videos longer than this — a feature film is not a recipe. */
    maxDurationMinutes: integer('YOUTUBE_MAX_DURATION_MINUTES', 45),
    /** Audio larger than this is skipped (Gemini inline uploads cap out around 20 MB). */
    maxAudioBytes: integer('YOUTUBE_MAX_AUDIO_MB', 18) * 1024 * 1024,
    /** Hard ceiling for one import job before it is failed as timed out. */
    jobTimeoutMinutes: integer('YOUTUBE_JOB_TIMEOUT_MINUTES', 20),
  },

  /**
   * Sending a settled GST bill to the guest's own WhatsApp, over Meta's WhatsApp Cloud API.
   *
   * Credentials live here rather than in the settings table because they are secrets, and the
   * settings table is rendered field-by-field in the Admin Portal. Leaving them unset is a
   * supported state, not a broken one: `WhatsAppService` reports itself unconfigured, the
   * kiosk profile says so, and the kiosk simply never offers the guest a bill by phone.
   *
   * `templateName` is an approved message template in the same WhatsApp Business account.
   * Meta refuses free-form text for a business-initiated conversation, so a bill cannot be
   * sent as a plain message however convenient that would be.
   */
  whatsapp: {
    apiVersion: optional('WHATSAPP_API_VERSION', 'v21.0'),
    phoneNumberId: optional('WHATSAPP_PHONE_NUMBER_ID', ''),
    accessToken: optional('WHATSAPP_ACCESS_TOKEN', ''),
    templateName: optional('WHATSAPP_TEMPLATE_NAME', 'gst_bill'),
    templateLanguage: optional('WHATSAPP_TEMPLATE_LANGUAGE', 'en'),
    /** Prefixed to a number the guest typed without one. India unless told otherwise. */
    defaultCountryCode: optional('WHATSAPP_DEFAULT_COUNTRY_CODE', '91'),
    requestTimeoutMs: integer('WHATSAPP_TIMEOUT_MS', 10_000),
  },
} as const;

export type Config = typeof config;
