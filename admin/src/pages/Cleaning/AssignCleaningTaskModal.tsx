import { useState } from 'react';
import { LIMITS, type CleaningTaskDto } from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldGroup, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { TONE_CHIP_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/notify';
import { readError } from '../../services/errorMessage';
import { useAssignCleaningTask, useTaskCandidates } from '../../hooks/useCleaning';

const FORM_ID = 'assign-cleaning-task-form';

/**
 * Handing a cleaning job to somebody.
 *
 * The candidate list is the engine's own scoring, shown rather than hidden: who is on shift,
 * who owns the area, who holds the competence the rule requires, and how loaded each of them
 * already is. A supervisor overriding the top pick can see exactly what they are overriding,
 * and somebody who is refused work can be told why in one sentence.
 */
export function AssignCleaningTaskModal({
  open,
  onClose,
  task,
}: {
  open: boolean;
  onClose: () => void;
  task: CleaningTaskDto;
}): JSX.Element {
  const [selected, setSelected] = useState<string | null>(task.assignedToId);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: candidates, isLoading } = useTaskCandidates(open ? task.id : null);
  const assign = useAssignCleaningTask();

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await assign.mutateAsync({
        id: task.id,
        body: {
          assignedTo: selected,
          ...(note.trim() !== '' ? { note: note.trim() } : {}),
        },
      });
      notify.success(selected === null ? 'Returned to the pool.' : 'Task assigned.');
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="assign-cleaning-task"
      title="Who is doing this?"
      description={task.taskName}
      open={open}
      onClose={onClose}
      minWidth={560}
      footer={
        <FormModalFooter
          formId={FORM_ID}
          onCancel={onClose}
          submitting={assign.isPending}
          saveLabel={selected === null ? 'Return to the pool' : 'Assign'}
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

          {isLoading ? (
            <p className="text-muted-foreground text-sm">Working out who could take this…</p>
          ) : (candidates ?? []).length === 0 ? (
            <Alert>
              <AlertDescription>
                Nobody is on the cleaning roster yet. Add people under Workforce.
              </AlertDescription>
            </Alert>
          ) : (
            <ul className="divide-border divide-y rounded-md border">
              {(candidates ?? []).map((candidate) => {
                const active = selected === candidate.userId;
                return (
                  <li key={candidate.userId}>
                    <button
                      type="button"
                      onClick={() => setSelected(candidate.userId)}
                      className={cn(
                        'focus-ring flex w-full items-center justify-between gap-3 px-3 py-2 text-left',
                        active ? 'bg-accent' : 'hover:bg-accent/50',
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {candidate.name}
                          {candidate.isPrimaryForArea && (
                            <span className="text-muted-foreground ml-1 text-xs">
                              · owns this area
                            </span>
                          )}
                        </p>
                        <p className="text-muted-foreground truncate text-xs">
                          {candidate.eligible
                            ? [
                                candidate.onShift ? 'on shift' : 'off shift',
                                `${candidate.openTaskCount} open`,
                                candidate.hasEverySkill ? 'qualified' : 'not qualified',
                              ].join(' · ')
                            : candidate.ineligibleReason}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                          TONE_CHIP_CLASS[candidate.eligible ? 'success' : 'muted'],
                        )}
                      >
                        {candidate.eligible ? `score ${candidate.score}` : 'not eligible'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Handing a task back is a real decision, not an absence of one, so it is a button. */}
          <Button type="button" variant="outline" onClick={() => setSelected(null)}>
            Leave it unassigned
          </Button>

          <TextField
            label="Note"
            multiline
            rows={2}
            helperText="Recorded against the assignment, so a disputed roster can be explained."
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={LIMITS.CLEANING_STEP_NOTE_MAX}
          />
        </FieldGroup>
      </form>
    </Modal>
  );
}
