import type { Request, Response } from 'express';
import { Capability } from '@menuboard/shared';
import type {
  DocumentExtractionDto,
  EquipmentCategoryWriteRequest,
  EquipmentCreateRequest,
  EquipmentDocumentType,
  EquipmentListQuery,
  EquipmentMoveRequest,
  EquipmentStatusChangeRequest,
  EquipmentSupplierRole,
  EquipmentUpdateRequest,
  FloorPlanPositionWriteRequest,
  MasterStatus,
  ProblemClassifyRequest,
} from '@menuboard/shared';
import { equipmentAiService } from '../services/EquipmentAiService';
import { equipmentService } from '../services/EquipmentService';
import { floorPlanService } from '../services/FloorPlanService';
import { requireAuth } from '../middleware/types';
import { ValidationError } from '../utils/errors';
import { created, noContent, ok, paginated } from '../utils/http';
import { actorFrom } from './context';
import type { DetailScope } from '../services/EquipmentService';

/**
 * How much of an asset this caller may see. The two single-machine reads serve both a monitor
 * and a reporter; the reporter gets the machine's identity and its open problems and nothing
 * else, decided here rather than left to the client to hide.
 */
function detailScope(req: Request): DetailScope {
  return requireAuth(req).capabilities.includes(Capability.EQUIPMENT_VIEW) ? 'FULL' : 'REPORTER';
}

/**
 * Equipment, its location/category masters, its documents and warranties, the floor plans it
 * is pinned on, and the AI drafts offered while registering it.
 *
 * Every response that carries a file is built for the *viewing* user, because media URLs are
 * signed per user and expire — which is why the user id is threaded through rather than
 * resolved inside the mappers.
 */
