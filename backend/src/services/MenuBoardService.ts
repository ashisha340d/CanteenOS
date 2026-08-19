import { createHash, randomUUID } from 'node:crypto';
import {
  AvailabilityStatus,
  MasterStatus,
  type CreateMenuBoardScreenRequest,
  type MenuBoardConfig,
  type MenuBoardItemDto,
  type MenuBoardScreenDto,
  type MenuBoardSnapshotDto,
  type UpdateMenuBoardScreenRequest,
} from '@menuboard/shared';
import { config } from '../config';
import { getPool } from '../db/pool';
import type { MenuBoardScreenRow } from '../models/menuBoardRows';
import { menuBoardScreenRepository } from '../repositories/MenuBoardScreenRepository';
import { menuItemScheduleRepository } from '../repositories/MenuMasterRepository';
import { menuBoardRealtime } from '../realtime/menuBoardSocket';
import { ConflictError, NotFoundError } from '../utils/errors';
import { parseJsonColumn } from '../utils/json';
import { logger } from '../utils/logger';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { menuMasterService } from './MenuMasterService';
import { settingsService } from './SettingsService';

/**
 * The Digital Menu Board.
 *
 * One screen on a wall, opened by URL with nobody signed in, showing a published menu from
 * Menu Master. Its whole job is to answer one question cheaply and repeatedly — "what should
 * this screen be showing right now?" — and to be safe to leave reachable from a public hall.
 *
 * Safety comes from the shape of the answer rather than from a session. The snapshot carries
 * names, prices and photographs and nothing else: no counter routing, no printing groups, no
 * modifier ids, no variant ids, no cost prices, no menu id. Those all exist on the resolved
 * tree this service reads from, and every one of them is deliberately dropped before the
 * payload leaves — a menu board that leaked the counter's routing configuration to anyone on
 * the network would be a worse trade than a board that needs a login.
 */

/**
 * How a resolved media id becomes a URL for a board.
 *
 * Not the signed, expiring link the authenticated clients use. A wall screen holds one page
 * open for days: a two-hour signature would blank its photography overnight, and re-signing on
 * every poll would make every URL differ on every fetch, which defeats the revision check and
 * churns every `<img>` on the board. This URL is stable, so the browser caches each photo once
 * and the board redraws without a single network round trip.
 */
function boardMediaUrl(mediaId: string): string {
  return `${config.publicUrl}/api/v1/menu-board/media/${mediaId}`;
}

