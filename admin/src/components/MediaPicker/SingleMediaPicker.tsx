import { useState } from 'react';
import type { MediaEntityType } from '@menuboard/shared';
import { PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MediaPicker } from '@/components/MediaPicker/MediaPicker';
import { useAssignMedia, useMediaForEntity, useUnassignMedia } from '@/hooks/useMedia';
import { notify } from '@/lib/notify';

export function SingleMediaPicker({
  entityType,
  entityId,
}: {
  entityType: MediaEntityType;
  entityId: string;
}): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: assignments } = useMediaForEntity(entityType, entityId);
  const assign = useAssignMedia();
  const unassign = useUnassignMedia();
  const current = (assignments ?? [])[0];

  async function replace(mediaId: string): Promise<void> {
    try {
      if (current) await unassign.mutateAsync({ id: current.id, entityType, entityId });
      await assign.mutateAsync({ mediaId, entityType, entityId, isPrimary: true });
      notify.success('Image saved.');
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function remove(): Promise<void> {
    if (!current) return;
    try {
      await unassign.mutateAsync({ id: current.id, entityType, entityId });
      notify.success('Image removed.');
    } catch (err) {
      notify.fromError(err);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {current ? (
        <div className="group relative">
          <button
            type="button"
            className="focus-ring bg-muted size-16 overflow-hidden rounded-md border"
            onClick={() => setPickerOpen(true)}
            aria-label="Replace image"
          >
            {current.media && (
              <img
                src={current.media.url}
                alt={current.media.altText ?? current.media.fileName}
                className="h-full w-full object-cover"
              />
            )}
          </button>
          <Button
            variant="destructive"
            size="icon-sm"
            className="absolute -top-1.5 -right-1.5 size-5 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={() => void remove()}
            aria-label="Remove image"
          >
            <XIcon />
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          className="text-muted-foreground size-16 flex-col gap-0.5"
          onClick={() => setPickerOpen(true)}
        >
          <PlusIcon className="size-4" />
          <span className="text-[10px]">Add</span>
        </Button>
      )}

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(media) => void replace(media.id)}
      />
    </div>
  );
}
