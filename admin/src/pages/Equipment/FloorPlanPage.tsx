import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capability, EQUIPMENT_STATUS_LABELS, type EquipmentStatus } from '@menuboard/shared';
import { UploadIcon, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { SelectField } from '@/components/form/fields';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '../../services/AuthContext';
import {
  useCreateFloorPlan,
  useEquipmentFloors,
  useFloorPlanView,
  useRemoveFloorPlanPosition,
  useSetFloorPlanPosition,
  useUploadEquipmentMedia,
} from '../../hooks/useEquipment';
import { notify } from '@/lib/notify';
import { TONE_DOT_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { EQUIPMENT_STATUS_TONE } from './equipmentTone';

/**
 * The floor plan: an uploaded image with equipment pinned onto it.
 *
 * Pins are stored as fractions of the image (0..1), never pixels, so the same plan renders
 * correctly here, on a phone, and after somebody re-uploads it at a different resolution.
 * Placing works by picking an unplaced asset and clicking where it stands.
 */
export function FloorPlanPage(): JSX.Element {
  const navigate = useNavigate();
  const { hasCapability } = useAuth();
  const canManage = hasCapability(Capability.EQUIPMENT_MANAGE_FLOORPLAN);

  const [floorId, setFloorId] = useState('');
  const [placing, setPlacing] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const { data: floors } = useEquipmentFloors();
  const { data: view, isLoading } = useFloorPlanView(floorId === '' ? undefined : floorId);
  const upload = useUploadEquipmentMedia();
  const createPlan = useCreateFloorPlan();
  const setPosition = useSetFloorPlanPosition();
  const removePosition = useRemoveFloorPlanPosition();

  // The first floor is almost always the one being looked at; making the operator choose it
  // before anything renders would be a page that starts empty for no reason.
  useEffect(() => {
    if (floorId === '' && floors !== undefined && floors.length > 0) {
      setFloorId(floors[0]?.id ?? '');
    }
  }, [floors, floorId]);

  async function onUploadPlan(file: File): Promise<void> {
    if (floorId === '') return;
    try {
      const media = await upload.mutateAsync({ file, title: file.name });
      await createPlan.mutateAsync({
        floorId,
        name: file.name.replace(/\.[^.]+$/, ''),
        mediaId: media.id,
      });
      notify.success('Floor plan uploaded.');
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function onPlaceAt(event: React.MouseEvent<HTMLImageElement>): Promise<void> {
    if (placing === null || view === null || view === undefined || imageRef.current === null) return;
    const bounds = imageRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));

    try {
      await setPosition.mutateAsync({
        id: view.plan.id,
        body: { equipmentId: placing, x: Number(x.toFixed(5)), y: Number(y.toFixed(5)) },
      });
      setPlacing(null);
      notify.success('Placed on the plan.');
    } catch (err) {
      notify.fromError(err);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Equipment"
        title="Floor plan"
        subtitle="Where each machine physically stands. Click a pin to open its profile."
        actions={
          canManage && floorId !== '' ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void onUploadPlan(file);
                }}
              />
              <Button
                variant="outline"
                disabled={upload.isPending || createPlan.isPending}
                onClick={() => fileRef.current?.click()}
              >
                {upload.isPending || createPlan.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <UploadIcon data-icon="inline-start" />
                )}
                {view === null || view === undefined ? 'Upload a plan' : 'Replace plan'}
              </Button>
            </>
          ) : null
        }
      />

      <div className="mb-4 max-w-xs">
        <SelectField
          label="Floor"
          value={floorId}
          onChange={(next) => {
            setFloorId(next);
            setPlacing(null);
          }}
          placeholder="Choose a floor"
          options={(floors ?? []).map((floor) => ({ value: floor.id, label: floor.name }))}
        />
      </div>

      {isLoading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner className="size-4" /> Loading the plan…
        </div>
      ) : view === null || view === undefined ? (
        <EmptyState
          title="No plan for this floor"
          description="Upload a layout image and pin the equipment onto it. Coordinates are stored as fractions, so replacing the image later keeps every pin where it was."
          {...(canManage ? { action: { label: 'Upload a plan', onClick: () => fileRef.current?.click() } } : {})}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
          <div className="bg-card relative overflow-hidden rounded-xl border">
            <img
              ref={imageRef}
              src={view.plan.url}
              alt={view.plan.name}
              className={cn('block w-full', placing !== null && 'cursor-crosshair')}
              onClick={(event) => void onPlaceAt(event)}
            />
            {view.positions.map((position) => (
              <button
                key={position.id}
                type="button"
                onClick={() => navigate(`/equipment/assets/${position.equipmentId}`)}
                title={`${position.assetId} · ${position.equipmentName}`}
                style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }}
                className="focus-ring absolute -translate-x-1/2 -translate-y-1/2"
              >
                <span
                  className={cn(
                    'ring-background block size-4 rounded-full ring-2',
                    TONE_DOT_CLASS[
                      EQUIPMENT_STATUS_TONE[(position.status ?? 'OPERATIONAL') as EquipmentStatus]
                    ],
                    (position.openTicketCount ?? 0) > 0 && 'motion-safe:animate-pulse',
                  )}
                />
                <span className="bg-card/90 pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 rounded border px-1 py-0.5 text-[10px] whitespace-nowrap">
                  {position.assetId}
                </span>
              </button>
            ))}
          </div>

          <aside className="space-y-4">
            {placing !== null && (
              <div className="bg-card flex items-center gap-2 rounded-xl border p-3 text-sm">
                <span className="min-w-0 flex-1">Click the plan to place it.</span>
                <Button variant="ghost" size="icon-sm" onClick={() => setPlacing(null)} aria-label="Cancel">
                  <XIcon />
                </Button>
              </div>
            )}

            <section className="bg-card rounded-xl border p-3">
              <h2 className="font-heading mb-2 text-sm font-semibold">
                Not placed ({view.unplaced.length})
              </h2>
              {view.unplaced.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  Every asset on this floor is on the plan.
                </p>
              ) : (
                <ul className="space-y-1">
                  {view.unplaced.map((asset) => (
                    <li key={asset.id}>
                      <button
                        type="button"
                        disabled={!canManage}
                        onClick={() => setPlacing(asset.id)}
                        className={cn(
                          'focus-ring flex w-full items-center gap-2 rounded-md p-1.5 text-left text-sm',
                          canManage ? 'hover:bg-accent/60' : 'cursor-default',
                          placing === asset.id && 'bg-accent',
                        )}
                      >
                        <span
                          className={cn(
                            'size-2 shrink-0 rounded-full',
                            TONE_DOT_CLASS[EQUIPMENT_STATUS_TONE[asset.status]],
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">{asset.name}</span>
                        <span className="text-muted-foreground font-mono text-[10px]">
                          {asset.assetId}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="bg-card rounded-xl border p-3">
              <h2 className="font-heading mb-2 text-sm font-semibold">On the plan</h2>
              <ul className="space-y-1">
                {view.positions.map((position) => (
                  <li key={position.id} className="flex items-center gap-2 text-sm">
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        TONE_DOT_CLASS[
                          EQUIPMENT_STATUS_TONE[
                            (position.status ?? 'OPERATIONAL') as EquipmentStatus
                          ]
                        ],
                      )}
                    />
                    <button
                      type="button"
                      className="focus-ring min-w-0 flex-1 truncate text-left hover:underline"
                      onClick={() => navigate(`/equipment/assets/${position.equipmentId}`)}
                    >
                      {position.equipmentName}
                    </button>
                    {(position.openTicketCount ?? 0) > 0 && (
                      <Badge variant="destructive">{position.openTicketCount}</Badge>
                    )}
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${position.equipmentName ?? 'pin'}`}
                        onClick={() => {
                          removePosition
                            .mutateAsync({ id: view.plan.id, equipmentId: position.equipmentId })
                            .then(() => notify.success('Pin removed.'))
                            .catch((err: unknown) => notify.fromError(err));
                        }}
                      >
                        <XIcon />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <p className="text-muted-foreground text-xs">
              A pulsing pin means the asset has an open problem. Colours follow the same status
              tones as the rest of the module — {EQUIPMENT_STATUS_LABELS.OUT_OF_SERVICE} is red.
            </p>
          </aside>
        </div>
      )}
    </>
  );
}