/** Formats a resolved price the way the board has always rendered one: a bare integer rupee. */
function formatPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export class MenuBoardService {
  /* ------------------------------------------------------------------ the public feed */

  /**
   * Everything one screen needs for one render.
   *
   * @param screenCode the screen's own code, or null for "the default screen". An unknown code
   *   is a 404 rather than a silent fallback: a board showing the wrong hall's menu because
   *   somebody mistyped the URL is worse than a board that says it is not configured.
   * @param preview true when the caller is the Admin Portal's layout editor rather than a wall
   *   screen, which suppresses the heartbeat below — see the note there.
   */
  async snapshot(screenCode: string | null, preview = false): Promise<MenuBoardSnapshotDto> {
    const pool = getPool();
    const screen =
      screenCode === null
        ? await menuBoardScreenRepository.findDefault(pool)
        : await menuBoardScreenRepository.findByCode(pool, screenCode);

    if (screen === null) throw new NotFoundError('Menu board screen', screenCode ?? 'default');
    if (screen.status !== MasterStatus.ACTIVE) {
      throw new NotFoundError('Menu board screen', screen.code);
    }

    const menuCode = await this.resolveMenuCode(screen);
    const tree = await menuMasterService.getMenuTree(menuCode, MENU_BOARD_ACTOR_ID, boardMediaUrl);
    const boardConfig = parseJsonColumn<MenuBoardConfig>(screen.config, {});

    // The morning menu. Between the configured morning hours the board shows *only* what is
    // flagged for that shift, which makes this flag load-bearing rather than decorative: get it
    // wrong in the "nothing is morning food" direction and the wall goes blank at breakfast.
    //
    // Menu Master already answers this — `menu_item_schedules` holds a MORNING/EVENING slot per
    // weekday per dish — so the flag is resolved from there rather than invented.
    //
    // Until an operator sets those slots, no dish resolves as morning food. That is the honest
    // answer and the board treats it as one: a menu with nothing scheduled for the morning is a
    // menu nobody has scheduled, not a menu with nothing for breakfast, so it shows everything.
    // The moment a MORNING slot is set on any dish, the restriction starts working.
    const morningFoodItemIds = await menuItemScheduleRepository.findFoodItemsInShift(
      pool,
      [...new Set(tree.categories.flatMap((c) => c.items.map((i) => i.foodItemId)))],
      new Date().getDay(),
      'MORNING',
    );

    const items: MenuBoardItemDto[] = [];
    for (const category of tree.categories) {
      for (const item of category.items) {
        // `boardVisible` is the Menu Master flag that means precisely this screen. An item can
        // be sellable at the counter and deliberately absent from the wall — staff meals,
        // catering lines, anything priced but not advertised — and honouring the flag here is
        // what lets one menu serve both without a second menu to keep in step.
        if (!item.boardVisible) continue;

        // A dish with portions contributes one priced line per portion, which is how this
        // board has always rendered "Half / Full". A dish with none contributes its own line
        // at the menu's base price.
        const portions = item.variants.filter(
          (variant) => variant.availability !== AvailabilityStatus.UNAVAILABLE,
        );
        if (portions.length > 0) {
          for (const variant of portions) {
            // Always led by the dish, because a board is read from across a room: a row that
            // says only "Grilled Paneer" tells a guest nothing about what they are ordering.
            // `portionName` is the label an operator meant for the guest; `name` is the
            // fallback when they only filled one field in, and it is dropped when it merely
            // repeats the dish.
            const label = variant.portionName ?? variant.name;
            items.push({
              id: `${item.id}:${variant.id}`,
              category: category.name,
              categoryHi: category.nameHi ?? '',
              name: label && label !== item.name ? `${item.name} (${label})` : item.name,
              nameHi: variant.nameHi ?? item.nameHi ?? '',
              price: formatPrice(variant.price),
              image: variant.primaryMediaUrl ?? '',
              available: variant.availability === AvailabilityStatus.AVAILABLE,
              isMorning: morningFoodItemIds.has(item.foodItemId),
              featured: false,
            });
          }
        } else {
          items.push({
            id: item.id,
            category: category.name,
            categoryHi: category.nameHi ?? '',
            name: item.name,
            nameHi: item.nameHi ?? '',
            price: formatPrice(item.basePrice),
            image: item.primaryMediaUrl ?? '',
            available: item.availability === AvailabilityStatus.AVAILABLE,
            isMorning: morningFoodItemIds.has(item.foodItemId),
            featured: false,
          });
        }
      }
    }

    // A screen being switched on is not an edit, so this never touches `revision` and can
    // never move the snapshot's own revision — see the repository note on `touch`.
    //
    // Skipped for the portal's layout editor, which frames this same page: the heartbeat is the
    // only way an operator two floors away can tell a display that is switched off from one
    // that is on and showing the wrong menu, and a settings tab left open on a desk must not be
    // able to answer that question on the wall's behalf.
    if (!preview) {
      menuBoardScreenRepository.touch(pool, screen.id).catch((error: unknown) => {
        logger.warn('Failed to stamp menu board heartbeat', { screen: screen.code }, error);
      });
    }

    return {
      screen: { code: screen.code, name: screen.name, pollSeconds: screen.poll_seconds },
      menu: { code: tree.code, name: tree.name },
      revision: revisionOf(items, boardConfig),
      config: boardConfig,
      items,
    };
  }

  /**
   * The revision alone.
   *
   * This is what a board actually polls. Computing it still resolves the whole tree — there is
   * no cheaper honest answer, because a price change deep in a variant has to move it — but
   * the response is forty bytes rather than a full menu, so an idle hall of screens costs
   * bandwidth proportional to nothing.
   */
  async revision(screenCode: string | null): Promise<string> {
    return (await this.snapshot(screenCode)).revision;
  }

  /**
   * A screen's blank `menu_code` means "whatever the POS prices against". A single-menu
   * operation then configures its menu in one place instead of two, and cannot end up with a
   * board advertising last season's prices because only the POS default was updated.
   */
  private async resolveMenuCode(screen: MenuBoardScreenRow): Promise<string> {
    const own = screen.menu_code.trim();
    if (own !== '') return own;

    const fallback = (await settingsService.get<string>('pos.default_menu_code'))?.trim() ?? '';
    if (fallback === '') {
      throw new NotFoundError(
        'Menu for board screen',
        `${screen.code} (no menu chosen, and pos.default_menu_code is blank)`,
      );
    }
    return fallback;
  }

  /* ----------------------------------------------------------------- the screen registry */

  async listScreens(): Promise<MenuBoardScreenDto[]> {
    const rows = await menuBoardScreenRepository.list(getPool());
    return rows.map(mapScreen);
  }

  async getScreen(id: string): Promise<MenuBoardScreenDto> {
    const row = await menuBoardScreenRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('Menu board screen', id);
    return mapScreen(row);
  }

  async createScreen(
    input: CreateMenuBoardScreenRequest,
    actor: AuditActor,
  ): Promise<MenuBoardScreenDto> {
    const pool = getPool();
    const code = input.code.trim().toUpperCase();
    if ((await menuBoardScreenRepository.countByCode(pool, code, null)) > 0) {
      throw new ConflictError(`A menu board screen with code ${code} already exists`);
    }

    const row = await menuBoardScreenRepository.insert(pool, {
      id: randomUUID(),
      code,
      name: input.name.trim(),
      menuCode: (input.menuCode ?? '').trim(),
      pollSeconds: input.pollSeconds ?? 60,
      config: input.config ?? {},
      status: input.status ?? MasterStatus.ACTIVE,
      createdBy: actor.userId,
    });

    await auditService.record(pool, actor, {
      action: AuditAction.MENU_BOARD_SCREEN_CREATED,
      entityType: 'menu_board_screen',
      entityId: row.id,
      after: auditShape(mapScreen(row)),
    });
    // A brand-new screen has no board connected to it yet, so this reaches nobody today — kept
    // for the same reason every other write here announces: consistency, and the moment this
    // screen's own URL is opened its first connect already fetches the current row.
    menuBoardRealtime.announceChange(`screen:create:${row.code}`);
    return mapScreen(row);
  }

  async updateScreen(
    id: string,
    input: UpdateMenuBoardScreenRequest,
    actor: AuditActor,
  ): Promise<MenuBoardScreenDto> {
    const pool = getPool();
    const existing = await menuBoardScreenRepository.findById(pool, id);
    if (existing === null) throw new NotFoundError('Menu board screen', id);

    const code = input.code === undefined ? undefined : input.code.trim().toUpperCase();
    if (code !== undefined && (await menuBoardScreenRepository.countByCode(pool, code, id)) > 0) {
      throw new ConflictError(`A menu board screen with code ${code} already exists`);
    }

    const row = await menuBoardScreenRepository.update(pool, id, {
      code,
      name: input.name?.trim(),
      menuCode: input.menuCode === undefined ? undefined : input.menuCode.trim(),
      pollSeconds: input.pollSeconds,
      config: input.config,
      status: input.status,
    });
    if (row === null) throw new NotFoundError('Menu board screen', id);

    await auditService.record(pool, actor, {
      action: AuditAction.MENU_BOARD_SCREEN_UPDATED,
      entityType: 'menu_board_screen',
      entityId: id,
      before: auditShape(mapScreen(existing)),
      after: auditShape(mapScreen(row)),
    });
    // This is the write a live board actually needs to hear about: a code, name, menu, or
    // config edit reached here is exactly what its next snapshot will differ on.
    menuBoardRealtime.announceChange(`screen:update:${row.code}`);
    return mapScreen(row);
  }

  async deleteScreen(id: string, actor: AuditActor): Promise<void> {
    const pool = getPool();
    const existing = await menuBoardScreenRepository.findById(pool, id);
    if (existing === null) throw new NotFoundError('Menu board screen', id);

    await menuBoardScreenRepository.softDelete(pool, id);
    await auditService.record(pool, actor, {
      action: AuditAction.MENU_BOARD_SCREEN_DELETED,
      entityType: 'menu_board_screen',
      entityId: id,
      before: auditShape(mapScreen(existing)),
    });
    // A deleted screen's own connected board now gets a 404 on its next snapshot rather than
    // silently going stale — see `snapshot()`'s NotFoundError when the code no longer resolves.
    menuBoardRealtime.announceChange(`screen:delete:${existing.code}`);
  }
}

