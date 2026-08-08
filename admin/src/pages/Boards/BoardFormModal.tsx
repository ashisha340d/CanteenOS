import { useState } from 'react';
import { BoardStatus, LIMITS, MasterStatus, type BoardDto } from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { useCreateBoard, useUpdateBoard } from '../../hooks/useBoards';
import { useStations } from '../../hooks/useMasters';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';

const DEFAULT_COLOR = '#4F46E5';

interface FormValues {
  stationId: string;
  name: string;
  description: string;
  color: string;
  photoPath: string;
  status: BoardStatus;
}

const FORM_ID = 'board-form';

export function BoardFormModal({
  open,
  onClose,
  editing,
  defaultStationId,
}: {
  open: boolean;
  onClose: () => void;
  editing: BoardDto | null;
  /** Pre-selects a station — e.g. when creating a board from inside that station's page. */
  defaultStationId?: string;
}): JSX.Element {
  const modalId = `board-form-${editing?.id ?? 'new'}`;
  const initial: FormValues = editing
    ? {
      stationId: editing.stationId,
      name: editing.name,
      description: editing.description ?? '',
      color: editing.color ?? DEFAULT_COLOR,
      photoPath: editing.photoPath ?? '',
      status: editing.status,
    }
    : {
      stationId: defaultStationId ?? '',
      name: '',
      description: '',
      color: DEFAULT_COLOR,
      photoPath: '',
      status: BoardStatus.ACTIVE,
    };
  const { value, setValue, clear } = usePersistedFormState<FormValues>(modalId, initial, open);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateBoard();
  const update = useUpdateBoard();
  const submitting = create.isPending || update.isPending;

  // Every board must belong to exactly one station — the picker only offers active ones.
  const { data: stationPage } = useStations({ status: MasterStatus.ACTIVE, page: 1, pageSize: 100 });
  const stationOptions = (stationPage?.items ?? []).map((station) => ({
    value: station.id,
    label: station.name,
  }));

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      if (editing) {
        await update.mutateAsync({
          boardId: editing.id,
          body: {
            stationId: value.stationId,
            name: value.name,
            description: value.description || null,
            color: value.color || null,
            photoPath: value.photoPath || null,
            status: value.status,
          },
        });
      } else {
        await create.mutateAsync({
          stationId: value.stationId,
          name: value.name,
          description: value.description || null,
          color: value.color || null,
          photoPath: value.photoPath || null,
        });
      }
      clear();
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="board-form"
      title={editing ? `Edit board — ${editing.name}` : 'New board'}
      open={open}
      onClose={onClose}
      footer={<FormModalFooter formId={FORM_ID} onCancel={onClose} submitting={submitting} />}
    >
      <form onSubmit={onSubmit} id={FORM_ID}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <SelectField
            label="Station"
            helperText="The physical site this board operates at"
            required
            value={value.stationId}
            onChange={(v) => setValue({ ...value, stationId: v })}
            options={stationOptions}
            placeholder="Select a station"
          />
          <TextField
            label="Board name"
            autoFocus
            required
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            maxLength={LIMITS.BOARD_NAME_MAX}
          />
          <TextField
            label="Description"
            multiline
            rows={3}
            value={value.description}
            onChange={(e) => setValue({ ...value, description: e.target.value })}
            maxLength={LIMITS.BOARD_DESCRIPTION_MAX}
          />
          <div className="flex items-end gap-3">
            <TextField
              type="color"
              label="Color"
              helperText="Shown on this board's card in the Android app"
              value={value.color}
              onChange={(e) => setValue({ ...value, color: e.target.value })}
              className="w-20 shrink-0"
            />
            <TextField
              label="Photo path"
              helperText="Storage path of an uploaded board photo, shown alongside the color"
              value={value.photoPath}
              onChange={(e) => setValue({ ...value, photoPath: e.target.value })}
              maxLength={LIMITS.BOARD_PHOTO_PATH_MAX}
              className="flex-1"
            />
          </div>
          {editing && (
            <SelectField
              label="Status"
              value={value.status}
              onChange={(v) => setValue({ ...value, status: v as BoardStatus })}
              options={enumOptions(BoardStatus)}
            />
          )}
        </FieldGroup>
      </form>
    </Modal>
  );
}
