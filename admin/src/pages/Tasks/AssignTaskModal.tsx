import { useState } from 'react';
import { LIMITS, TaskKind, TaskPriority, type UserDto } from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, NumberField, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { useCreateTask } from '../../hooks/useTasks';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';

const FORM_ID = 'assign-task-form';

/**
 * Hands a task to a volunteer.
 *
 * There is no deadline field, and that is deliberate: a task's only real deadline comes from
 * the order behind it. Inventing one here would put a red time on the volunteer's screen that
 * nothing in the kitchen actually requires.
 */
export function AssignTaskModal({
  open,
  onClose,
  users,
}: {
  open: boolean;
  onClose: () => void;
  users: UserDto[];
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [priority, setPriority] = useState<TaskPriority>(TaskPriority.NORMAL);
  const [kind, setKind] = useState<TaskKind>(TaskKind.WORK);
  const [minutes, setMinutes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateTask();

  function reset(): void {
    setTitle('');
    setDescription('');
    setAssignedTo('');
    setPriority(TaskPriority.NORMAL);
    setKind(TaskKind.WORK);
    setMinutes('');
    setError(null);
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (assignedTo === '') {
      setError('Choose who this is for.');
      return;
    }
    const estimate = Number(minutes);
    try {
      await create.mutateAsync({
        title,
        description: description || null,
        assignedTo,
        priority,
        kind,
        estimatedMinutes: minutes !== '' && Number.isFinite(estimate) ? estimate : null,
      });
      notify.success('Task assigned.');
      reset();
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="assign-task"
      title="Assign a task"
      open={open}
      onClose={onClose}
      footer={<FormModalFooter formId={FORM_ID} onCancel={onClose} submitting={create.isPending} />}
    >
      <form onSubmit={onSubmit} id={FORM_ID}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <TextField
            label="Task name"
            helperText="What the volunteer will see, e.g. Stock Inventory"
            autoFocus
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={LIMITS.TASK_TITLE_MAX}
          />

          <SelectField
            label="Volunteer"
            required
            value={assignedTo}
            onChange={setAssignedTo}
            placeholder="Choose someone…"
            options={users.map((u) => ({ value: u.id, label: `${u.name} (${u.role})` }))}
          />

          <TextField
            label="Details"
            multiline
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={LIMITS.TASK_DESCRIPTION_MAX}
          />

          <SelectField
            label="Priority"
            value={priority}
            onChange={(v) => setPriority(v as TaskPriority)}
            options={enumOptions(TaskPriority)}
          />

          <SelectField
            label="Type"
            helperText="Off time marks the volunteer unavailable rather than busy."
            value={kind}
            onChange={(v) => setKind(v as TaskKind)}
            options={enumOptions(TaskKind)}
          />

          <NumberField
            label="Estimated minutes"
            helperText="Optional. Drives the 'free after' estimate on the team activity view."
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            min={1}
            max={LIMITS.TASK_ESTIMATE_MINUTES_MAX}
          />
        </FieldGroup>
      </form>
    </Modal>
  );
}
