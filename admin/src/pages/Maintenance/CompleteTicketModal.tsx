import { useRef, useState } from 'react';
import {
  LIMITS,
  MaintenanceAttachmentKind,
  type MaintenanceTicketDto,
} from '@menuboard/shared';
import { UploadIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { CheckboxField, FieldGroup, NumberField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { useCompleteTicket, useUploadEquipmentMedia } from '../../hooks/useEquipment';
import { readError } from '../../services/errorMessage';
import { notify } from '@/lib/notify';

const FORM_ID = 'complete-ticket-form';

/**
 * Finishing the job: a photo, optionally a word, and it is done.
 *
 * Restoring the equipment is on by default and only takes effect when no other ticket is
 * still open against the asset — two faults on one oven must not have the first fix declare
 * the oven fine.
 */
export function CompleteTicketModal({
  open,
  onClose,
  ticket,
}: {
  open: boolean;
  onClose: () => void;
  ticket: MaintenanceTicketDto;
}): JSX.Element {
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [partsReplaced, setPartsReplaced] = useState('');
  const [costAmount, setCostAmount] = useState('');
  const [restore, setRestore] = useState(true);
  const [photos, setPhotos] = useState<Array<{ mediaId: string; url: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const complete = useCompleteTicket();
  const upload = useUploadEquipmentMedia();

  async function onPickPhoto(file: File): Promise<void> {
    try {
      const media = await upload.mutateAsync({ file });
      setPhotos((current) => [...current, { mediaId: media.id, url: media.url }]);
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await complete.mutateAsync({
        id: ticket.id,
        body: {
          resolutionNotes: resolutionNotes || null,
          partsReplaced: partsReplaced || null,
          costAmount: costAmount === '' ? null : Number(costAmount),
          restoreEquipment: restore,
          attachments: photos.map((photo) => ({
            mediaId: photo.mediaId,
            kind: MaintenanceAttachmentKind.PHOTO,
          })),
        },
      });
      notify.success(`${ticket.ticketNumber} resolved.`);
      setPhotos([]);
      setResolutionNotes('');
      setPartsReplaced('');
      setCostAmount('');
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="complete-ticket"
      title={`Complete ${ticket.ticketNumber}`}
      open={open}
      onClose={onClose}
      footer={
        <FormModalFooter
          formId={FORM_ID}
          onCancel={onClose}
          submitting={complete.isPending}
          saveLabel="Mark resolved"
        />
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <TextField
            label="What was done"
            multiline
            rows={3}
            value={resolutionNotes}
            onChange={(event) => setResolutionNotes(event.target.value)}
            maxLength={LIMITS.MAINTENANCE_RESOLUTION_MAX}
          />

          <TextField
            label="Parts replaced"
            value={partsReplaced}
            onChange={(event) => setPartsReplaced(event.target.value)}
            maxLength={LIMITS.MAINTENANCE_PARTS_MAX}
          />

          <NumberField
            label="Cost"
            value={costAmount}
            onChange={(event) => setCostAmount(event.target.value)}
            min={0}
            step="0.01"
          />

          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void onPickPhoto(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={upload.isPending}
              onClick={() => fileRef.current?.click()}
            >
              {upload.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <UploadIcon data-icon="inline-start" />
              )}
              Attach a photo of the fix
            </Button>
            {photos.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {photos.map((photo) => (
                  <li key={photo.mediaId} className="bg-muted size-16 overflow-hidden rounded-md border">
                    <img src={photo.url} alt="" className="h-full w-full object-cover" />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <CheckboxField
            label="Put the equipment back in service"
            helperText="Only takes effect once no other ticket is open against this asset."
            checked={restore}
            onCheckedChange={setRestore}
          />
        </FieldGroup>
      </form>
    </Modal>
  );
}
