-- MenuBoard 022 — volunteer task assignment ("My Tasks")
--
-- One row per unit of work a volunteer owns. Distinct from `orders`: an order is a
-- requirement raised on a board, a task is somebody's personal commitment to do something.
-- The two are linked, not merged — assigning an order to a volunteer creates a task that
-- points at it (`order_id`), so "what am I doing now" has one list to read while the order
-- lifecycle stays exactly as it was.
--
-- `source` records where the work came from as seen by the volunteer — the assigner's role,
-- or SELF when they created it themselves. It is stamped at creation rather than derived
-- from `assigned_by`'s current role, because a manager later becoming an admin must not
-- retroactively relabel work they handed out last month.
--
-- No `revision`/`sync_seq`: tasks are served over REST to both clients and do not take part
-- in the Android delta-sync engine (which would require a device-side schema change and a
-- change to the sync contract). Same posture as `youtube_recipe_imports` (011).

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS tasks (
  id                CHAR(36)      NOT NULL,
  title             VARCHAR(200)  NOT NULL,
  description       VARCHAR(1000) NULL,
  -- WORK is ordinary work. OFF_TIME is a volunteer marking themselves unavailable; it uses
  -- the same start/finish machinery so "who is free" is one query, not two.
  kind              ENUM('WORK','OFF_TIME') NOT NULL DEFAULT 'WORK',
  source            ENUM('SUPER_ADMIN','ADMIN','MANAGER','SELF') NOT NULL,
  status            ENUM('PENDING','IN_PROGRESS','COMPLETED','CANCELLED')
                    NOT NULL DEFAULT 'PENDING',
  priority          ENUM('NORMAL','HIGH') NOT NULL DEFAULT 'NORMAL',
  assigned_to       CHAR(36)      NOT NULL,
  -- Null only for a self-assigned task, where assignee and author are the same person.
  assigned_by       CHAR(36)      NULL,
  -- Set only for order-derived work. RESTRICT so a task can never outlive the order it
  -- describes; orders are soft-deleted anyway.
  order_id          CHAR(36)      NULL,
  board_id          CHAR(36)      NULL,
  -- Operational deadline. Populated ONLY from the linked order's required date/time — an
  -- ordinary task carries no artificial deadline and leaves this null.
  due_at            DATETIME(3)   NULL,
  -- Drives "free after 30m" on the team activity view. Null means unknown, which is
  -- reported as "working" with no estimate rather than as a guess.
  estimated_minutes SMALLINT UNSIGNED NULL,
  started_at        DATETIME(3)   NULL,
  completed_at      DATETIME(3)   NULL,
  created_at        DATETIME(3)   NOT NULL,
  updated_at        DATETIME(3)   NOT NULL,
  deleted_at        DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY ix_tasks_assignee_status (assigned_to, status, deleted_at),
  KEY ix_tasks_order (order_id),
  KEY ix_tasks_board (board_id),
  KEY ix_tasks_due (due_at),
  CONSTRAINT fk_tasks_assigned_to FOREIGN KEY (assigned_to) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_tasks_assigned_by FOREIGN KEY (assigned_by) REFERENCES users (id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_tasks_order FOREIGN KEY (order_id) REFERENCES orders (id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_tasks_board FOREIGN KEY (board_id) REFERENCES boards (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- At most one order-derived task per order per assignee, so a re-assignment back to someone
-- who already holds it cannot produce a duplicate row in their list.
ALTER TABLE tasks
  ADD UNIQUE KEY uq_tasks_order_assignee (order_id, assigned_to);

-- Orders already handed to somebody keep working: give each open assigned order the task it
-- would have got had this migration existed when it was assigned.
INSERT INTO tasks
  (id, title, description, kind, source, status, priority, assigned_to, assigned_by,
   order_id, board_id, due_at, created_at, updated_at)
SELECT
  UUID(),
  CONCAT('Food Prep for Order #', o.order_number),
  o.venue,
  'WORK',
  CASE u.role WHEN 'SUPER_ADMIN' THEN 'SUPER_ADMIN' WHEN 'ADMIN' THEN 'ADMIN' ELSE 'MANAGER' END,
  'PENDING',
  CASE WHEN o.priority IN ('HIGH','URGENT') THEN 'HIGH' ELSE 'NORMAL' END,
  o.assigned_to,
  NULL,
  o.id,
  o.board_id,
  TIMESTAMP(o.required_date, o.required_time),
  UTC_TIMESTAMP(3),
  UTC_TIMESTAMP(3)
FROM orders o
LEFT JOIN users u ON u.id = o.assigned_to
WHERE o.assigned_to IS NOT NULL
  AND o.deleted_at IS NULL
  AND o.status NOT IN ('COMPLETED','CANCELLED');

-- 010 moved the role -> capability matrix into the database, so new capabilities are seeded
-- here as well as declared in shared/src/permissions.
INSERT INTO role_capabilities (role, capability, updated_at) VALUES
  ('EMPLOYEE',    'task.read',    UTC_TIMESTAMP(3)),
  ('EMPLOYEE',    'task.self',    UTC_TIMESTAMP(3)),
  ('USER',        'task.read',    UTC_TIMESTAMP(3)),
  ('USER',        'task.self',    UTC_TIMESTAMP(3)),
  ('MANAGER',     'task.read',    UTC_TIMESTAMP(3)),
  ('MANAGER',     'task.self',    UTC_TIMESTAMP(3)),
  ('MANAGER',     'task.assign',  UTC_TIMESTAMP(3)),
  ('ADMIN',       'task.read',    UTC_TIMESTAMP(3)),
  ('ADMIN',       'task.self',    UTC_TIMESTAMP(3)),
  ('ADMIN',       'task.assign',  UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'task.read',    UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'task.self',    UTC_TIMESTAMP(3)),
  ('SUPER_ADMIN', 'task.assign',  UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE role = role;
