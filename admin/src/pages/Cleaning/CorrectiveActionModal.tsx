import { useState } from 'react';
import {
  CORRECTIVE_ACTION_STATUS_LABELS,
  CorrectiveActionStatus,
  LIMITS,
  type CleaningCorrectiveActionDto,
} from '@menuboard/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { notify } from '@/lib/notify';
import { readError } from '../../services/errorMessage';
import { usersApi } from '../../api/users';
import { useUpdateCorrectiveAction } from '../../hooks/useCleaning';
import { formatDateTime } from './cleaningTone';

const FORM_ID = 'corrective-action-form';

/**
 * Closing the loop on a failed hygiene check.
 *
 * The root cause and the corrective action are demanded before it can be closed — by the
 * server, not merely by this form. A corrective action closed without either records that
 * something went wrong and nothing was learned, which is the opposite of what it is for.
 */
export function CorrectiveActionModal({
  action,
  onClose,
}: {
  action: CleaningCorrectiveActionDto;
  onClose: () => void;
}): JSX.Element {
  const [rootCause, setRootCause] = useState(action.rootCause ?? '');
  const [correctiveAction, setCorrectiveAction] = useState(action.correctiveAction ?? '');
  const [preventiveAction, setPreventiveAction] = useState(action.preventiveAction ?? '');
  const [immediateAction, setImmediateAction] = useState(action.immediateAction ?? '');
  const [assignedTo, setAssignedTo] = useState(action.assignedToId ?? '');
  const [dueAt, setDueAt] = useState(action.dueAt === null ? '' : action.dueAt.slice(0, 16));
  const [status, setStatus] = useState<string>(action.status);
  const [closureNote, setClosureNote] = useState(action.closureNote ?? '');
  const [error, setError] = useState<string | null>(null);

  const update = useUpdateCorrectiveAction();
  const { data: users } = useQuery({
    queryKey: ['cleaning-corrective-assignees'],
    queryFn: () => usersApi.list({ page: 1, pageSize: 200 }),
  });

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await update.mutateAsync({
        id: action.id,
        body: {
          rootCause: rootCause.trim() === '' ? null : rootCause.trim(),
          correctiveAction: correctiveAction.trim() === '' ? null : correctiveAction.trim(),
          preventiveAction: preventiveAction.trim() === '' ? null : preventiveAction.trim(),
          immediateAction: immediateAction.trim() === '' ? null : immediateAction.trim(),
          assignedTo: assignedTo === '' ? null : assignedTo,
          dueAt: dueAt === '' ? null : new Date(dueAt).toISOString(),
          status: status as CorrectiveActionStatus,
          closureNote: closureNote.trim() === '' ? null : closureNote.trim(),
        },
      });
      notify.success('Corrective action saved.');
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="corrective-action"
      title="Corrective action"
      description={action.failureSummary}
      open
      onClose={onClose}
      minWidth={560}
      footer={
        <FormModalFooter formId={FORM_ID} onCancel={onClose} submitting={update.isPending} />
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="bg-muted/40 rounded-md border p-3 text-xs">
            <p>
              <span className="font-medium">{action.cleanableAssetName}</span> ·{' '}
              {action.areaName}
            </p>
            <p className="text-muted-foreground">
              Raised by {action.raisedByName ?? 'the system'} · {formatDateTime(action.createdAt)}
              {action.isOverdue && <span className="text-tone-danger font-medium"> · overdue</span>}
            </p>
          </div>

          <TextField
            label="What was done straight away"
            multiline
            rows={2}
            helperText="The immediate containment — before anybody worked out why."
            value={immediateAction}
            onChange={(event) => setImmediateAction(event.target.value)}
            maxLength={LIMITS.CLEANING_CORRECTIVE_ACTION_TEXT_MAX}
          />

          <TextField
            label="Root cause"
            multiline
            rows={2}
            required={status === CorrectiveActionStatus.CLOSED}
            helperText="Why it happened, not what happened. Required before this can be closed."
            value={rootCause}
            onChange={(event) => setRootCause(event.target.value)}
            maxLength={LIMITS.CLEANING_CORRECTIVE_ACTION_TEXT_MAX}
          />

          <TextField
            label="What was done about it"
            multiline
            rows={2}
            required={status === CorrectiveActionStatus.CLOSED}
            value={correctiveAction}
            onChange={(event) => setCorrectiveAction(event.target.value)}
            maxLength={LIMITS.CLEANING_CORRECTIVE_ACTION_TEXT_MAX}
          />

          <TextField
            label="What stops it happening again"
            multiline
            rows={2}
            helperText="The change to the procedure, the training, or the rule."
            value={preventiveAction}
            onChange={(event) => setPreventiveAction(event.target.value)}
            maxLength={LIMITS.CLEANING_CORRECTIVE_ACTION_TEXT_MAX}
          />

          <SelectField
            label="Owner"
            value={assignedTo}
            onChange={setAssignedTo}
            emptyLabel="Nobody"
            options={(users?.items ?? []).map((user) => ({ value: user.id, label: user.name }))}
          />

          <TextField
            label="Due by"
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />

          <SelectField
            label="Status"
            value={status}
            onChange={setStatus}
            options={Object.values(CorrectiveActionStatus).map((value) => ({
              value,
              label: CORRECTIVE_ACTION_STATUS_LABELS[value],
            }))}
          />

          <TextField
            label="Closing note"
            multiline
            rows={2}
            value={closureNote}
            onChange={(event) => setClosureNote(event.target.value)}
            maxLength={LIMITS.CLEANING_CORRECTIVE_CLOSURE_NOTE_MAX}
          />
        </FieldGroup>
      </form>
    </Modal>
  );
}