/**
 * The identity `getMenuTree` is resolved under.
 *
 * It exists only to satisfy that method's signature — the board passes its own URL builder, so
 * this id never reaches a signature, a permission check or a query. A fixed UUID rather than a
 * string like `menu-board` because the surrounding code types it as one.
 */
const MENU_BOARD_ACTOR_ID = '00000000-0000-4000-8000-000000000b0a';

/**
 * A fingerprint of everything a screen renders.
 *
 * Hashing the payload rather than reading a `MAX(updated_at)` is what makes this honest: a
 * price lives on a variant, availability on an assignment, a photograph on a media assignment
 * and the type sizes on the screen row, so there is no single timestamp that moves for all of
 * them. If it is on the board, it is in the hash.
 */
function revisionOf(items: MenuBoardItemDto[], boardConfig: MenuBoardConfig): string {
  return createHash('sha256')
    .update(JSON.stringify({ items, boardConfig }))
    .digest('base64url')
    .slice(0, 22);
}

/**
 * What an audit row records about a screen. The presentation blob is deliberately left out:
 * nudging a font size is not the change anyone will ever review this trail for, and carrying
 * it would bury the one that matters — which menu the wall is advertising.
 */
function auditShape(screen: MenuBoardScreenDto): Record<string, unknown> {
  return {
    code: screen.code,
    name: screen.name,
    menuCode: screen.menuCode,
    pollSeconds: screen.pollSeconds,
    status: screen.status,
  };
}

function mapScreen(row: MenuBoardScreenRow): MenuBoardScreenDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    menuCode: row.menu_code,
    menuName: row.menu_name ?? null,
    pollSeconds: row.poll_seconds,
    config: parseJsonColumn<MenuBoardConfig>(row.config, {}),
    status: row.status,
    lastSeenAt: row.last_seen_at === null ? null : new Date(row.last_seen_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export const menuBoardService = new MenuBoardService();
