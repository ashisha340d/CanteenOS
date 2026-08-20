import {
  CleaningAssignmentStrategy,
  CleaningFrequencyKind,
  CleaningRuleScope,
  CleaningTaskPriority,
  CleaningTriggerEvent,
  CleaningVerificationMethod,
} from '@menuboard/shared';
import type { Db, PoolConnection, RowDataPacket } from '../types';
import { mutate, selectOne } from '../types';
import { newId } from '../../utils/ids';
import { logger } from '../../utils/logger';
import { toDbDateTime } from '../../utils/time';

/**
 * The one thing the Cleaning module cannot start without.
 *
 * `CLN-REPORTED` is the procedure and rule that carry work a person reported which no
 * configured rule covers. Without it, a report naming something nobody has written a rule for
 * produces nothing — and a report that produces nothing teaches everybody to stop reporting,
 * which is the only way this module actually fails.
 *
 * It is an ordinary procedure with an ordinary published version and an ordinary rule row.
 * Nothing in the engine treats it specially except `createAdhocTask`, which looks it up by
 * code. Rename it, add steps to it, change its priority — it keeps working.
 *
 * The global assignment policy is seeded for the same reason: `CleaningAssignmentService` has
 * compiled-in defaults, but a policy nobody can see or edit is a policy nobody can fix.
 *
 * Idempotent, like the rest of the seed: every insert is guarded by an existence check, so a
 * second run adds nothing and overwrites nothing an administrator has since edited.
 */

interface IdRow extends RowDataPacket {
  id: string;
}

const PROCEDURE_CODE = 'CLN-REPORTED';
const RULE_CODE = 'CLN-REPORTED';

/**
 * The steps a reported clean-up gets. Deliberately generic and few: this is the procedure for
 * work nobody wrote a procedure for, and a long checklist invented here would be a lie.
 */
const ADHOC_STEPS = [
  {
    title: 'Make the area safe',
    instruction:
      'Stop anything that would spread the problem. Put out a wet-floor sign or cordon the area if people are walking through it.',
    isMandatory: true,
    requiresPhoto: false,
  },
  {
    title: 'Remove the soil',
    instruction: 'Clear away the visible mess before applying anything.',
    isMandatory: true,
    requiresPhoto: false,
  },
  {
    title: 'Clean and sanitise',
    instruction:
      'Use the detergent and sanitiser appropriate to the surface. Respect the contact time on the label.',
    isMandatory: true,
    requiresPhoto: false,
  },
  {
    title: 'Check and photograph',
    instruction: 'Confirm the area is visually clean and dry, and take a photo of the result.',
    isMandatory: true,
    requiresPhoto: true,
  },
] as const;

async function findByCode(db: Db, table: string, code: string): Promise<string | null> {
  // Table names come only from this file's literals, never from input.
  const row = await selectOne<IdRow>(
    db,
    `SELECT id FROM ${table} WHERE code = ? AND deleted_at IS NULL LIMIT 1`,
    [code],
  );
  return row === null ? null : row.id;
}

