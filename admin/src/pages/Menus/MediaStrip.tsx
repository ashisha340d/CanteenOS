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
export function MediaStrip({
  entityType,
  entityId,
  onChanged,
}: {
  entityType: MediaEntityType;
  entityId: string;
  /** Called after any add/remove/primary change, for callers whose own lists show the image. */
  onChanged?: () => void;
}): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: assignments } = useMediaForEntity(entityType, entityId);
  const assign = useAssignMedia();
  const unassign = useUnassignMedia();
  const setPrimary = useSetPrimaryMedia();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(assignments ?? []).map((assignment) => (
        <div key={assignment.id} className="group relative">
          <div className="bg-muted size-16 overflow-hidden rounded-md border">
            {assignment.media && (
              <img
                src={assignment.media.url}
                alt={assignment.media.altText ?? assignment.media.fileName}
                className="h-full w-full object-cover"
              />
            )}
          </div>
          {assignment.isPrimary ? (
            <Badge variant="secondary" className="absolute -top-1.5 -left-1.5 px-1 py-0 text-[10px]">
              Primary
            </Badge>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="absolute -top-1.5 -left-1.5 size-5 opacity-0 transition-opacity group-hover:opacity-100"
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
                  <StarIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Make primary — this is the thumbnail shown everywhere</TooltipContent>
            </Tooltip>
          )}
          <Button
            variant="destructive"
            size="icon-sm"
            className="absolute -top-1.5 -right-1.5 size-5 opacity-0 transition-opacity group-hover:opacity-100"
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
            <XIcon />
          </Button>
        </div>
      ))}

      <Button
        variant="outline"
        className="text-muted-foreground size-16 flex-col gap-0.5"
        onClick={() => setPickerOpen(true)}
      >
        <PlusIcon className="size-4" />
        <span className="text-[10px]">Add</span>
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
