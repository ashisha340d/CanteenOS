-- Admin ↔ counter messaging.
--
-- A channel per counter rather than per user: the person on the KDS changes with the shift,
-- and a message about "counter 2 is out of rice" belongs to the counter, not to whoever
-- happened to be standing at it. Both directions live in one table so history reads in one
-- ordered query.

CREATE TABLE IF NOT EXISTS `counter_messages` (
  `id` char(36) NOT NULL,
  `counter_id` char(36) NOT NULL,
  -- Who is speaking. TO_COUNTER is the office, TO_ADMIN is the counter answering back.
  `direction` enum('TO_COUNTER','TO_ADMIN') NOT NULL,
  -- TEXT carries a body; BELL is the office ringing the counter and has none. A bell is stored
  -- rather than relayed and forgotten, so a counter that was away can still see it was rung.
  `kind` enum('TEXT','BELL') NOT NULL DEFAULT 'TEXT',
  `body` varchar(2000) NOT NULL DEFAULT '',
  -- Best-effort Hindi rendering, filled in after the message is already delivered. Null means
  -- the translation has not landed (or could not) — a Hindi board falls back to `body`.
  `body_hi` varchar(2000) DEFAULT NULL,
  -- The order this message is about, when the sender tagged one. `order_number` is snapshotted
  -- so a thread still reads correctly after the order ages out of the board.
  `pos_order_id` char(36) DEFAULT NULL,
  `order_number` varchar(60) DEFAULT NULL,
  `sender_id` char(36) DEFAULT NULL,
  `sender_name` varchar(150) DEFAULT NULL,
  -- Read by the *other* side. Null while unread; drives the unread badge on both clients.
  `read_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  -- The one query this table serves: a counter's thread, newest last.
  KEY `ix_counter_messages_thread` (`counter_id`,`created_at`),
  -- Unread lookups per direction, for the badges.
  KEY `ix_counter_messages_unread` (`counter_id`,`direction`,`read_at`),
  -- "Does this order card have a message on it?" — asked per board refresh.
  KEY `ix_counter_messages_order` (`pos_order_id`),
  KEY `fk_counter_messages_sender` (`sender_id`),
  CONSTRAINT `fk_counter_messages_counter` FOREIGN KEY (`counter_id`) REFERENCES `counters` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_counter_messages_order` FOREIGN KEY (`pos_order_id`) REFERENCES `pos_orders` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_counter_messages_sender` FOREIGN KEY (`sender_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Two more uploadable buzzers, configured on Settings → Chat & Messaging: one for an arriving
-- message, one for the bell. `slot` is an enum, so the column widens before the rows can exist.
ALTER TABLE `alert_sounds`
  MODIFY COLUMN `slot` enum(
    'NORMAL','WARNING','CRITICAL',
    'KDS_NEW','KDS_ATTENTION','KDS_CRITICAL',
    'CHAT_MESSAGE','CHAT_BELL'
  ) NOT NULL;

-- Seeded empty: `AlertService.setSound` replaces the file in an existing slot and refuses a
-- slot that has no row, so the row has to exist before anyone can upload into it. NULL
-- storage_path means "nothing uploaded" — clients fall back to their built-in sound.
INSERT INTO `alert_sounds`
  (`slot`, `attachment_id`, `file_name`, `storage_path`, `updated_by`, `created_at`, `updated_at`, `revision`, `sync_seq`)
VALUES
  ('CHAT_MESSAGE', NULL, NULL, NULL, NULL, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 1, 0),
  ('CHAT_BELL', NULL, NULL, NULL, NULL, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 1, 0)
ON DUPLICATE KEY UPDATE `slot` = `slot`;