export async function seedCleaning(
  connection: PoolConnection,
  superAdminId: string,
): Promise<void> {
  const now = toDbDateTime();

  /* ------------------------------------------------- the reported clean-up SOP */

  let procedureId = await findByCode(connection, 'cleaning_procedures', PROCEDURE_CODE);
  if (procedureId === null) {
    procedureId = newId();
    await mutate(
      connection,
      `INSERT INTO cleaning_procedures
         (id, code, name, description, status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,'ACTIVE',?,?,?)`,
      [
        procedureId,
        PROCEDURE_CODE,
        'Reported clean-up',
        'The generic clean-up carried out when somebody reports something that no cleaning rule covers.',
        superAdminId,
        now,
        now,
      ],
    );
    logger.info('Seeded cleaning procedure', { code: PROCEDURE_CODE });
  }

  // The procedure needs a *published* version, or the fallback cannot raise a task.
  const published = await selectOne<IdRow>(
    connection,
    `SELECT id FROM cleaning_procedure_versions
      WHERE procedure_id = ? AND status = 'PUBLISHED' LIMIT 1`,
    [procedureId],
  );

  if (published === null) {
    const versionId = newId();
    await mutate(
      connection,
      `INSERT INTO cleaning_procedure_versions
         (id, procedure_id, version, status, method_id, standard_id, published_at, published_by,
          change_note, ppe_required, requires_disassembly, requires_rinse, requires_final_rinse,
          requires_drying, estimated_minutes, safety_notes, created_by, created_at, updated_at)
       VALUES (?,?,1,'PUBLISHED',
               (SELECT id FROM cleaning_methods WHERE code = 'SPRAY_WIPE' AND deleted_at IS NULL LIMIT 1),
               (SELECT id FROM cleaning_standards WHERE code = 'VISUALLY_CLEAN' AND deleted_at IS NULL LIMIT 1),
               ?,?,?,?,0,1,0,1,?,?,?,?,?)`,
      [
        versionId,
        procedureId,
        now,
        superAdminId,
        'Seeded with the module.',
        'Gloves. Add an apron and eye protection if a chemical stronger than detergent is needed.',
        15,
        'Never mix chemicals. If the spill involves blood, chemicals or a broken container, tell a supervisor before touching it.',
        superAdminId,
        now,
        now,
      ],
    );

    for (const [index, step] of ADHOC_STEPS.entries()) {
      await mutate(
        connection,
        `INSERT INTO cleaning_procedure_steps
           (id, version_id, step_number, title, instruction, chemical_id, tool_id,
            duration_seconds, is_mandatory, requires_photo, created_at, updated_at)
         VALUES (?,?,?,?,?,NULL,NULL,NULL,?,?,?,?)`,
        [
          newId(),
          versionId,
          index + 1,
          step.title,
          step.instruction,
          step.isMandatory ? 1 : 0,
          step.requiresPhoto ? 1 : 0,
          now,
          now,
        ],
      );
    }

    await mutate(
      connection,
      `UPDATE cleaning_procedures SET current_version_id = ?, updated_at = ? WHERE id = ?`,
      [versionId, now, procedureId],
    );
    logger.info('Published the reported clean-up procedure', { steps: ADHOC_STEPS.length });
  }

  /* ------------------------------------------------ the reported clean-up rule */

  const existingRule = await findByCode(connection, 'cleaning_rules', RULE_CODE);
  if (existingRule === null) {
    // Scope is ASSET_TYPE_GLOBAL over the `AREA` type, which is what the rule targets when it
    // fires on its own. The fallback path names the reported asset explicitly, so a report
    // about a specific machine still lands on that machine.
    const areaTypeRow = await selectOne<IdRow>(
      connection,
      `SELECT id FROM cleanable_asset_types WHERE code = 'AREA' AND deleted_at IS NULL LIMIT 1`,
    );
    if (areaTypeRow === null) {
      logger.warn('Cleaning seed skipped the reported clean-up rule: the AREA type is missing');
      return;
    }

    const ruleId = newId();
    await mutate(
      connection,
      `INSERT INTO cleaning_rules
         (id, code, task_name, purpose, scope, cleanable_asset_id, asset_type_id, area_id,
          procedure_id, frequency_kind, interval_days, day_of_week, day_of_month, shift_id,
          due_time, due_within_minutes, responsible_role, estimated_minutes, priority,
          requires_verification, verification_method, verifier_role, standard_id, is_active,
          created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,NULL,?,NULL,?,?,NULL,NULL,NULL,NULL,NULL,?,NULL,?,?,1,?,NULL,NULL,1,?,?,?)`,
      [
        ruleId,
        RULE_CODE,
        'Reported clean-up',
        'Carries work somebody reported from the floor that no other cleaning rule covers.',
        CleaningRuleScope.ASSET_TYPE_GLOBAL,
        areaTypeRow.id,
        procedureId,
        CleaningFrequencyKind.CONDITION_BASED,
        // Due within four hours of the report: long enough to fit into a shift, short enough
        // that a spill does not sit until tomorrow.
        240,
        15,
        CleaningTaskPriority.NORMAL,
        // Verification is on: a reported clean-up is exactly the work nobody planned, so it is
        // the work most worth a second pair of eyes. Switch it off per installation from the
        // rules page if the overhead is not worth it.
        CleaningVerificationMethod.VISUAL_INSPECTION,
        superAdminId,
        now,
        now,
      ],
    );

    for (const event of [
      CleaningTriggerEvent.MANUAL_TRIGGER,
      CleaningTriggerEvent.SPILL_REPORTED,
      CleaningTriggerEvent.CONTAMINATION_REPORTED,
    ]) {
      await mutate(
        connection,
        `INSERT INTO cleaning_rule_triggers (rule_id, event_type, created_at) VALUES (?,?,?)`,
        [ruleId, event, now],
      );
    }
    logger.info('Seeded cleaning rule', { code: RULE_CODE });
  }

  /* -------------------------------------------------- global assignment policy */

  const globalPolicy = await selectOne<IdRow>(
    connection,
    `SELECT id FROM cleaning_assignment_rules WHERE area_id IS NULL LIMIT 1`,
  );
  if (globalPolicy === null) {
    await mutate(
      connection,
      `INSERT INTO cleaning_assignment_rules
         (id, area_id, strategy, require_skill_match, require_shift_match, require_area_match,
          max_open_tasks, allow_relaxed_fallback, is_active, created_by, created_at, updated_at)
       VALUES (?,NULL,?,1,1,0,10,0,1,?,?,?)`,
      [newId(), CleaningAssignmentStrategy.PRIMARY_RESPONSIBLE_FIRST, superAdminId, now, now],
    );
    logger.info('Seeded the global cleaning assignment policy');
  }
}
