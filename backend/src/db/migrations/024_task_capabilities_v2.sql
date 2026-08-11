-- MenuBoard 024 — split task.self into authoring vs. working, and fix who holds what
--
-- 023 granted 'task.self' to every role (create your own task, and start/stop/finish it) and
-- 'task.assign' to Manager and above. The product rule turned out to be narrower than that:
--   - Employee never authors a task, but must still be able to start/stop/finish one handed
--     to them — that half of the old task.self is now its own capability, task.work.
--   - Super Admin oversees the roster and must not appear on it: task.self and task.assign
--     are withdrawn.
--   - A plain User may now author their own tasks and hand work to an Employee, same as a
--     Manager — task.assign moves down to User.
--
-- shared/src/permissions mirrors this exactly; this migration brings already-deployed
-- databases (whose role_capabilities/board_role_capabilities are the live, authoritative
-- source per PermissionsCacheService) in line with it.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Employee: loses the ability to author a task, gains the ability to work one.
DELETE FROM role_capabilities WHERE role = 'EMPLOYEE' AND capability = 'task.self';
INSERT INTO role_capabilities (role, capability, updated_at) VALUES
  ('EMPLOYEE', 'task.work', UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE role = role;

-- User: gains the ability to assign work to an Employee, in addition to authoring their own.
INSERT INTO role_capabilities (role, capability, updated_at) VALUES
  ('USER', 'task.assign', UTC_TIMESTAMP(3)),
  ('USER', 'task.work', UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE role = role;

-- Manager and Admin keep authoring and assigning; both additionally gain task.work so they
-- can start/stop/finish work assigned to them, same as everyone else.
INSERT INTO role_capabilities (role, capability, updated_at) VALUES
  ('MANAGER', 'task.work', UTC_TIMESTAMP(3)),
  ('ADMIN',   'task.work', UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE role = role;

-- Super Admin: oversees the roster rather than carrying personal work on it. Loses the
-- ability to author or assign a task; keeps task.read and gains task.work for symmetry with
-- every other tier (harmless — nothing assigns work to a Super Admin in practice).
DELETE FROM role_capabilities WHERE role = 'SUPER_ADMIN' AND capability IN ('task.self', 'task.assign');
INSERT INTO role_capabilities (role, capability, updated_at) VALUES
  ('SUPER_ADMIN', 'task.work', UTC_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE role = role;