export const EquipmentController = {
  /* ------------------------------------------------------------------ masters */

  async listFloors(req: Request, res: Response): Promise<void> {
    const { includeInactive } = req.query as unknown as { includeInactive?: boolean };
    ok(res, await equipmentService.listFloors(includeInactive === true));
  },

  async createFloor(req: Request, res: Response): Promise<void> {
    created(
      res,
      await equipmentService.createFloor(
        req.body as { code: string; name: string; levelIndex?: number },
        actorFrom(req),
      ),
    );
  },

  async updateFloor(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await equipmentService.updateFloor(
        req.params.id as string,
        req.body as { code?: string; name?: string; levelIndex?: number; status?: MasterStatus },
        actorFrom(req),
      ),
    );
  },

  async listAreas(req: Request, res: Response): Promise<void> {
    const { floorId, includeInactive } = req.query as unknown as {
      floorId?: string;
      includeInactive?: boolean;
    };
    ok(res, await equipmentService.listAreas(floorId, includeInactive === true));
  },

  async createArea(req: Request, res: Response): Promise<void> {
    created(
      res,
      await equipmentService.createArea(
        req.body as {
          floorId: string;
          code: string;
          name: string;
          assetSegment: string;
          sortOrder?: number;
        },
        actorFrom(req),
      ),
    );
  },

  async updateArea(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await equipmentService.updateArea(
        req.params.id as string,
        req.body as Record<string, never>,
        actorFrom(req),
      ),
    );
  },

  async listLocations(req: Request, res: Response): Promise<void> {
    const { areaId, floorId, includeInactive } = req.query as unknown as {
      areaId?: string;
      floorId?: string;
      includeInactive?: boolean;
    };
    ok(
      res,
      await equipmentService.listLocations({
        ...(areaId !== undefined ? { areaId } : {}),
        ...(floorId !== undefined ? { floorId } : {}),
        includeInactive: includeInactive === true,
      }),
    );
  },

  async createLocation(req: Request, res: Response): Promise<void> {
    created(
      res,
      await equipmentService.createLocation(
        req.body as { areaId: string; name: string },
        actorFrom(req),
      ),
    );
  },

  async updateLocation(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await equipmentService.updateLocation(
        req.params.id as string,
        req.body as Record<string, never>,
        actorFrom(req),
      ),
    );
  },

  async locationTree(req: Request, res: Response): Promise<void> {
    const { includeInactive } = req.query as unknown as { includeInactive?: boolean };
    ok(res, await equipmentService.locationTree(includeInactive === true));
  },

  async listCategories(req: Request, res: Response): Promise<void> {
    const { includeInactive } = req.query as unknown as { includeInactive?: boolean };
    ok(res, await equipmentService.listCategories(includeInactive === true));
  },

  async createCategory(req: Request, res: Response): Promise<void> {
    created(
      res,
      await equipmentService.createCategory(
        req.body as EquipmentCategoryWriteRequest,
        actorFrom(req),
      ),
    );
  },

  async updateCategory(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await equipmentService.updateCategory(
        req.params.id as string,
        req.body as Partial<EquipmentCategoryWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async removeCategory(req: Request, res: Response): Promise<void> {
    await equipmentService.removeCategory(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /* ---------------------------------------------------------------- equipment */

  async dashboard(req: Request, res: Response): Promise<void> {
    ok(res, await equipmentService.dashboard(requireAuth(req).userId));
  },

  async list(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await equipmentService.list(
        req.query as unknown as EquipmentListQuery,
        requireAuth(req).userId,
      ),
    );
  },

  async resolve(req: Request, res: Response): Promise<void> {
    const { code } = req.query as unknown as { code: string };
    const auth = requireAuth(req);
    ok(res, await equipmentService.resolve(code, auth.userId, detailScope(req)));
  },

  async getById(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    ok(res, await equipmentService.getById(req.params.id as string, auth.userId, detailScope(req)));
  },

  async create(req: Request, res: Response): Promise<void> {
    created(
      res,
      await equipmentService.create(req.body as EquipmentCreateRequest, actorFrom(req)),
    );
  },

  async update(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await equipmentService.update(
        req.params.id as string,
        req.body as EquipmentUpdateRequest,
        actorFrom(req),
      ),
    );
  },

  async remove(req: Request, res: Response): Promise<void> {
    await equipmentService.remove(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  async changeStatus(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await equipmentService.changeStatus(
        req.params.id as string,
        req.body as EquipmentStatusChangeRequest,
        actorFrom(req),
      ),
    );
  },

  async move(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await equipmentService.move(
        req.params.id as string,
        req.body as EquipmentMoveRequest,
        actorFrom(req),
      ),
    );
  },

  async statusHistory(req: Request, res: Response): Promise<void> {
    ok(res, await equipmentService.listStatusHistory(req.params.id as string));
  },

  async locationHistory(req: Request, res: Response): Promise<void> {
    ok(res, await equipmentService.listLocationHistory(req.params.id as string));
  },

  async activity(req: Request, res: Response): Promise<void> {
    ok(res, await equipmentService.listActivities(req.params.id as string));
  },

  /* ---------------------------------------------------------------- documents */

  async listDocuments(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await equipmentService.listDocuments(req.params.id as string, requireAuth(req).userId),
    );
  },

  async addDocument(req: Request, res: Response): Promise<void> {
    created(
      res,
      await equipmentService.addDocument(
        req.params.id as string,
        req.body as {
          mediaId: string;
          docType?: EquipmentDocumentType;
          title?: string | null;
          extracted?: DocumentExtractionDto | null;
          applyWarranty?: boolean;
        },
        actorFrom(req),
      ),
    );
  },

  async removeDocument(req: Request, res: Response): Promise<void> {
    await equipmentService.removeDocument(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /* --------------------------------------------------------------- warranties */

  async listWarranties(req: Request, res: Response): Promise<void> {
    ok(res, await equipmentService.listWarranties(req.params.id as string));
  },

  async addWarranty(req: Request, res: Response): Promise<void> {
    created(
      res,
      await equipmentService.addWarranty(
        req.params.id as string,
        req.body as { expiryDate?: string | null },
        actorFrom(req),
      ),
    );
  },

  /* ----------------------------------------------------------- supplier links */

  async listSupplierLinks(req: Request, res: Response): Promise<void> {
    ok(res, await equipmentService.listSupplierLinks(req.params.id as string));
  },

  async setSupplierLink(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await equipmentService.setSupplierLink(
        req.params.id as string,
        req.body as { supplierId: string; role: EquipmentSupplierRole; isDefault?: boolean },
        actorFrom(req),
      ),
    );
  },

  async removeSupplierLink(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await equipmentService.removeSupplierLink(
        req.params.id as string,
        req.params.role as EquipmentSupplierRole,
        actorFrom(req),
      ),
    );
  },

  /* -------------------------------------------------------------------- media */

  async uploadMedia(req: Request, res: Response): Promise<void> {
    if (req.file === undefined) {
      throw new ValidationError('No file was uploaded', [
        { path: 'file', message: 'Attach a file under the "file" field' },
      ]);
    }
    const { title } = req.query as unknown as { title?: string };
    created(
      res,
      await equipmentService.uploadMedia(
        {
          tempPath: req.file.path,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          title: title ?? null,
        },
        actorFrom(req),
      ),
    );
  },

  /* ----------------------------------------------------------------------- AI */

  async identify(req: Request, res: Response): Promise<void> {
    const { mediaId } = req.body as { mediaId: string };
    ok(res, await equipmentAiService.identifyFromPhoto(mediaId, requireAuth(req).userId));
  },

  async scanDocument(req: Request, res: Response): Promise<void> {
    const { mediaId, docType } = req.body as { mediaId: string; docType: EquipmentDocumentType };
    ok(res, await equipmentAiService.extractDocument(mediaId, docType, requireAuth(req).userId));
  },

  async classifyProblem(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await equipmentAiService.classifyProblem(
        req.body as ProblemClassifyRequest,
        requireAuth(req).userId,
      ),
    );
  },

  /* ---------------------------------------------------------------- floor plans */

  async listFloorPlans(req: Request, res: Response): Promise<void> {
    const { floorId } = req.query as unknown as { floorId?: string };
    ok(res, await floorPlanService.list(floorId, requireAuth(req).userId));
  },

  async floorPlanView(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await floorPlanService.view(req.params.floorId as string, requireAuth(req).userId),
    );
  },

  async createFloorPlan(req: Request, res: Response): Promise<void> {
    created(
      res,
      await floorPlanService.upload(
        req.body as { floorId: string; name: string; mediaId: string },
        actorFrom(req),
      ),
    );
  },

  async updateFloorPlan(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await floorPlanService.update(
        req.params.id as string,
        req.body as { name?: string; isActive?: boolean },
        actorFrom(req),
      ),
    );
  },

  async removeFloorPlan(req: Request, res: Response): Promise<void> {
    await floorPlanService.remove(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  async setFloorPlanPosition(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await floorPlanService.setPosition(
        req.params.id as string,
        req.body as FloorPlanPositionWriteRequest,
        actorFrom(req),
      ),
    );
  },

  async removeFloorPlanPosition(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await floorPlanService.removePosition(
        req.params.id as string,
        req.params.equipmentId as string,
        actorFrom(req),
      ),
    );
  },
};
