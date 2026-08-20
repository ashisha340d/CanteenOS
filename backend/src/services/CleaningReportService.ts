import {
  CLEANING_REPORTABLE_EVENTS,
  CleaningEventSource,
  CleaningTaskPriority,
  CleaningTriggerEvent,
  LIMITS,
  PUBLISHABLE_TRIGGER_EVENTS,
  type CleaningEventDto,
  type CleaningEventListQuery,
  type CleaningEventPublishRequest,
  type CleaningReportRequest,
  type CleaningReportResultDto,
  type CleaningTaskDto,
  type NotificationDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { PoolConnection } from '../db/types';
import { mapCleaningEvent, mapCleaningTask } from '../models/mappers';
import type { CleaningEventRow } from '../models/rows';
import { CleanableAssetRepository } from '../repositories/CleanableAssetRepository';
import { CleaningEventRepository, type EventFilter } from '../repositories/CleaningEventRepository';
import { CleaningMasterRepository } from '../repositories/CleaningMasterRepository';
import { CleaningTaskRepository } from '../repositories/CleaningTaskRepository';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { toJsonColumn } from '../utils/json';
import { logger } from '../utils/logger';
import { toDbDateTime } from '../utils/time';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { cleaningAssetService } from './CleaningAssetService';
import { cleaningEngineService } from './CleaningEngineService';
import { cleaningTaskService } from './CleaningTaskService';
import { notificationService } from './NotificationService';

/**
 * "This needs cleaning."
 *
 * The single most important surface in the module, because it is the one every user touches.
 * Three things make it work rather than merely exist:
 *
 *  1. **One of an asset or an area is all that is required.** A person who has never seen the
 *     asset register can still raise real, assignable work: naming an area resolves to that
 *     area's general cleanable asset, created on first use.
 *  2. **A report always produces something.** If no rule matched, the seeded "reported clean-up"
 *     rule carries the report instead. A report that quietly produced nothing would teach
 *     everybody to stop reporting, which is the only way this module actually fails.
 *  3. **The reporter is told what happened.** The response carries the tasks that were raised
 *     and a sentence saying so, rather than a bare 201.
 */

export interface PublishOptions {
  /** Off for machine ingest and manual rule runs: those must not invent ad-hoc work. */
  allowFallback?: boolean;
}

export class CleaningReportService {
  /* -------------------------------------------------------------------- reading */

  async listEvents(query: CleaningEventListQuery, userId: string) {
    const pool = getPool();
    const { page, pageSize, offset } = resolvePaging(query);
    const filter: EventFilter = {
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.eventType !== undefined ? { eventType: query.eventType } : {}),
      ...(query.source !== undefined ? { source: query.source } : {}),
      ...(query.areaId !== undefined ? { areaId: query.areaId } : {}),
      ...(query.cleanableAssetId !== undefined
        ? { cleanableAssetId: query.cleanableAssetId }
        : {}),
      // `mine` is resolved here, so a client cannot ask for somebody else's reports.
      ...(query.mine === true
        ? { reportedBy: userId }
        : query.reportedBy !== undefined
          ? { reportedBy: query.reportedBy }
          : {}),
      ...(query.unprocessedOnly !== undefined ? { unprocessedOnly: query.unprocessedOnly } : {}),
      ...(query.from !== undefined ? { from: query.from } : {}),
      ...(query.to !== undefined ? { to: query.to } : {}),
      limit: pageSize,
      offset,
    };
    const [rows, total] = await Promise.all([
      CleaningEventRepository.list(pool, filter),
      CleaningEventRepository.count(pool, filter),
    ]);
    return buildPage(rows.map(mapCleaningEvent), total, page, pageSize);
  }

  async getEvent(id: string): Promise<CleaningEventDto> {
    const row = await CleaningEventRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('Cleaning event', id);
    return mapCleaningEvent(row);
  }

  /* ------------------------------------------------------------------ reporting */

  /**
   * The report a person on the floor files. Reaches every signed-in user through
   * `cleaning.report_incident`.
   */
  async report(
    input: CleaningReportRequest,
    actor: AuditActor,
    userId: string,
  ): Promise<CleaningReportResultDto> {
    const eventType = input.eventType ?? CleaningTriggerEvent.MANUAL_TRIGGER;
    if (!CLEANING_REPORTABLE_EVENTS.includes(eventType)) {
      throw new ValidationError('That is not something a person reports from the floor');
    }
    if (
      (input.cleanableAssetId === undefined || input.cleanableAssetId === null) &&
      (input.areaId === undefined || input.areaId === null) &&
      (input.equipmentId === undefined || input.equipmentId === null)
    ) {
      throw new ValidationError('Name the area or the thing that needs cleaning');
    }

    const { event, tasks, usedFallback, notifications } = await withTransaction(
      async (connection) => {
        const asset = await cleaningAssetService.resolveReportTarget(
          connection,
          {
            ...(input.cleanableAssetId !== undefined
              ? { cleanableAssetId: input.cleanableAssetId }
              : {}),
            ...(input.areaId !== undefined ? { areaId: input.areaId } : {}),
            ...(input.equipmentId !== undefined ? { equipmentId: input.equipmentId } : {}),
          },
          actor,
        );

        const eventId = newId();
        const shift = await CleaningMasterRepository.findCurrentShift(connection);
        await CleaningEventRepository.insert(connection, {
          id: eventId,
          eventType,
          source: CleaningEventSource.MOBILE,
          occurredAt: toDbDateTime(),
          cleanableAssetId: asset.id,
          areaId: asset.area_id,
          equipmentId: input.equipmentId ?? asset.equipment_id,
          shiftId: shift?.id ?? null,
          assetTypeId: asset.asset_type_id,
          reportedBy: userId,
          note: (input.note ?? '').slice(0, LIMITS.CLEANING_EVENT_NOTE_MAX) || null,
          payload: toJsonColumn(
            input.photoMediaIds === undefined || input.photoMediaIds.length === 0
              ? null
              : { photoMediaIds: input.photoMediaIds.slice(0, LIMITS.CLEANING_EVIDENCE_PER_TASK_MAX) },
          ),
          dedupeKey: null,
        });

        const row = await CleaningEventRepository.findById(connection, eventId);
        if (row === null) throw new NotFoundError('Cleaning event', eventId);

        const generated = await this.process(connection, row, actor, {
          allowFallback: true,
          fallbackPriority: input.priority ?? null,
        });

        // The photos the reporter attached belong on the work they caused, not only on the
        // event — a cleaner opening the task must be able to see what they are looking for.
        //
        // Bounded on both axes: one report can reach many tasks (a type-scoped rule across an
        // area), so the naive nested loop is `photos × tasks` evidence rows. The per-task cap
        // is the same one `addEvidence` enforces, applied here so the two paths cannot
        // disagree about how many photos a task may carry.
        const photoIds = (input.photoMediaIds ?? []).slice(
          0,
          LIMITS.CLEANING_EVIDENCE_PER_TASK_MAX,
        );
        for (const mediaId of photoIds) {
          for (const task of generated.taskIds) {
            await CleaningTaskRepository.insertEvidence(connection, {
              id: newId(),
              taskId: task,
              mediaId,
              kind: 'BEFORE',
              stepId: null,
              caption: 'Reported',
              uploadedBy: userId,
            });
          }
        }

        await auditService.record(connection, actor, {
          action: AuditAction.CLEANING_INCIDENT_REPORTED,
          entityType: 'cleaning_event',
          entityId: eventId,
          after: {
            eventType,
            cleanableAssetId: asset.id,
            areaId: asset.area_id,
            tasksCreated: generated.taskIds.length,
            usedFallback: generated.usedFallback,
          },
        });

        const after = await CleaningEventRepository.findById(connection, eventId);
        return {
          event: mapCleaningEvent(after ?? row),
          tasks: generated.taskIds,
          usedFallback: generated.usedFallback,
          notifications: generated.notifications,
        };
      },
    );

    notificationService.publish(notifications);

    const taskDtos = await this.loadTasks(tasks, userId);
    return {
      event,
      tasks: taskDtos,
      usedFallback,
      message: messageFor(taskDtos, usedFallback),
    };
  }

  /**
   * The machine-to-machine door. Same engine, Manager and above, and no ad-hoc fallback: a
   * till reporting "batch completed" for a station with no rules must not manufacture work
   * nobody configured.
   */
  async publishEvent(
    input: CleaningEventPublishRequest,
    actor: AuditActor,
    userId: string,
    options: PublishOptions = {},
  ): Promise<CleaningReportResultDto> {
    if (!PUBLISHABLE_TRIGGER_EVENTS.includes(input.eventType)) {
      throw new ForbiddenError('SCHEDULE_DUE is raised by the scheduler and cannot be published');
    }

    const { event, tasks, usedFallback, notifications } = await withTransaction(
      async (connection) => {
        if (input.dedupeKey !== undefined && input.dedupeKey !== null) {
          const seen = await CleaningEventRepository.findByDedupeKey(connection, input.dedupeKey);
          if (seen !== null) {
            // Idempotent by contract: the same key twice is accepted and changes nothing.
            return {
              event: mapCleaningEvent(seen),
              tasks: [] as string[],
              usedFallback: false,
              notifications: [] as NotificationDto[],
            };
          }
        }

        const eventId = newId();
        const shift =
          input.shiftId ?? (await CleaningMasterRepository.findCurrentShift(connection))?.id ?? null;
        await CleaningEventRepository.insert(connection, {
          id: eventId,
          eventType: input.eventType,
          source: input.source ?? CleaningEventSource.INTEGRATION,
          occurredAt:
            input.occurredAt === undefined
              ? toDbDateTime()
              : toDbDateTime(new Date(input.occurredAt)),
          cleanableAssetId: input.cleanableAssetId ?? null,
          areaId: input.areaId ?? null,
          equipmentId: input.equipmentId ?? null,
          shiftId: shift,
          assetTypeId: input.assetTypeId ?? null,
          reportedBy: userId,
          note: input.note ?? null,
          payload: toJsonColumn(input.payload ?? null),
          dedupeKey: input.dedupeKey ?? null,
        });

        const row = await CleaningEventRepository.findById(connection, eventId);
        if (row === null) throw new NotFoundError('Cleaning event', eventId);

        const generated = await this.process(connection, row, actor, {
          allowFallback: options.allowFallback ?? false,
          fallbackPriority: null,
        });

        await auditService.record(connection, actor, {
          action: AuditAction.CLEANING_EVENT_PUBLISHED,
          entityType: 'cleaning_event',
          entityId: eventId,
          after: { eventType: input.eventType, tasksCreated: generated.taskIds.length },
        });

        const after = await CleaningEventRepository.findById(connection, eventId);
        return {
          event: mapCleaningEvent(after ?? row),
          tasks: generated.taskIds,
          usedFallback: generated.usedFallback,
          notifications: generated.notifications,
        };
      },
    );

    notificationService.publish(notifications);
    const taskDtos = await this.loadTasks(tasks, userId);
    return {
      event,
      tasks: taskDtos,
      usedFallback,
      message: messageFor(taskDtos, usedFallback),
    };
  }

  /**
   * Turns one stored event into tasks. Shared by both doors and by the scheduler.
   *
   * A generation failure is recorded on the event and rethrown: the transaction rolls back, so
   * an event that could not be processed does not sit in the log claiming it was.
   */
  async process(
    connection: PoolConnection,
    event: CleaningEventRow,
    actor: AuditActor,
    options: { allowFallback: boolean; fallbackPriority: CleaningTaskPriority | null },
  ): Promise<{ taskIds: string[]; usedFallback: boolean; notifications: NotificationDto[] }> {
    let result;
    try {
      result = await cleaningEngineService.generateForEvent(connection, event, actor);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('cleaning event processing failed', { eventId: event.id }, error);
      await CleaningEventRepository.markProcessed(connection, event.id, 0, message.slice(0, 1000));
      throw error;
    }

    let usedFallback = false;
    const taskIds = result.tasks.map((task) => task.taskId);
    const notifications = [...result.notifications];

    if (taskIds.length === 0 && options.allowFallback && event.cleanable_asset_id !== null) {
      const asset = await CleanableAssetRepository.findById(connection, event.cleanable_asset_id);
      if (asset !== null) {
        const adhoc = await cleaningEngineService.createAdhocTask(connection, {
          event,
          asset,
          priority: options.fallbackPriority ?? priorityForReport(event),
          actor,
        });
        if (adhoc !== null) {
          taskIds.push(adhoc.taskId);
          notifications.push(...adhoc.notifications);
          usedFallback = true;
        }
      }
    }

    await CleaningEventRepository.markProcessed(connection, event.id, taskIds.length, null);
    return { taskIds, usedFallback, notifications };
  }

  private async loadTasks(ids: readonly string[], userId: string): Promise<CleaningTaskDto[]> {
    if (ids.length === 0) return [];
    const pool = getPool();
    const viewer = await cleaningTaskService.viewerFor(userId);
    const tasks: CleaningTaskDto[] = [];
    for (const id of ids) {
      const row = await CleaningTaskRepository.findById(pool, id);
      if (row !== null) tasks.push(mapCleaningTask(row, viewer));
    }
    return tasks;
  }
}

/** A contamination report is critical whatever the rule said; a spill is at least high. */
function priorityForReport(event: CleaningEventRow): CleaningTaskPriority {
  if (event.event_type === CleaningTriggerEvent.CONTAMINATION_REPORTED) {
    return CleaningTaskPriority.CRITICAL;
  }
  if (event.event_type === CleaningTriggerEvent.SPILL_REPORTED) {
    return CleaningTaskPriority.HIGH;
  }
  return CleaningTaskPriority.NORMAL;
}

/** What the reporter is told. Never "submitted" — always what actually happened. */
function messageFor(tasks: readonly CleaningTaskDto[], usedFallback: boolean): string {
  if (tasks.length === 0) {
    return 'Reported. No cleaning rule covers that yet, so a supervisor will decide what to do.';
  }
  const owner = tasks.find((task) => task.assignedToName !== null)?.assignedToName ?? null;
  const what =
    tasks.length === 1 ? 'A cleaning task was raised' : `${tasks.length} cleaning tasks were raised`;
  const who = owner === null ? 'and a supervisor has been asked to assign it' : `and given to ${owner}`;
  const how = usedFallback ? ' as a one-off clean-up' : '';
  return `${what}${how} ${who}.`;
}

export const cleaningReportService = new CleaningReportService();
