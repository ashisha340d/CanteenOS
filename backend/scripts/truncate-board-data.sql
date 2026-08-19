-- ---------------------------------------------------------------------------------------
-- Wipe the board module's TRANSACTIONAL data, keeping every master/config row.
--
-- What goes:   orders, their lines, the board conversation, acknowledgements, attachments,
--              shopping lists, billing exports, order notifications, order-linked tasks.
-- What stays:  boards, board_members, stations, activity types, menus, menu items, recipes,
--              ingredients, users, permissions, alert settings, settings, tax profiles —
--              everything an admin configured.
--
-- Usage:
--   mysql -u <user> -p <database> < backend/scripts/truncate-board-data.sql
--
-- TAKE A BACKUP FIRST. This is not reversible:
--   mysqldump -u <user> -p <database> > backup-before-truncate.sql
-- ---------------------------------------------------------------------------------------

SET @OLD_FK := @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

START TRANSACTION;

-- Child rows first. Order is not strictly required with FK checks off, but keeping it
-- dependency-correct means this same list also works if you swap TRUNCATE for DELETE.

-- Order contents and everything hanging off an order -------------------------------------
TRUNCATE TABLE order_items;
TRUNCATE TABLE acknowledgements;

-- The board conversation. thread_messages self-references via parent_message_id, which is
-- why FK checks are off rather than deleting in two passes.
TRUNCATE TABLE thread_messages;

-- Media attached to an order or a message. Rows only — the files on disk are not touched;
-- see the note at the bottom.
TRUNCATE TABLE attachments;

-- Shopping lists are generated from orders, so they are meaningless once the orders go.
TRUNCATE TABLE shopping_list_items;
TRUNCATE TABLE shopping_lists;

-- Billing exports reference orders; orders.billing_export_id is ON DELETE SET NULL, but the
-- exports themselves describe orders that will no longer exist.
TRUNCATE TABLE billing_exports;

-- Orders themselves ----------------------------------------------------------------------
TRUNCATE TABLE orders;

-- Notifications and tasks are mixed tables: only the order-linked rows are board data, so
-- these are DELETEs, not TRUNCATEs. Equipment and maintenance rows survive.
DELETE FROM notifications
 WHERE order_id IS NOT NULL
    OR type IN ('NEW_ORDER', 'MENTION', 'THREAD_REPLY', 'ACKNOWLEDGEMENT', 'STATUS_CHANGED');

DELETE FROM tasks WHERE order_id IS NOT NULL;

-- Sync bookkeeping -----------------------------------------------------------------------
-- sync_logs is an audit of past pushes/pulls against rows that no longer exist.
TRUNCATE TABLE sync_logs;

-- NOTE: sync_counter is deliberately NOT reset.
--
-- Every device stores the cursor it last pulled to. Resetting the counter to 0 would make
-- every already-synced device believe it is ahead of the server, and it would never pull
-- again until its local database was cleared. Leaving the counter to keep climbing costs
-- nothing and keeps existing installs working.

COMMIT;

SET FOREIGN_KEY_CHECKS = @OLD_FK;

-- ---------------------------------------------------------------------------------------
-- Row counts after the wipe — every line should read 0.
-- ---------------------------------------------------------------------------------------
SELECT 'orders'             AS table_name, COUNT(*) AS remaining FROM orders
UNION ALL SELECT 'order_items',            COUNT(*) FROM order_items
UNION ALL SELECT 'thread_messages',        COUNT(*) FROM thread_messages
UNION ALL SELECT 'acknowledgements',       COUNT(*) FROM acknowledgements
UNION ALL SELECT 'attachments',            COUNT(*) FROM attachments
UNION ALL SELECT 'shopping_lists',         COUNT(*) FROM shopping_lists
UNION ALL SELECT 'shopping_list_items',    COUNT(*) FROM shopping_list_items
UNION ALL SELECT 'billing_exports',        COUNT(*) FROM billing_exports
UNION ALL SELECT 'order-linked tasks',     COUNT(*) FROM tasks WHERE order_id IS NOT NULL
UNION ALL SELECT 'order notifications',    COUNT(*) FROM notifications WHERE order_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------
-- Masters that must be UNTOUCHED — these should all still show their configured counts.
-- ---------------------------------------------------------------------------------------
SELECT 'boards'          AS table_name, COUNT(*) AS kept FROM boards
UNION ALL SELECT 'board_members',       COUNT(*) FROM board_members
UNION ALL SELECT 'stations',            COUNT(*) FROM stations
UNION ALL SELECT 'activity_types',      COUNT(*) FROM activity_types
UNION ALL SELECT 'menu_items',          COUNT(*) FROM menu_items
UNION ALL SELECT 'menu_categories',     COUNT(*) FROM menu_categories
UNION ALL SELECT 'recipes',             COUNT(*) FROM recipes
UNION ALL SELECT 'ingredients',         COUNT(*) FROM ingredients
UNION ALL SELECT 'users',               COUNT(*) FROM users
UNION ALL SELECT 'alert_settings',      COUNT(*) FROM alert_settings
UNION ALL SELECT 'settings',            COUNT(*) FROM settings;

-- ---------------------------------------------------------------------------------------
-- AFTERWARDS
--
-- 1. Every signed-in device still holds the deleted rows in its local SQLite copy. A delta
--    pull will not remove them: sync carries tombstones, and TRUNCATE writes none. Clear
--    app storage on each device (or sign out and back in) so it re-bootstraps from cursor 0.
--
-- 2. Uploaded files under the media storage root are left in place. Delete them separately
--    if you want the disk back — nothing in the database references them any more.
-- ---------------------------------------------------------------------------------------
