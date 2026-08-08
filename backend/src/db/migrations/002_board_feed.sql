-- MenuBoard 002 — board feed
--
-- Widens thread_messages from "one thread per order" into the board feed: the single,
-- unified message timeline that is the app's primary screen.
--
--   * board_id is now required — every message lives on a board.
--   * order_id is now nullable — NULL means a general board post (text, voice note,
--     attachment); when set, the message is *about* that order and renders nested under the
--     order's card in the same feed rather than in a separate screen.
--
-- SYSTEM rows keep their existing meaning (ORDER_CREATED etc. materialise order history,
-- docs/SCOPE.md decision 2); ORDER_CREATED is what the app renders as the structured order
-- card in the feed.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

ALTER TABLE thread_messages
  ADD COLUMN board_id CHAR(36) NULL AFTER id;

-- Every existing message belongs to exactly one order, so its board is unambiguous.
UPDATE thread_messages tm
  JOIN orders o ON o.id = tm.order_id
  SET tm.board_id = o.board_id
  WHERE tm.board_id IS NULL;

ALTER TABLE thread_messages
  MODIFY board_id CHAR(36) NOT NULL,
  MODIFY order_id CHAR(36) NULL,
  ADD KEY ix_thread_messages_board (board_id, created_at),
  ADD CONSTRAINT fk_thread_messages_board FOREIGN KEY (board_id) REFERENCES boards (id)
    ON DELETE CASCADE ON UPDATE CASCADE;
