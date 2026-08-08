-- MenuBoard 007 — stations
--
-- Introduces `Station` as the real-world top of the hierarchy: Station -> Board.
-- A station is a physical site (Barsana, Mangarh, ...); a board (Canteen, Dining Hall,
-- Prasad Ghar, ...) belongs to exactly one station. Activity types stay independent and
-- global, unrelated to this hierarchy.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS stations (
  id           CHAR(36)      NOT NULL,
  name         VARCHAR(120)  NOT NULL,
  code         VARCHAR(60)   NULL,
  description  VARCHAR(1000) NULL,
  status       ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by   CHAR(36)      NULL,
  created_at   DATETIME(3)   NOT NULL,
  updated_at   DATETIME(3)   NOT NULL,
  deleted_at   DATETIME(3)   NULL,
  revision     INT UNSIGNED  NOT NULL DEFAULT 1,
  sync_seq     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_stations_name (name),
  UNIQUE KEY uq_stations_code (code),
  KEY ix_stations_sync_seq (sync_seq),
  KEY ix_stations_status (status, deleted_at),
  CONSTRAINT fk_stations_created_by FOREIGN KEY (created_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE boards
  ADD COLUMN station_id CHAR(36) NOT NULL AFTER id,
  ADD KEY ix_boards_station (station_id, status),
  ADD CONSTRAINT fk_boards_station FOREIGN KEY (station_id) REFERENCES stations (id)
    ON DELETE RESTRICT ON UPDATE CASCADE;
