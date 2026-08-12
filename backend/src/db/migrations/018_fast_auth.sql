-- MenuBoard 018 — fast authentication (PIN + WebAuthn passkeys)
--
-- Adds optional, secondary fast-login credentials that can never replace the
-- primary username/password flow. These tables are intentionally separate from
-- `users` so they are never pulled to offline Android devices as part of sync.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS user_pins (
  user_id         CHAR(36)      NOT NULL,
  pin_hash        VARCHAR(255)  NOT NULL,
  failed_attempts INT UNSIGNED  NOT NULL DEFAULT 0,
  locked_until    DATETIME(3)   NULL,
  created_at      DATETIME(3)   NOT NULL,
  updated_at      DATETIME(3)   NOT NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_pins_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- One row per registered WebAuthn credential. The credential ID and public key
-- are what the server stores; biometric data never leaves the authenticator.
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id              CHAR(36)      NOT NULL,
  credential_id   VARCHAR(512)  NOT NULL,
  user_id         CHAR(36)      NOT NULL,
  public_key      LONGTEXT      NOT NULL,
  sign_counter    INT UNSIGNED  NOT NULL DEFAULT 0,
  transports      LONGTEXT      NOT NULL CHECK (JSON_VALID(transports)),
  backup_eligible TINYINT(1)    NOT NULL DEFAULT 0,
  backup_state    TINYINT(1)    NOT NULL DEFAULT 0,
  device_name     VARCHAR(150)  NULL,
  last_used_at    DATETIME(3)   NULL,
  revoked_at      DATETIME(3)   NULL,
  created_at      DATETIME(3)   NOT NULL,
  updated_at      DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_webauthn_credentials_credential_id (credential_id),
  KEY ix_webauthn_credentials_user (user_id),
  CONSTRAINT fk_webauthn_credentials_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Temporary challenges returned by registration/authentication options endpoints.
-- Consumed on verification and swept on expiry so stale challenges cannot be replayed.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id         CHAR(36)      NOT NULL,
  user_id    CHAR(36)      NOT NULL,
  type       ENUM('registration','authentication') NOT NULL,
  challenge  VARCHAR(512)  NOT NULL,
  expires_at DATETIME(3)   NOT NULL,
  created_at DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_webauthn_challenges_user (user_id, type, expires_at),
  KEY ix_webauthn_challenges_expires (expires_at),
  CONSTRAINT fk_webauthn_challenges_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
