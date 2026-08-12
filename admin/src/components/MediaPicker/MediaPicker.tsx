import { useRef, useState } from 'react';
import type { MediaAssetDto } from '@menuboard/shared';
import { SearchIcon, UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/Modal/Modal';
import { useMediaLibrary, useUploadMedia } from '@/hooks/useMedia';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';

interface MediaPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (media: MediaAssetDto) => void;
}

export function MediaPicker({ open, onClose, onSelect }: MediaPickerProps): JSX.Element {
  const [search, setSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadMedia();
  const { data, isLoading } = useMediaLibrary({ search: search || undefined, page: 1, pageSize: 50 });

  async function onFileChosen(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notify.fromError(new Error('Choose an image file'));
      return;
    }
    try {
      await upload.mutateAsync({ file });
      notify.success('Image uploaded.');
    } catch (err) {
      notify.fromError(err);
    }
  }

  const items = data?.items ?? [];

  return (
    <Modal
      id="media-picker"
      title="Select media"
      open={open}
      onClose={onClose}
      minWidth={520}
      minHeight={420}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <InputGroup className="flex-1">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search media…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search media"
            />
          </InputGroup>
          <Button
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={upload.isPending}
          >
            <UploadIcon data-icon="inline-start" />
            Upload
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFileChosen}
          />
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {isLoading && (
            <div className="flex h-48 items-center justify-center">
              <Spinner className="size-6" />
            </div>
          )}

          {!isLoading && items.length === 0 && (
            <EmptyState
              title="No media found"
              description="Upload an image to get started."
              variant="no-results"
              className="py-10"
            />
          )}

          {!isLoading && items.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3 p-0.5">
              {items.map((media) => (
                <button
                  key={media.id}
                  type="button"
                  onClick={() => {
                    onSelect(media);
                    onClose();
                  }}
                  className="focus-ring group flex flex-col gap-1.5 rounded-lg text-left"
                >
                  <div className="bg-muted aspect-square overflow-hidden rounded-lg border">
                    <img
                      src={media.url}
                      alt={media.altText ?? media.fileName}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  </div>
                  <span
                    className={cn(
                      'text-muted-foreground truncate text-xs',
                      media.title && 'text-foreground',
                    )}
                  >
                    {media.title || media.fileName}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
