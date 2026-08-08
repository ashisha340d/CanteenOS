import {
  BoardRole,
  BoardStatus,
  MemberStatus,
  NotificationType,
  OPEN_ORDER_STATUSES,
  UserRole,
  UserStatus,
  type BoardDto,
  type BoardEligibleUserDto,
  type BoardMemberDto,
  type BoardWithMembersDto,
  type CreateBoardRequest,
  type UpdateBoardRequest,
  type UpsertBoardMemberRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { currentSyncSeq } from '../db/syncSeq';
import { withTransaction } from '../db/transaction';
import { mapBoard, mapBoardMember } from '../models/mappers';
import { boardRepository, type BoardListFilter } from '../repositories/BoardRepository';
import { stationRepository } from '../repositories/MasterRepository';
import { orderRepository } from '../repositories/OrderRepository';
import { userRepository } from '../repositories/UserRepository';
import { realtime } from '../realtime/RealtimeGateway';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { todayIsoDate } from '../utils/time';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { notificationService } from './NotificationService';

export interface BoardQuery {
  search?: string;
  status?: BoardStatus;
  /** Restricts to boards belonging to this station. */
  stationId?: string;
  page?: number;
  pageSize?: number;
  sortBy?: BoardListFilter['sortBy'];
  sortDir?: 'asc' | 'desc';
}

export class BoardService {
  /**
   * Boards visible to the caller. Administrators see every board (they hold
   * BOARD_READ_ALL); everyone else sees only boards they are an active member of.
   */
  async list(
    actor: { userId: string; role: UserRole },
    query: BoardQuery,
    options: { withCounts?: boolean } = {},
  ) {
    const { page, pageSize, offset } = resolvePaging(query);
    const pool = getPool();
    const seesAllBoards = actor.role === UserRole.SUPER_ADMIN || actor.role === UserRole.ADMIN;

    const { rows, total } = await boardRepository.list(pool, {
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.stationId !== undefined ? { stationId: query.stationId } : {}),
      ...(query.sortBy !== undefined ? { sortBy: query.sortBy } : {}),
      ...(query.sortDir !== undefined ? { sortDir: query.sortDir } : {}),
      ...(seesAllBoards ? {} : { memberUserId: actor.userId }),
      limit: pageSize,
      offset,
    });

    const boardIds = rows.map((row) => row.id);
    const memberRows = await boardRepository.listMembersForBoards(pool, boardIds);
    const membersByBoard = new Map<string, BoardMemberDto[]>();
    for (const row of memberRows) {
      const list = membersByBoard.get(row.board_id) ?? [];
      list.push(mapBoardMember(row));
      membersByBoard.set(row.board_id, list);
    }

    const counts = options.withCounts === true ? await this.countsForBoards(boardIds) : null;

    const items: BoardWithMembersDto[] = rows.map((row) => {
      const board = mapBoard(row);
      const count = counts?.get(row.id);
      return {
        ...board,
        members: membersByBoard.get(row.id) ?? [],
        ...(count ? { openOrderCount: count.open, todayOrderCount: count.today } : {}),
      };
    });

    return buildPage(items, total, page, pageSize);
  }

  async getById(id: string): Promise<BoardWithMembersDto> {
    const pool = getPool();
    const row = await boardRepository.findById(pool, id);
    if (row === null) throw new NotFoundError('Board', id);

    const members = await boardRepository.listMembers(pool, id);
    return { ...mapBoard(row), members: members.map(mapBoardMember) };
  }

  async create(input: CreateBoardRequest, actor: AuditActor): Promise<BoardWithMembersDto> {
    if (actor.userId === null) throw new ValidationError('An authenticated actor is required');
    const creatorId = actor.userId;

    const result = await withTransaction(async (connection) => {
      const station = await stationRepository.findById(connection, input.stationId);
      if (station === null) throw new NotFoundError('Station', input.stationId);

      const board = await boardRepository.insert(connection, {
        id: input.id ?? newId(),
        stationId: input.stationId,
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? null,
        photoPath: input.photoPath ?? null,
        status: BoardStatus.ACTIVE,
        createdBy: creatorId,
      });

      // The creator is always an OWNER, so a board can never exist without someone able to
      // manage it.
      await boardRepository.upsertMember(connection, {
        id: newId(),
        boardId: board.id,
        userId: creatorId,
        boardRole: BoardRole.OWNER,
        status: MemberStatus.ACTIVE,
        invitedBy: null,
      });

      const invited = (input.members ?? []).filter((member) => member.userId !== creatorId);
      for (const member of invited) {
        const user = await userRepository.findById(connection, member.userId);
        if (user === null) throw new NotFoundError('User', member.userId);
        await boardRepository.upsertMember(connection, {
          id: newId(),
          boardId: board.id,
          userId: member.userId,
          boardRole: member.boardRole,
          status: MemberStatus.ACTIVE,
          invitedBy: creatorId,
        });
      }

      const notifications = await notificationService.notify(connection, {
        userIds: invited.map((member) => member.userId),
        type: NotificationType.BOARD_INVITATION,
        title: `You were added to ${board.name}`,
        body: input.description ?? null,
        boardId: board.id,
        actorId: creatorId,
      });

      await auditService.record(connection, actor, {
        action: AuditAction.BOARD_CREATED,
        entityType: 'board',
        entityId: board.id,
        boardId: board.id,
        after: { name: board.name, memberCount: invited.length + 1 },
      });

      const members = await boardRepository.listMembers(connection, board.id);
      return { board, members, notifications };
    });

    // Emission happens after commit so a device that reacts immediately sees the new board.
    const cursor = await currentSyncSeq(getPool());
    notificationService.publish(result.notifications);
    realtime.emitMembershipChange(
      result.board.id,
      result.members.map((member) => member.user_id),
      cursor,
    );

    return { ...mapBoard(result.board), members: result.members.map(mapBoardMember) };
  }

  async update(id: string, input: UpdateBoardRequest, actor: AuditActor): Promise<BoardDto> {
    const result = await withTransaction(async (connection) => {
      const before = await boardRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Board', id);

      if (input.stationId !== undefined) {
        const station = await stationRepository.findById(connection, input.stationId);
        if (station === null) throw new NotFoundError('Station', input.stationId);
      }

      const row = await boardRepository.update(connection, id, {
        ...(input.stationId !== undefined ? { stationId: input.stationId } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.photoPath !== undefined ? { photoPath: input.photoPath } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      });
      if (row === null) throw new NotFoundError('Board', id);

      await auditService.record(connection, actor, {
        action:
          input.status === BoardStatus.ARCHIVED
            ? AuditAction.BOARD_ARCHIVED
            : AuditAction.BOARD_UPDATED,
        entityType: 'board',
        entityId: id,
        boardId: id,
        before: { name: before.name, status: before.status, description: before.description },
        after: { name: row.name, status: row.status, description: row.description },
      });

      return row;
    });

    realtime.emitBoardChange(id, ['boards'], Number(result.sync_seq));
    return mapBoard(result);
  }

  /** Archiving is the supported way to retire a board; open orders block it. */
  async archive(id: string, actor: AuditActor): Promise<BoardDto> {
    const pool = getPool();
    const { total } = await orderRepository.list(pool, {
      boardId: id,
      status: OPEN_ORDER_STATUSES,
      limit: 1,
      offset: 0,
    });
    if (total > 0) {
      throw new ConflictError(
        `This board still has ${total} open order(s); complete or cancel them before archiving`,
      );
    }
    return this.update(id, { status: BoardStatus.ARCHIVED }, actor);
  }

  /* ------------------------------------------------------------------ members */

  async listMembers(boardId: string): Promise<BoardMemberDto[]> {
    const pool = getPool();
    const board = await boardRepository.findById(pool, boardId);
    if (board === null) throw new NotFoundError('Board', boardId);
    const rows = await boardRepository.listMembers(pool, boardId);
    return rows.map(mapBoardMember);
  }

  /**
   * Active users who are not already on the board — the add-member picker's options.
   *
   * Board-scoped on purpose: `GET /users` needs the global USER_READ capability, which a
   * board OWNER/MANAGER whose global role is plain USER does not hold, so they could not
   * otherwise pick anyone to add.
   */
  async listEligibleMembers(
    boardId: string,
    search?: string,
  ): Promise<BoardEligibleUserDto[]> {
    const pool = getPool();
    const board = await boardRepository.findById(pool, boardId);
    if (board === null) throw new NotFoundError('Board', boardId);

    const members = await boardRepository.listMembers(pool, boardId);
    const existing = new Set(members.map((member) => member.user_id));

    const { rows } = await userRepository.list(pool, {
      status: UserStatus.ACTIVE,
      limit: 50,
      offset: 0,
      ...(search !== undefined ? { search } : {}),
    });

    return rows
      .filter((row) => !existing.has(row.id))
      .map((row) => ({
        id: row.id,
        name: row.name,
        username: row.username,
        avatarPath: row.avatar_path,
      }));
  }

  async upsertMember(
    boardId: string,
    input: UpsertBoardMemberRequest,
    actor: AuditActor,
  ): Promise<BoardMemberDto> {
    const result = await withTransaction(async (connection) => {
      const board = await boardRepository.findById(connection, boardId);
      if (board === null) throw new NotFoundError('Board', boardId);

      const user = await userRepository.findById(connection, input.userId);
      if (user === null) throw new NotFoundError('User', input.userId);

      const existing = await boardRepository.findMember(connection, boardId, input.userId);

      // Demoting the last OWNER would leave the board unmanageable.
      if (
        existing !== null &&
        existing.board_role === BoardRole.OWNER &&
        input.boardRole !== BoardRole.OWNER &&
        existing.status === MemberStatus.ACTIVE
      ) {
        const owners = await boardRepository.countOwners(connection, boardId);
        if (owners <= 1) {
          throw new ConflictError('A board must always have at least one owner');
        }
      }

      const row = await boardRepository.upsertMember(connection, {
        id: existing?.id ?? newId(),
        boardId,
        userId: input.userId,
        boardRole: input.boardRole,
        status: MemberStatus.ACTIVE,
        invitedBy: actor.userId,
      });

      const isNewMember = existing === null || existing.status !== MemberStatus.ACTIVE;
      const notifications = isNewMember
        ? await notificationService.notify(connection, {
          userIds: [input.userId],
          type: NotificationType.BOARD_INVITATION,
          title: `You were added to ${board.name}`,
          boardId,
          actorId: actor.userId,
        })
        : [];

      await auditService.record(connection, actor, {
        action: isNewMember ? AuditAction.BOARD_MEMBER_ADDED : AuditAction.BOARD_MEMBER_UPDATED,
        entityType: 'board_member',
        entityId: row.id,
        boardId,
        before: existing
          ? { boardRole: existing.board_role, status: existing.status }
          : null,
        after: { userId: input.userId, boardRole: row.board_role, status: row.status },
      });

      return { row, notifications };
    });

    notificationService.publish(result.notifications);
    realtime.emitMembershipChange(boardId, [input.userId], Number(result.row.sync_seq));
    return mapBoardMember(result.row);
  }

  async removeMember(boardId: string, userId: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const existing = await boardRepository.findMember(connection, boardId, userId);
      if (existing === null || existing.status === MemberStatus.REMOVED) {
        throw new NotFoundError('Board member', userId);
      }

      if (existing.board_role === BoardRole.OWNER) {
        const owners = await boardRepository.countOwners(connection, boardId);
        if (owners <= 1) {
          throw new ConflictError('The last owner of a board cannot be removed');
        }
      }

      await boardRepository.removeMember(connection, boardId, userId);

      await auditService.record(connection, actor, {
        action: AuditAction.BOARD_MEMBER_REMOVED,
        entityType: 'board_member',
        entityId: existing.id,
        boardId,
        before: { userId, boardRole: existing.board_role },
      });
    });

    const cursor = await currentSyncSeq(getPool());
    realtime.emitMembershipChange(boardId, [userId], cursor);
  }

  /** Home-screen tiles: open and today's order counts per board, in one pass. */
  private async countsForBoards(
    boardIds: readonly string[],
  ): Promise<Map<string, { open: number; today: number }>> {
    const counts = new Map<string, { open: number; today: number }>();
    if (boardIds.length === 0) return counts;

    const pool = getPool();
    const today = todayIsoDate();

    for (const boardId of boardIds) {
      const open = await orderRepository.list(pool, {
        boardId,
        status: OPEN_ORDER_STATUSES,
        limit: 1,
        offset: 0,
      });
      const todays = await orderRepository.list(pool, {
        boardId,
        dateFrom: today,
        dateTo: today,
        limit: 1,
        offset: 0,
      });
      counts.set(boardId, { open: open.total, today: todays.total });
    }
    return counts;
  }
}

export const boardService = new BoardService();
