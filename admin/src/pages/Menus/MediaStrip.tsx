import { useState } from 'react';
import type { MediaEntityType } from '@menuboard/shared';
import { PlusIcon, StarIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MediaPicker } from '@/components/MediaPicker/MediaPicker';
import {
  useAssignMedia,
  useMediaForEntity,
  useSetPrimaryMedia,
  useUnassignMedia,
} from '@/hooks/useMedia';
import { notify } from '@/lib/notify';

/**
 * The image gallery for one Menu Master entity: existing assignments as thumbnails (the
 * first/primary one badged), a remove button per thumbnail, and one "+" tile that opens the
 * shared MediaPicker to attach another existing or newly uploaded asset.
 */
/** Thumbnail edge length. `sm` fits a dense row of form fields; `md` is the gallery default. */
const TILE_SIZE = { sm: 'size-10', md: 'size-16' } as const;
const BADGE_OFFSET = { sm: '-top-1 -left-1', md: '-top-1.5 -left-1.5' } as const;
const ADD_ICON_SIZE = { sm: 'size-3', md: 'size-4' } as const;

export function MediaStrip({
  entityType,
  entityId,
  onChanged,
  size = 'md',
}: {
  entityType: MediaEntityType;
  entityId: string;
  /** Called after any add/remove/primary change, for callers whose own lists show the image. */
  onChanged?: () => void;
  /** `sm` for a thumbnail sitting inline in a dense row (e.g. one variant's photo); `md` (the
   *  default) for a standalone gallery section with room to breathe. */
  size?: 'sm' | 'md';
}): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: assignments } = useMediaForEntity(entityType, entityId);
  const assign = useAssignMedia();
  const unassign = useUnassignMedia();
  const setPrimary = useSetPrimaryMedia();
  const tile = TILE_SIZE[size];
  const badgeOffset = BADGE_OFFSET[size];

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(assignments ?? []).map((assignment) => (
        <div key={assignment.id} className="group relative">
          <div className={`bg-muted ${tile} overflow-hidden rounded-md border`}>
            {assignment.media && (
              <img
                src={assignment.media.url}
                alt={assignment.media.altText ?? assignment.media.fileName}
                className="h-full w-full object-cover"
              />
            )}
          </div>
          {assignment.isPrimary ? (
            <Badge
              variant="secondary"
              className={`absolute ${badgeOffset} px-1 py-0 text-[9px] leading-tight`}
            >
              {size === 'sm' ? '★' : 'Primary'}
            </Badge>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className={`absolute ${badgeOffset} size-4 opacity-0 transition-opacity group-hover:opacity-100`}
                  onClick={async () => {
                    try {
                      await setPrimary.mutateAsync({ id: assignment.id, entityType, entityId });
                      onChanged?.();
                      notify.success('Primary image set.');
                    } catch (err) {
                      notify.fromError(err);
                    }
                  }}
                  aria-label="Make primary image"
                >
                  <StarIcon className="size-2.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Make primary — this is the thumbnail shown everywhere</TooltipContent>
            </Tooltip>
          )}
          <Button
            variant="destructive"
            size="icon-sm"
            className="absolute -top-1 -right-1 size-4 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={async () => {
              try {
                await unassign.mutateAsync({ id: assignment.id, entityType, entityId });
                onChanged?.();
                notify.success('Image removed.');
              } catch (err) {
                notify.fromError(err);
              }
            }}
            aria-label="Remove image"
          >
            <XIcon className="size-2.5" />
          </Button>
        </div>
      ))}

      <Button
        variant="outline"
        className={`text-muted-foreground ${tile} flex-col gap-0.5 p-0`}
        onClick={() => setPickerOpen(true)}
      >
        <PlusIcon className={ADD_ICON_SIZE[size]} />
        {size === 'md' && <span className="text-[10px]">Add</span>}
      </Button>

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={async (media) => {
          try {
            await assign.mutateAsync({ mediaId: media.id, entityType, entityId });
            onChanged?.();
            notify.success('Image added.');
          } catch (err) {
            notify.fromError(err);
          }
        }}
      />
    </div>
  );
}
