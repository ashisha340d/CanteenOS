import { useState } from 'react';
import {
  EQUIPMENT_STATUS_LABELS,
  EquipmentStatus,
  LIMITS,
  type EquipmentDto,
} from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import {
  useChangeEquipmentStatus,
  useLocationTree,
  useMoveEquipment,
} from '../../hooks/useEquipment';
import { readError } from '../../services/errorMessage';
import { notify } from '@/lib/notify';

const STATUS_FORM_ID = 'equipment-status-form';
const MOVE_FORM_ID = 'equipment-move-form';

/**
 * Both of the asset's state changes that write history.
 *
 * They are separate from the edit form for exactly that reason: a status change records who
 * changed it, from what, and why, and a move records the location path as it read at the
 * time. An ordinary field edit records neither, so conflating them would leave the timeline
 * lying about what happened.
 */
export function EquipmentStatusModal({
  open,
  onClose,
  equipment,
}: {
  open: boolean;
  onClose: () => void;
  equipment: EquipmentDto;
}): JSX.Element {
  const [status, setStatus] = useState<EquipmentStatus>(equipment.status);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const change = useChangeEquipmentStatus();

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await change.mutateAsync({ id: equipment.id, body: { status, note: note || null } });
      notify.success(`${equipment.assetId} is now ${EQUIPMENT_STATUS_LABELS[status]}.`);
      setNote('');
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="equipment-status"
      title={`Change status — ${equipment.assetId}`}
      open={open}
      onClose={onClose}
      footer={
        <FormModalFooter
          formId={STATUS_FORM_ID}
          onCancel={onClose}
          submitting={change.isPending}
          saveLabel="Change status"
        />
      }
    >
      <form id={STATUS_FORM_ID} onSubmit={onSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <SelectField
            label="Status"
            required
            value={status}
            onChange={(next) => setStatus(next as EquipmentStatus)}
            options={Object.values(EquipmentStatus).map((value) => ({
              value,
              label: EQUIPMENT_STATUS_LABELS[value],
            }))}
            helperText="Set by people and by the maintenance workflow. No sensor writes this."
          />

          <TextField
            label="Note"
            multiline
            rows={2}
            placeholder="Why it changed — read on the asset's timeline"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={LIMITS.EQUIPMENT_STATUS_NOTE_MAX}
          />

          {status === EquipmentStatus.RETIRED && (
            <Alert>
              <AlertDescription>
                Retiring keeps the record and its whole history but takes the asset off the
                register. This is the normal end of life — deleting is not.
              </AlertDescription>
            </Alert>
          )}
        </FieldGroup>
      </form>
    </Modal>
  );
}

export function EquipmentMoveModal({
  open,
  onClose,
  equipment,
}: {
  open: boolean;
  onClose: () => void;
  equipment: EquipmentDto;
}): JSX.Element {
  const [locationId, setLocationId] = useState(equipment.locationId ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data: tree } = useLocationTree();
  const move = useMoveEquipment();

  const options = (tree?.floors ?? []).flatMap((floor) =>
    floor.areas.flatMap((area) =>
      area.locations.map((location) => ({
        value: location.id,
        label: `${floor.name} · ${area.name} · ${location.name}`,
      })),
    ),
  );

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (locationId === '') {
      setError('Choose where it went.');
      return;
    }
    try {
      await move.mutateAsync({ id: equipment.id, body: { locationId, note: note || null } });
      notify.success('Location updated.');
      setNote('');
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="equipment-move"
      title={`Move — ${equipment.assetId}`}
      open={open}
      onClose={onClose}
      footer={
        <FormModalFooter
          formId={MOVE_FORM_ID}
          onCancel={onClose}
          submitting={move.isPending}
          saveLabel="Move"
        />
      }
    >
      <form id={MOVE_FORM_ID} onSubmit={onSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <p className="text-muted-foreground text-sm">
            Currently at {equipment.locationPath ?? 'no recorded location'}.
          </p>

          <SelectField
            label="New location"
            required
            value={locationId}
            onChange={setLocationId}
            placeholder="Choose a location"
            options={options}
          />

          <TextField
            label="Note"
            multiline
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={LIMITS.EQUIPMENT_STATUS_NOTE_MAX}
          />
        </FieldGroup>
      </form>
    </Modal>
  );
}
