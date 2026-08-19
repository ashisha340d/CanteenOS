import fs from 'node:fs';
import type { Request, Response } from 'express';
import type {
  CreateMenuBoardScreenRequest,
  UpdateMenuBoardScreenRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { mediaAssetRepository, mediaAssignmentRepository } from '../repositories/MediaRepository';
import { menuBoardService } from '../services/MenuBoardService';
import { NotFoundError } from '../utils/errors';
import { resolveMediaPath } from '../utils/mediaStorage';
import { created, noContent, ok } from '../utils/http';
import { actorFrom } from './context';

/**
 * The Digital Menu Board.
 *
 * Split into a public half a wall screen reads and an authenticated half the Admin Portal
 * writes. The public half is deliberately tiny — a snapshot, its revision, and the photographs
 * that snapshot names — because it is reachable by anyone who can reach the network the screen
 * is on, and every endpoint on it is one more thing that has to be safe in that setting.
 */
export const MenuBoardController = {
  /* -------------------------------------------------------------------- public: a screen */

  async snapshot(req: Request, res: Response): Promise<void> {
    const screen = typeof req.query.screen === 'string' ? req.query.screen : null;
    ok(res, await menuBoardService.snapshot(screen, req.query.preview === '1'));
  },

  async revision(req: Request, res: Response): Promise<void> {
    const screen = typeof req.query.screen === 'string' ? req.query.screen : null;
    ok(res, { revision: await menuBoardService.revision(screen) });
  },

  /**
   * Menu photography, unsigned.
   *
   * Every other route to these bytes carries a time-limited signature naming the user it was
   * issued to. A menu board has no user and holds one page open for days, so a signature would
   * only guarantee that the photographs blank themselves overnight. What replaces it is a
   * narrower question: is this asset menu photography at all? An id that is not currently
   * assigned to something in the menu hierarchy is refused, so this route can reach the dish
   * photos on the wall and nothing else in the library — not a recipe, not an equipment fault
   * photo, not a document.
   *
   * The bytes it does serve are the same ones printed on the menu above the counter, which is
   * to say already public to everyone in the room.
   */
  async media(req: Request, res: Response): Promise<void> {
    const mediaId = req.params.id as string;
    const pool = getPool();

    if (!(await mediaAssignmentRepository.isAssignedToMenuEntity(pool, mediaId))) {
      throw new NotFoundError('Menu media', mediaId);
    }

    const asset = await mediaAssetRepository.findById(pool, mediaId);
    if (asset === null) throw new NotFoundError('Media asset', mediaId);

    const absolutePath = resolveMediaPath(asset.storage_path);
    if (!fs.existsSync(absolutePath)) throw new NotFoundError('Media file', mediaId);

    res.setHeader('Content-Type', asset.mime_type);
    res.setHeader('Content-Length', String(asset.size_bytes));
    // A media asset is immutable — an edited photograph is a new row with a new id — so this
    // can be cached hard. Without it the board re-fetches every photograph on every redraw and
    // shows empty frames while they come back over the wire.
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(asset.file_name)}"`,
    );
    fs.createReadStream(absolutePath).pipe(res);
  },

  /* ------------------------------------------------------------ admin: the screen registry */

  async listScreens(_req: Request, res: Response): Promise<void> {
    ok(res, await menuBoardService.listScreens());
  },

  async getScreen(req: Request, res: Response): Promise<void> {
    ok(res, await menuBoardService.getScreen(req.params.id as string));
  },

  async createScreen(req: Request, res: Response): Promise<void> {
    created(
      res,
      await menuBoardService.createScreen(
        req.body as CreateMenuBoardScreenRequest,
        actorFrom(req),
      ),
    );
  },

  async updateScreen(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await menuBoardService.updateScreen(
        req.params.id as string,
        req.body as UpdateMenuBoardScreenRequest,
        actorFrom(req),
      ),
    );
  },

  async deleteScreen(req: Request, res: Response): Promise<void> {
    await menuBoardService.deleteScreen(req.params.id as string, actorFrom(req));
    noContent(res);
  },
};
