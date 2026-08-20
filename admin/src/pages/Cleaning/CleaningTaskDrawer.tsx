import { useState } from 'react';
import {
  CLEANING_TASK_STATUS_LABELS,
  CLEANING_VERIFICATION_METHOD_LABELS,
  Capability,
  CleaningStepStatus,
  CleaningVerificationOutcome,
  LIMITS,
  type CleaningTaskDto,
} from '@menuboard/shared';
import {
  CheckIcon,
  CircleSlashIcon,
  PlayIcon,
  SkipForwardIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UserPlusIcon,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/form/fields';
import { Modal } from '../../components/Modal/Modal';
import { TONE_CHIP_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/notify';
import { readError } from '../../services/errorMessage';
import { useAuth } from '../../services/AuthContext';
import {
  useCancelCleaningTask,
  useCleaningTask,
  useCompleteCleaningTask,
  useRecordCleaningStep,
  useStartCleaningTask,
  useVerifyCleaningTask,
} from '../../hooks/useCleaning';
import {
  CLEANING_PRIORITY_TONE,
  CLEANING_TASK_STATUS_TONE,
  CORRECTIVE_STATUS_TONE,
  STEP_STATUS_TONE,
  dueLabel,
  durationLabel,
  formatDateTime,
} from './cleaningTone';
import { AssignCleaningTaskModal } from './AssignCleaningTaskModal';
import { ReasonModal } from './ReasonModal';

/**
 * One cleaning occurrence, end to end: the procedure to follow, the steps as they are done, the
 * photos, the checks, and the whole state history.
 *
 * The action row is driven by the server's own `canStart` / `canComplete` / `canVerify` flags
 * rather than by the client re-deriving the state machine. A button the server would refuse is
 * a button that should never have been drawn.
 */
export function CleaningTaskDrawer({
  taskId,
  onClose,
}: {
  taskId: string | null;
  onClose: () => void;
}): JSX.Element {
  const { hasCapability } = useAuth();
  const canAssign = hasCapability(Capability.CLEANING_ASSIGN);

  const { data: task, isLoading } = useCleaningTask(taskId);
  const start = useStartCleaningTask();
  const recordStep = useRecordCleaningStep();
  const complete = useCompleteCleaningTask();
  const verify = useVerifyCleaningTask();
  const cancel = useCancelCleaningTask();

  const [completionNote, setCompletionNote] = useState('');
  const [verifyNote, setVerifyNote] = useState('');
  const [failureReason, setFailureReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [skipping, setSkipping] = useState<{ stepId: string; title: string } | null>(null);

  async function run(action: () => Promise<unknown>, success: string): Promise<void> {
    setError(null);
    try {
      await action();
      notify.success(success);
    } catch (err) {
      const message = readError(err).message;
      setError(message);
      notify.error(message);
    }
  }

  return (
    <>
      <Modal
        id="cleaning-task"
        title={task?.taskName ?? 'Cleaning task'}
        open={taskId !== null}
        onClose={onClose}
        minWidth={720}
        minHeight={520}
        footer={<Button variant="outline" onClick={onClose}>Close</Button>}
      >
        {isLoading || task === undefined ? (
          <p className="text-muted-foreground py-8 text-center text-sm">Loading…</p>
        ) : (
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Header task={task} />

            {/* Actions first: this window exists to be acted on, not read. */}
            <div className="flex flex-wrap gap-2">
              {task.canStart === true && (
                <Button
                  onClick={() => run(() => start.mutateAsync(task.id), 'Task started.')}
                  disabled={start.isPending}
                >
                  <PlayIcon data-icon="inline-start" />
                  Start
                </Button>
              )}
              {canAssign && task.isOpen && (
                <Button variant="outline" onClick={() => setAssigning(true)}>
                  <UserPlusIcon data-icon="inline-start" />
                  {task.assignedToName === null ? 'Assign' : 'Reassign'}
                </Button>
              )}
              {canAssign && task.isOpen && (
                <Button
                  variant="outline"
                  onClick={() => setCancelling(true)}
                  disabled={cancel.isPending}
                >
                  <CircleSlashIcon data-icon="inline-start" />
                  Cancel
                </Button>
              )}
            </div>

            <Section title="Procedure">
              {task.procedure === undefined ? (
                <p className="text-muted-foreground text-sm">Not available.</p>
              ) : (
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="font-medium">{task.procedure.procedureName}</span>{' '}
                    <span className="text-muted-foreground">v{task.procedure.version}</span>
                    {task.procedure.methodName !== null && (
                      <span className="text-muted-foreground"> · {task.procedure.methodName}</span>
                    )}
                  </p>
                  {task.procedure.ppeRequired !== null && (
                    <p className="text-muted-foreground text-xs">
                      <span className="font-medium">PPE:</span> {task.procedure.ppeRequired}
                    </p>
                  )}
                  {task.procedure.safetyNotes !== null && (
                    <p className="text-tone-danger text-xs">{task.procedure.safetyNotes}</p>
                  )}
                  {task.procedure.standardAcceptanceText !== null &&
                    task.procedure.standardAcceptanceText !== undefined && (
                      <p className="text-muted-foreground text-xs">
                        <span className="font-medium">Clean means:</span>{' '}
                        {task.procedure.standardAcceptanceText}
                      </p>
                    )}
                </div>
              )}
            </Section>

            <Section
              title={`Steps (${task.stepsDone ?? 0}/${task.stepCount ?? 0})`}
              hint="A required step cannot be silently skipped — skipping one asks for a reason."
            >
              <ol className="divide-border divide-y">
                {(task.steps ?? []).map((step) => (
                  <li key={step.id} className="flex items-start gap-3 py-2">
                    <span className="text-muted-foreground w-5 shrink-0 pt-0.5 text-xs tabular-nums">
                      {step.stepNumber}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {step.title}
                        {step.isMandatory && <span className="text-tone-danger ml-1">*</span>}
                        {step.requiresPhoto && (
                          <span className="text-muted-foreground ml-1 text-xs">(photo)</span>
                        )}
                      </p>
                      {step.instruction !== null && (
                        <p className="text-muted-foreground text-xs">{step.instruction}</p>
                      )}
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {[
                          step.chemicalName,
                          step.toolName,
                          durationLabel(step.durationSeconds),
                          step.performedByName,
                          step.skipReason === null ? null : `skipped: ${step.skipReason}`,
                        ]
                          .filter((part) => part !== null && part !== undefined)
                          .join(' · ')}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span
                        className={cn(
                          'rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                          TONE_CHIP_CLASS[STEP_STATUS_TONE[step.status]],
                        )}
                      >
                        {step.status}
                      </span>
                      {task.canComplete === true && step.status === CleaningStepStatus.PENDING && (
                        <>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Mark step ${step.stepNumber} done`}
                            onClick={() =>
                              run(
                                () =>
                                  recordStep.mutateAsync({
                                    id: task.id,
                                    stepId: step.stepId,
                                    body: { status: CleaningStepStatus.DONE },
                                  }),
                                'Step recorded.',
                              )
                            }
                          >
                            <CheckIcon />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Skip step ${step.stepNumber}`}
                            onClick={() =>
                              setSkipping({ stepId: step.stepId, title: step.title })
                            }
                          >
                            <SkipForwardIcon />
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </Section>

            {task.canComplete === true && (
              <Section title="Finish the job">
                <TextField
                  label="What you did"
                  multiline
                  rows={2}
                  value={completionNote}
                  onChange={(event) => setCompletionNote(event.target.value)}
                  maxLength={LIMITS.CLEANING_TASK_COMPLETION_NOTE_MAX}
                />
                <Button
                  className="mt-2"
                  disabled={complete.isPending}
                  onClick={() =>
                    run(
                      () =>
                        complete.mutateAsync({
                          id: task.id,
                          body: completionNote.trim() === '' ? {} : { note: completionNote.trim() },
                        }),
                      'Cleaning recorded.',
                    )
                  }
                >
                  <CheckIcon data-icon="inline-start" />
                  Mark as done
                </Button>
              </Section>
            )}

            {task.canVerify === true && (
              <Section
                title="Check the work"
                hint={
                  task.verificationMethod === null
                    ? undefined
                    : CLEANING_VERIFICATION_METHOD_LABELS[task.verificationMethod]
                }
              >
                <TextField
                  label="Note"
                  multiline
                  rows={2}
                  value={verifyNote}
                  onChange={(event) => setVerifyNote(event.target.value)}
                  maxLength={LIMITS.CLEANING_VERIFICATION_NOTE_MAX}
                />
                <TextField
                  label="What is wrong with it"
                  helperText="Required to fail a check. It becomes the corrective action's summary."
                  multiline
                  rows={2}
                  value={failureReason}
                  onChange={(event) => setFailureReason(event.target.value)}
                  maxLength={LIMITS.CLEANING_VERIFICATION_FAILURE_REASON_MAX}
                />
                <div className="mt-2 flex gap-2">
                  <Button
                    disabled={verify.isPending}
                    onClick={() =>
                      run(
                        () =>
                          verify.mutateAsync({
                            id: task.id,
                            body: {
                              outcome: CleaningVerificationOutcome.PASS,
                              ...(verifyNote.trim() !== '' ? { note: verifyNote.trim() } : {}),
                            },
                          }),
                        'Passed. The task is closed.',
                      )
                    }
                  >
                    <ThumbsUpIcon data-icon="inline-start" />
                    Pass
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={verify.isPending || failureReason.trim() === ''}
                    onClick={() =>
                      run(
                        () =>
                          verify.mutateAsync({
                            id: task.id,
                            body: {
                              outcome: CleaningVerificationOutcome.FAIL,
                              failureReason: failureReason.trim(),
                              ...(verifyNote.trim() !== '' ? { note: verifyNote.trim() } : {}),
                            },
                          }),
                        'Failed. It has gone back for recleaning.',
                      )
                    }
                  >
                    <ThumbsDownIcon data-icon="inline-start" />
                    Fail
                  </Button>
                </div>
              </Section>
            )}

            {(task.evidence ?? []).length > 0 && (
              <Section title={`Photos (${(task.evidence ?? []).length})`}>
                <div className="flex flex-wrap gap-2">
                  {(task.evidence ?? []).map((item) => (
                    <figure key={item.id} className="w-28">
                      <img
                        src={item.url}
                        alt={item.caption ?? item.kind}
                        className="h-20 w-28 rounded-md border object-cover"
                      />
                      <figcaption className="text-muted-foreground mt-1 truncate text-[0.7188rem]">
                        {item.kind} · {item.uploadedByName ?? '—'}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </Section>
            )}

            {(task.verifications ?? []).length > 0 && (
              <Section title="Checks">
                <ul className="divide-border divide-y">
                  {(task.verifications ?? []).map((check) => (
                    <li key={check.id} className="py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          Attempt {check.attempt} ·{' '}
                          {CLEANING_VERIFICATION_METHOD_LABELS[check.method]}
                        </span>
                        <span
                          className={cn(
                            'rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                            TONE_CHIP_CLASS[check.outcome === 'PASS' ? 'success' : 'danger'],
                          )}
                        >
                          {check.outcome}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {check.verifiedByName} · {formatDateTime(check.verifiedAt)}
                        {check.failureReason !== null && ` · ${check.failureReason}`}
                      </p>
                      {check.results.map((result) => (
                        <p key={result.id} className="text-muted-foreground text-xs">
                          {result.label}: {result.measuredValue ?? '—'} {result.measureUnit ?? ''}
                          {result.passed === null ? '' : result.passed ? ' ✓' : ' ✗'}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {(task.correctiveActions ?? []).length > 0 && (
              <Section title="Corrective actions">
                <ul className="divide-border divide-y">
                  {(task.correctiveActions ?? []).map((action) => (
                    <li key={action.id} className="flex items-start justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <p className="text-sm">{action.failureSummary}</p>
                        <p className="text-muted-foreground text-xs">
                          {action.assignedToName ?? 'Unassigned'}
                          {action.rootCause !== null && ` · cause: ${action.rootCause}`}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                          TONE_CHIP_CLASS[CORRECTIVE_STATUS_TONE[action.status]],
                        )}
                      >
                        {action.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="History">
              <ul className="space-y-1">
                {(task.history ?? []).map((entry) => (
                  <li key={entry.id} className="text-muted-foreground text-xs">
                    <span className="text-foreground font-medium">
                      {CLEANING_TASK_STATUS_LABELS[entry.toStatus]}
                    </span>{' '}
                    · {entry.actorName ?? entry.source} · {formatDateTime(entry.createdAt)}
                    {entry.note !== null && ` — ${entry.note}`}
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        )}
      </Modal>

      {task !== undefined && (
        <>
          <AssignCleaningTaskModal
            open={assigning}
            onClose={() => setAssigning(false)}
            task={task}
          />

          <ReasonModal
            open={cancelling}
            title="Cancel this cleaning task"
            description={task.taskName}
            placeholder="The area was taken out of use for a rebuild"
            confirmLabel="Cancel the task"
            maxLength={LIMITS.CLEANING_TASK_CANCEL_REASON_MAX}
            submitting={cancel.isPending}
            onClose={() => setCancelling(false)}
            onConfirm={(reason) => {
              setCancelling(false);
              void run(
                () => cancel.mutateAsync({ id: task.id, body: { reason } }),
                'Task cancelled.',
              );
            }}
          />

          <ReasonModal
            open={skipping !== null}
            title="Why is this step being skipped?"
            description={skipping?.title}
            placeholder="The fryer was still hot"
            confirmLabel="Skip this step"
            maxLength={LIMITS.CLEANING_STEP_SKIP_REASON_MAX}
            submitting={recordStep.isPending}
            onClose={() => setSkipping(null)}
            onConfirm={(reason) => {
              const step = skipping;
              setSkipping(null);
              if (step === null) return;
              void run(
                () =>
                  recordStep.mutateAsync({
                    id: task.id,
                    stepId: step.stepId,
                    body: { status: CleaningStepStatus.SKIPPED, skipReason: reason },
                  }),
                'Step skipped.',
              );
            }}
          />
        </>
      )}
    </>
  );
}

function Header({ task }: { task: CleaningTaskDto }): JSX.Element {
  return (
    <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {task.cleanableAssetName} <span className="text-muted-foreground">·</span>{' '}
          <span className="text-muted-foreground">{task.locationPath}</span>
        </p>
        <p className="text-muted-foreground text-xs">
          {task.assignedToName ?? 'Nobody assigned'} · {dueLabel(task.dueAt, task.isOverdue)}
          {task.shiftName !== null && task.shiftName !== undefined && ` · ${task.shiftName} shift`}
          {task.recleanCount > 0 && ` · recleaned ${task.recleanCount}×`}
        </p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <span
          className={cn(
            'rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
            TONE_CHIP_CLASS[CLEANING_PRIORITY_TONE[task.priority]],
          )}
        >
          {task.priority}
        </span>
        <span
          className={cn(
            'rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
            TONE_CHIP_CLASS[CLEANING_TASK_STATUS_TONE[task.status]],
          )}
        >
          {CLEANING_TASK_STATUS_LABELS[task.status]}
        </span>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section>
      <h3 className="font-heading text-sm font-semibold tracking-tight">{title}</h3>
      {hint !== undefined && <p className="text-muted-foreground mb-1 text-xs">{hint}</p>}
      <div className="mt-1">{children}</div>
    </section>
  );
}
