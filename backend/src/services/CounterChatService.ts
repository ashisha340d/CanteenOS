import {
  ClientType,
  CounterMessageDirection,
  CounterMessageKind,
  LIMITS,
  type CounterChatSummaryDto,
  type CounterChatThreadDto,
  type CounterMessageDto,
  type CounterOrderTagDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { kdsRepository } from '../repositories/KdsRepository';
import { posRepository } from '../repositories/PosRepository';
import {
  counterChatRepository,
  type CounterMessageRow,
} from '../repositories/CounterChatRepository';
import { realtime } from '../realtime/RealtimeGateway';
import { NotFoundError, ValidationError } from '../utils/errors';
import { newId } from '../utils/ids';
import { logger } from '../utils/logger';
import { fromDbDateTime, fromDbDateTimeRequired } from '../utils/time';
import { translateText } from './TranslateService';

function toDto(row: CounterMessageRow): CounterMessageDto {
  return {
    id: row.id,
    counterId: row.counter_id,
    direction: row.direction,
    kind: row.kind,
    body: row.body,
    bodyHi: row.body_hi,
    orderId: row.pos_order_id,
    orderNumber: row.order_number,
    senderId: row.sender_id,
    senderName: row.sender_name,
    readAt: fromDbDateTime(row.read_at),
    createdAt: fromDbDateTimeRequired(row.created_at),
  };
}

/**
 * Which end of the channel a caller is standing at.
 *
 * Taken from the client type baked into the access token rather than from anything the request
 * says about itself: a wall display speaks as the counter and the admin panel speaks as the
 * office, and neither should be able to claim the other's voice by posting a different field.
 */
export function sideFor(clientType: ClientType): CounterMessageDirection {
  return clientType === ClientType.KDS
    ? CounterMessageDirection.TO_ADMIN
    : CounterMessageDirection.TO_COUNTER;
}

/** The messages a given side is waiting to read — the opposite side's, by definition. */
function inboundFor(side: CounterMessageDirection): CounterMessageDirection {
  return side === CounterMessageDirection.TO_ADMIN
    ? CounterMessageDirection.TO_COUNTER
    : CounterMessageDirection.TO_ADMIN;
}

export class CounterChatService {
  async thread(counterId: string, side: CounterMessageDirection): Promise<CounterChatThreadDto> {
    const pool = getPool();
    const counter = await this.requireCounter(counterId);
    const [rows, unreadCount] = await Promise.all([
      counterChatRepository.listThread(pool, counterId, LIMITS.COUNTER_MESSAGE_PAGE_MAX),
      counterChatRepository.unreadCount(pool, counterId, inboundFor(side)),
    ]);
    return {
      counterId,
      counterName: counter.name,
      messages: rows.map(toDto),
      unreadCount,
    };
  }

  /** Every counter with its last word and what is waiting — the admin's chat list. */
  async summaries(): Promise<CounterChatSummaryDto[]> {
    const pool = getPool();
    const [counters, latest, unread] = await Promise.all([
      kdsRepository.listActiveCounters(pool),
      counterChatRepository.listLatestPerCounter(pool),
      counterChatRepository.unreadByCounter(pool, CounterMessageDirection.TO_ADMIN),
    ]);
    const lastByCounter = new Map(latest.map((row) => [row.counter_id, row]));
    const unreadByCounter = new Map(unread.map((row) => [row.counter_id, Number(row.unread)]));

    return counters.map((counter) => {
      const last = lastByCounter.get(counter.id);
      return {
        counterId: counter.id,
        counterName: counter.name,
        lastMessage: last === undefined ? null : toDto(last),
        unreadCount: unreadByCounter.get(counter.id) ?? 0,
      };
    });
  }

  async send(
    counterId: string,
    side: CounterMessageDirection,
    input: { body: string; orderId?: string | null },
    actor: { userId: string; name: string | null },
  ): Promise<CounterMessageDto> {
    const body = input.body.trim();
    if (body === '') {
      throw new ValidationError('A message cannot be empty', [
        { path: 'body', message: 'Write something to send' },
      ]);
    }
    await this.requireCounter(counterId);

    /* A tagged order is verified and its number snapshotted here: the thread has to keep
       reading correctly long after that order has left the board.

       The check is the board's own routing rule, not `pos_orders.counter_id`. That column is
       null on every order the till writes — an order reaches a counter because its *items* are
       routed there — so comparing it rejected every single tag, which made attaching an order
       fail the whole send. */
    let orderNumber: string | null = null;
    const orderId = input.orderId ?? null;
    if (orderId !== null) {
      const pool = getPool();
      const order = await posRepository.findById(pool, orderId);
      const onThisCounter =
        order !== null && (await kdsRepository.orderTouchesCounter(pool, orderId, counterId));
      if (!onThisCounter) {
        throw new ValidationError('That order is not on this counter', [
          { path: 'orderId', message: 'Pick an order from this counter' },
        ]);
      }
      orderNumber = (order as { order_number: string }).order_number;
    }

    return this.persistAndEmit({
      counterId,
      direction: side,
      kind: CounterMessageKind.TEXT,
      body,
      orderId,
      orderNumber,
      actor,
    });
  }

  /**
   * The office rings the counter. Stored like a message so a counter that was away still sees
   * that it was rung, and so the thread reads as the conversation it actually was.
   */
  async ringBell(
    counterId: string,
    side: CounterMessageDirection,
    actor: { userId: string; name: string | null },
  ): Promise<CounterMessageDto> {
    if (side !== CounterMessageDirection.TO_COUNTER) {
      throw new ValidationError('Only the office rings a counter', [
        { path: 'bell', message: 'A counter cannot ring itself' },
      ]);
    }
    await this.requireCounter(counterId);
    return this.persistAndEmit({
      counterId,
      direction: side,
      kind: CounterMessageKind.BELL,
      body: '',
      orderId: null,
      orderNumber: null,
      actor,
    });
  }

  /**
   * Ends a ring in progress. Nothing is stored — the bell is already in the thread as the call
   * that was placed, and whether the caller hung up at two rings or three is not something the
   * counter needs a record of.
   */
  async hangUp(counterId: string, side: CounterMessageDirection): Promise<{ ended: true }> {
    if (side !== CounterMessageDirection.TO_COUNTER) {
      throw new ValidationError('Only the office can end a ring', [
        { path: 'counterId', message: 'A counter cannot hang up on itself' },
      ]);
    }
    await this.requireCounter(counterId);
    realtime.emitChatBellEnd(counterId);
    return { ended: true };
  }

  async markRead(counterId: string, side: CounterMessageDirection): Promise<{ unreadCount: number }> {
    const inbound = inboundFor(side);
    await counterChatRepository.markRead(getPool(), counterId, inbound);
    realtime.emitChatRead(counterId, inbound);
    return { unreadCount: 0 };
  }

  /**
   * Empties a counter's thread. The office's call alone — a counter clearing the record of what
   * it was just told is the one direction this should not work in.
   */
  async clearThread(
    counterId: string,
    side: CounterMessageDirection,
  ): Promise<{ cleared: number }> {
    if (side !== CounterMessageDirection.TO_COUNTER) {
      throw new ValidationError('Only the office can clear a conversation', [
        { path: 'counterId', message: 'A counter cannot clear its own thread' },
      ]);
    }
    await this.requireCounter(counterId);
    const cleared = await counterChatRepository.deleteThread(getPool(), counterId);
    realtime.emitChatCleared(counterId);
    return { cleared };
  }

  async orderTags(counterId: string): Promise<CounterOrderTagDto[]> {
    const rows = await counterChatRepository.listOrderTags(getPool(), counterId);
    return rows.map((row) => ({
      orderId: row.pos_order_id,
      messageCount: Number(row.message_count),
      unreadCount: Number(row.unread_count),
    }));
  }

  /**
   * Translates one message into Hindi on demand and remembers the result.
   *
   * The board's auto-translate switch calls this for anything that arrived without a Hindi
   * rendering — the send-time attempt is best-effort and quietly gives up when the canteen has
   * no internet, so this is the counter asking again, deliberately, for a message in front of
   * it. Already-translated messages return as they are rather than paying for the call twice.
   */
  async translateMessage(messageId: string): Promise<CounterMessageDto> {
    const pool = getPool();
    const row = await counterChatRepository.findById(pool, messageId);
    if (row === null) throw new NotFoundError('Counter message', messageId);

    const existing = toDto(row);
    if (existing.bodyHi !== null || existing.body.trim() === '') return existing;

    let hindi: string;
    try {
      hindi = (await translateText(existing.body, 'hi')).trim();
    } catch (error) {
      throw new ValidationError('Translation is unavailable right now', [
        {
          path: 'messageId',
          message: error instanceof Error ? error.message : 'The translator could not be reached',
        },
      ]);
    }
    if (hindi === '' || hindi === existing.body) return existing;

    await counterChatRepository.setBodyHi(pool, messageId, hindi);
    const updated: CounterMessageDto = { ...existing, bodyHi: hindi };
    // Everyone on the channel gets it, not just the asker: the office pays for one call and
    // both screens end up showing the same thing.
    realtime.emitChatMessage(existing.counterId, updated);
    return updated;
  }

  private async persistAndEmit(input: {
    counterId: string;
    direction: CounterMessageDirection;
    kind: CounterMessageKind;
    body: string;
    orderId: string | null;
    orderNumber: string | null;
    actor: { userId: string; name: string | null };
  }): Promise<CounterMessageDto> {
    const pool = getPool();
    const id = newId();
    await counterChatRepository.insert(pool, {
      id,
      counterId: input.counterId,
      direction: input.direction,
      kind: input.kind,
      body: input.body,
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      senderId: input.actor.userId,
      senderName: input.actor.name,
    });

    const row = await counterChatRepository.findById(pool, id);
    if (row === null) throw new NotFoundError('Counter message', id);
    const dto = toDto(row);

    if (dto.kind === CounterMessageKind.BELL) {
      realtime.emitChatBell(input.counterId, dto);
    } else {
      realtime.emitChatMessage(input.counterId, dto);
      // Deliberately after the emit and deliberately not awaited: see `enrichHindi`.
      this.enrichHindi(dto);
    }
    return dto;
  }

  /**
   * Adds the Hindi rendering *after* the message is already delivered.
   *
   * `translateText` is a call to a third-party service over the public internet. A canteen with
   * no connectivity, or a rate limit, must not be able to delay or fail a message between the
   * office and a counter — so the message goes first, the translation follows if it can, and
   * clients get a second event carrying the same id to replace what they already show. A board
   * that never receives it simply reads the original, which is exactly what `bodyHi: null`
   * already means to every client.
   */
  private enrichHindi(message: CounterMessageDto): void {
    // Only the office's words need translating: the counter writes in whichever language it
    // reads, and the admin panel is English-only.
    if (message.direction !== CounterMessageDirection.TO_COUNTER) return;

    void (async () => {
      try {
        const hindi = (await translateText(message.body, 'hi')).trim();
        if (hindi === '' || hindi === message.body) return;
        await counterChatRepository.setBodyHi(getPool(), message.id, hindi);
        realtime.emitChatMessage(message.counterId, { ...message, bodyHi: hindi });
      } catch (error) {
        logger.debug('Counter message translation unavailable', {
          messageId: message.id,
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    })();
  }

  private async requireCounter(counterId: string): Promise<{ id: string; name: string }> {
    const counters = await kdsRepository.listActiveCounters(getPool());
    const counter = counters.find((row) => row.id === counterId);
    if (counter === undefined) throw new NotFoundError('Counter', counterId);
    return { id: counter.id, name: counter.name };
  }
}

export const counterChatService = new CounterChatService();
