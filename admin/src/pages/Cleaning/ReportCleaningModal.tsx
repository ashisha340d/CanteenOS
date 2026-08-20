import { useState } from 'react';
import {
  CLEANING_REPORTABLE_EVENTS,
  CLEANING_TRIGGER_EVENT_LABELS,
  CleaningTaskPriority,
  CleaningTriggerEvent,
  LIMITS,
  type CleaningReportResultDto,
} from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldGroup, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { notify } from '@/lib/notify';
import { readError } from '../../services/errorMessage';
import { useCleanableAssets, useCleaningSetup, useReportCleaning } from '../../hooks/useCleaning';
import { enumOptions } from '@/lib/options';

const FORM_ID = 'report-cleaning-form';

/**
 * "This needs cleaning."
 *
 * The whole form is a place, a sentence and a send button. Naming an area is enough — the
 * server resolves it to that area's general cleanable asset — because the person who has just
 * found the mess is the person least likely to know what the asset register calls it.
 *
 * The result is shown rather than swallowed: the reporter is told what was raised and who has
 * it, so reporting visibly does something.
 */
export function ReportCleaningModal({
  open,
  onClose,
  /** Pre-selects the thing being reported, when the report starts from an asset's own page. */
  cleanableAssetId,
}: {
  open: boolean;
  onClose: () => void;
  cleanableAssetId?: string;
}): JSX.Element {
  const [areaId, setAreaId] = useState('');
  const [assetId, setAssetId] = useState(cleanableAssetId ?? '');
  const [eventType, setEventType] = useState<string>(CleaningTriggerEvent.MANUAL_TRIGGER);
  const [priority, setPriority] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CleaningReportResultDto | null>(null);

  const { data: setup } = useCleaningSetup();
  // Narrowed to the chosen area so the picker is a short list of real things, not the estate.
  const { data: assets } = useCleanableAssets(
    areaId === '' ? { pageSize: 100 } : { areaId, pageSize: 200 },
  );
  const report = useReportCleaning();

  function reset(): void {
    setAreaId('');
    setAssetId(cleanableAssetId ?? '');
    setEventType(CleaningTriggerEvent.MANUAL_TRIGGER);
    setPriority('');
    setNote('');
    setError(null);
    setResult(null);
  }

  function close(): void {
    reset();
    onClose();
  }

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (areaId === '' && assetId === '') {
      setError('Choose the area, or the exact thing that needs cleaning.');
      return;
    }
    try {
      const outcome = await report.mutateAsync({
        eventType: eventType as CleaningTriggerEvent,
        ...(assetId !== '' ? { cleanableAssetId: assetId } : {}),
        ...(areaId !== '' ? { areaId } : {}),
        ...(priority !== '' ? { priority: priority as CleaningTaskPriority } : {}),
        ...(note.trim() !== '' ? { note: note.trim() } : {}),
      });
      setResult(outcome);
      notify.success(outcome.message);
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="report-cleaning"
      title="Report something that needs cleaning"
      description="Say where it is and what you found. Everything else is worked out for you."
      open={open}
      onClose={close}
      footer={
        result !== null ? (
          <Button type="button" onClick={close}>
            Done
          </Button>
        ) : (
          <FormModalFooter
            formId={FORM_ID}
            onCancel={close}
            submitting={report.isPending}
            saveLabel="Report it"
          />
        )
      }
    >
      {result !== null ? (
        <div className="space-y-3">
          <Alert>
            <AlertDescription>{result.message}</AlertDescription>
          </Alert>
          {result.tasks.map((task) => (
            <div key={task.id} className="bg-muted/40 rounded-md border p-3">
              <p className="text-sm font-medium">{task.taskName}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {task.locationPath} · {task.priority} ·{' '}
                {task.assignedToName ?? 'waiting for a supervisor'}
              </p>
            </div>
          ))}
          <button
            type="button"
            className="text-primary text-sm underline underline-offset-2"
            onClick={reset}
          >
            Report something else
          </button>
        </div>
      ) : (
        <form id={FORM_ID} onSubmit={onSubmit}>
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <SelectField
              label="Where"
              required
              value={areaId}
              onChange={(next) => {
                setAreaId(next);
                setAssetId('');
              }}
              emptyLabel="Choose an area"
              options={(setup?.areas ?? []).map((area) => ({
                value: area.id,
                label: area.floorName === null ? area.name : `${area.floorName} · ${area.name}`,
              }))}
            />

            <SelectField
              label="Exactly what (optional)"
              helperText="Leave this blank if it is the area itself — a floor, a wall, a corner."
              value={assetId}
              onChange={setAssetId}
              emptyLabel="The area in general"
              options={(assets?.items ?? []).map((asset) => ({
                value: asset.id,
                label: asset.name,
              }))}
            />

            <SelectField
              label="What happened"
              value={eventType}
              onChange={setEventType}
              options={CLEANING_REPORTABLE_EVENTS.map((value) => ({
                value,
                label: CLEANING_TRIGGER_EVENT_LABELS[value],
              }))}
            />

            <TextField
              label="What you found"
              multiline
              rows={3}
              placeholder="Oil spill by the fryer, floor is slippery"
              helperText="One sentence is enough. It becomes the name of the job."
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={LIMITS.CLEANING_EVENT_NOTE_MAX}
            />

            <SelectField
              label="Urgency (optional)"
              helperText="Only raises the priority the rule would give it — it never lowers it."
              value={priority}
              onChange={setPriority}
              emptyLabel="Let the system decide"
              options={enumOptions(CleaningTaskPriority)}
            />
          </FieldGroup>
        </form>
      )}
    </Modal>
  );
}
