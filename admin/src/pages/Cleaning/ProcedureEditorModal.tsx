import { useEffect, useState } from 'react';
import {
  CleaningProcedureVersionStatus,
  LIMITS,
  type CleaningProcedureStepWriteRequest,
} from '@menuboard/shared';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldGroup, SelectField, SwitchField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { TONE_CHIP_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/notify';
import { readError } from '../../services/errorMessage';
import {
  useCleaningProcedure,
  useCleaningSetup,
  useCloneProcedureDraft,
  useCreateProcedure,
  useDiscardProcedureDraft,
  usePublishProcedure,
  useSaveProcedureDraft,
} from '../../hooks/useCleaning';
import { PROCEDURE_VERSION_TONE, formatDateTime } from './cleaningTone';

const FORM_ID = 'cleaning-procedure-form';

type DraftStep = CleaningProcedureStepWriteRequest;

function blankStep(stepNumber: number): DraftStep {
  return { stepNumber, title: '', isMandatory: true, requiresPhoto: false };
}

/**
 * Writing and publishing a cleaning procedure.
 *
 * The publication ladder is visible rather than implied, because it is what makes a procedure a
 * controlled document: you edit a **draft**, you **publish** it, and from that moment tasks pin
 * it and it can never be edited again. Editing a published procedure starts a new draft from
 * what is in force, so the change is always a new version with the old one intact behind it.
 */
export function ProcedureEditorModal({
  open,
  onClose,
  procedureId,
}: {
  open: boolean;
  onClose: () => void;
  procedureId: string | null;
}): JSX.Element {
  const editing = procedureId !== null;
  const { data: setup } = useCleaningSetup();
  const { data: procedure } = useCleaningProcedure(open ? procedureId : null);

  const createProcedure = useCreateProcedure();
  const saveDraft = useSaveProcedureDraft();
  const publish = usePublishProcedure();
  const cloneDraft = useCloneProcedureDraft();
  const discardDraft = useDiscardProcedureDraft();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [methodId, setMethodId] = useState('');
  const [standardId, setStandardId] = useState('');
  const [ppeRequired, setPpeRequired] = useState('');
  const [safetyNotes, setSafetyNotes] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [requiresRinse, setRequiresRinse] = useState(false);
  const [requiresFinalRinse, setRequiresFinalRinse] = useState(false);
  const [requiresDrying, setRequiresDrying] = useState(false);
  const [requiresDisassembly, setRequiresDisassembly] = useState(false);
  const [steps, setSteps] = useState<DraftStep[]>([blankStep(1)]);
  const [error, setError] = useState<string | null>(null);

  const draft = (procedure?.versions ?? []).find(
    (version) => version.status === CleaningProcedureVersionStatus.DRAFT,
  );
  const published = (procedure?.versions ?? []).find(
    (version) => version.status === CleaningProcedureVersionStatus.PUBLISHED,
  );
  useEffect(() => {
    if (!open) return;
    // Derived inside the effect rather than read from the render scope: `draft`/`published` are
    // fresh objects on every render, so depending on them would re-seed the form mid-edit and
    // discard what the user has typed.
    const versions = procedure?.versions ?? [];
    const openDraft = versions.find(
      (version) => version.status === CleaningProcedureVersionStatus.DRAFT,
    );
    const inForce = versions.find(
      (version) => version.status === CleaningProcedureVersionStatus.PUBLISHED,
    );
    const seed = openDraft ?? inForce;

    setError(null);
    setCode(procedure?.code ?? '');
    setName(procedure?.name ?? '');
    setDescription(procedure?.description ?? '');
    setMethodId(seed?.methodId ?? '');
    setStandardId(seed?.standardId ?? '');
    setPpeRequired(seed?.ppeRequired ?? '');
    setSafetyNotes(seed?.safetyNotes ?? '');
    setEstimatedMinutes(
      seed?.estimatedMinutes === null || seed === undefined ? '' : String(seed.estimatedMinutes),
    );
    setChangeNote(openDraft?.changeNote ?? '');
    setRequiresRinse(seed?.requiresRinse ?? false);
    setRequiresFinalRinse(seed?.requiresFinalRinse ?? false);
    setRequiresDrying(seed?.requiresDrying ?? false);
    setRequiresDisassembly(seed?.requiresDisassembly ?? false);
    setSteps(
      seed === undefined || seed.steps.length === 0
        ? [blankStep(1)]
        : seed.steps.map((step) => ({
            stepNumber: step.stepNumber,
            title: step.title,
            instruction: step.instruction,
            chemicalId: step.chemicalId,
            toolId: step.toolId,
            durationSeconds: step.durationSeconds,
            isMandatory: step.isMandatory,
            requiresPhoto: step.requiresPhoto,
          })),
    );
  }, [open, procedure]);

  function updateStep(index: number, patch: Partial<DraftStep>): void {
    setSteps((current) =>
      current.map((step, position) => (position === index ? { ...step, ...patch } : step)),
    );
  }

  function moveStep(index: number, delta: number): void {
    setSteps((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      const [moved] = next.splice(index, 1);
      if (moved === undefined) return current;
      next.splice(target, 0, moved);
      return next.map((step, position) => ({ ...step, stepNumber: position + 1 }));
    });
  }

  function removeStep(index: number): void {
    setSteps((current) =>
      current
        .filter((_, position) => position !== index)
        .map((step, position) => ({ ...step, stepNumber: position + 1 })),
    );
  }

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    const cleanSteps = steps
      .filter((step) => step.title.trim() !== '')
      .map((step, index) => ({ ...step, stepNumber: index + 1, title: step.title.trim() }));

    try {
      let targetId = procedureId;
      if (targetId === null) {
        const created = await createProcedure.mutateAsync({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          description: description.trim() === '' ? null : description.trim(),
        });
        targetId = created.id;
      }

      await saveDraft.mutateAsync({
        id: targetId,
        body: {
          methodId: methodId === '' ? null : methodId,
          standardId: standardId === '' ? null : standardId,
          changeNote: changeNote.trim() === '' ? null : changeNote.trim(),
          ppeRequired: ppeRequired.trim() === '' ? null : ppeRequired.trim(),
          safetyNotes: safetyNotes.trim() === '' ? null : safetyNotes.trim(),
          estimatedMinutes: estimatedMinutes === '' ? null : Number(estimatedMinutes),
          requiresRinse,
          requiresFinalRinse,
          requiresDrying,
          requiresDisassembly,
          steps: cleanSteps,
        },
      });
      notify.success('Draft saved. Publish it when it is ready to be followed.');
      if (procedureId === null) onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  async function onPublish(): Promise<void> {
    if (procedureId === null) return;
    setError(null);
    try {
      const version = await publish.mutateAsync(procedureId);
      notify.success(`Version ${version.version} published. New tasks will follow it.`);
    } catch (err) {
      const message = readError(err).message;
      setError(message);
      notify.error(message);
    }
  }

  return (
    <Modal
      id="cleaning-procedure"
      title={editing ? (procedure?.name ?? 'Procedure') : 'New cleaning procedure'}
      description="The numbered steps a cleaner follows, and the standard it is judged against."
      open={open}
      onClose={onClose}
      minWidth={720}
      minHeight={560}
      footer={
        <FormModalFooter
          formId={FORM_ID}
          onCancel={onClose}
          submitting={createProcedure.isPending || saveDraft.isPending}
          saveLabel="Save draft"
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

          {editing && (
            <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div className="text-xs">
                {published !== undefined ? (
                  <p>
                    <span className="font-medium">v{published.version}</span> is in force ·
                    published {formatDateTime(published.publishedAt)}
                    {published.publishedByName !== undefined &&
                      published.publishedByName !== null &&
                      ` by ${published.publishedByName}`}
                  </p>
                ) : (
                  <p className="text-tone-danger font-medium">
                    Never published — no rule can use this yet.
                  </p>
                )}
                {draft !== undefined && (
                  <p className="text-muted-foreground">
                    Draft v{draft.version} is open. Saving edits it; publishing puts it in force.
                  </p>
                )}
                {draft === undefined && published !== undefined && (
                  <p className="text-muted-foreground">
                    Published versions are read-only. Start a draft to change anything.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {draft === undefined && published !== undefined && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void cloneDraft.mutateAsync(procedureId)}
                    disabled={cloneDraft.isPending}
                  >
                    Start a draft
                  </Button>
                )}
                {draft !== undefined && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void discardDraft.mutateAsync(procedureId)}
                      disabled={discardDraft.isPending}
                    >
                      Discard draft
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={onPublish}
                      disabled={publish.isPending}
                    >
                      <UploadIcon data-icon="inline-start" />
                      Publish
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          <TextField
            label="Code"
            required
            placeholder="CLN-FOODSURF"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            maxLength={LIMITS.CLEANING_PROCEDURE_CODE_MAX}
            disabled={editing}
          />

          <TextField
            label="Name"
            required
            placeholder="Food contact surface clean"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={LIMITS.CLEANING_PROCEDURE_NAME_MAX}
            disabled={editing}
          />

          {!editing && (
            <TextField
              label="Description"
              multiline
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={LIMITS.CLEANING_PROCEDURE_DESCRIPTION_MAX}
            />
          )}

          <SelectField
            label="Method"
            value={methodId}
            onChange={setMethodId}
            emptyLabel="No particular method"
            options={(setup?.methods ?? []).map((method) => ({
              value: method.id,
              label: method.name,
            }))}
          />

          <SelectField
            label="Clean means"
            helperText="The written acceptance criteria a check is judged against."
            value={standardId}
            onChange={setStandardId}
            emptyLabel="No formal standard"
            options={(setup?.standards ?? []).map((standard) => ({
              value: standard.id,
              label: standard.name,
            }))}
          />

          <TextField
            label="PPE required"
            placeholder="Gloves, apron, eye protection"
            value={ppeRequired}
            onChange={(event) => setPpeRequired(event.target.value)}
            maxLength={LIMITS.CLEANING_PROCEDURE_PPE_MAX}
          />

          <TextField
            label="Safety notes"
            multiline
            rows={2}
            helperText="Shown in red on the operator's screen before they start."
            value={safetyNotes}
            onChange={(event) => setSafetyNotes(event.target.value)}
            maxLength={LIMITS.CLEANING_PROCEDURE_SAFETY_MAX}
          />

          <TextField
            label="How long it takes (minutes)"
            type="number"
            min={0}
            max={LIMITS.CLEANING_ESTIMATED_MINUTES_MAX}
            value={estimatedMinutes}
            onChange={(event) => setEstimatedMinutes(event.target.value)}
          />

          <SwitchField
            label="Needs stripping down"
            checked={requiresDisassembly}
            onCheckedChange={setRequiresDisassembly}
          />
          <SwitchField label="Needs rinsing" checked={requiresRinse} onCheckedChange={setRequiresRinse} />
          <SwitchField
            label="Needs a final rinse"
            checked={requiresFinalRinse}
            onCheckedChange={setRequiresFinalRinse}
          />
          <SwitchField
            label="Needs drying"
            checked={requiresDrying}
            onCheckedChange={setRequiresDrying}
          />

          <div>
            <h3 className="font-heading text-sm font-semibold tracking-tight">Steps</h3>
            <p className="text-muted-foreground mb-2 text-xs">
              A required step cannot be silently skipped, and a step that demands a photo blocks
              completion until one is attached. That is the difference between a hygiene record
              and a tick box.
            </p>

            <ol className="space-y-3">
              {steps.map((step, index) => (
                <li key={index} className="rounded-lg border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-muted-foreground text-xs font-medium">
                      Step {index + 1}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Move up"
                        onClick={() => moveStep(index, -1)}
                        disabled={index === 0}
                      >
                        <ArrowUpIcon />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Move down"
                        onClick={() => moveStep(index, 1)}
                        disabled={index === steps.length - 1}
                      >
                        <ArrowDownIcon />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Remove step"
                        onClick={() => removeStep(index)}
                        disabled={steps.length === 1}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </div>

                  <FieldGroup>
                    <TextField
                      label="What to do"
                      required
                      placeholder="Wash with detergent"
                      value={step.title}
                      onChange={(event) => updateStep(index, { title: event.target.value })}
                      maxLength={LIMITS.CLEANING_STEP_TITLE_MAX}
                    />
                    <TextField
                      label="Detail"
                      multiline
                      rows={2}
                      value={step.instruction ?? ''}
                      onChange={(event) => updateStep(index, { instruction: event.target.value })}
                      maxLength={LIMITS.CLEANING_STEP_INSTRUCTION_MAX}
                    />
                    <SelectField
                      label="Chemical"
                      value={step.chemicalId ?? ''}
                      onChange={(next) => updateStep(index, { chemicalId: next === '' ? null : next })}
                      emptyLabel="None"
                      options={(setup?.chemicals ?? []).map((chemical) => ({
                        value: chemical.id,
                        label: chemical.name,
                      }))}
                    />
                    <SelectField
                      label="Tool"
                      value={step.toolId ?? ''}
                      onChange={(next) => updateStep(index, { toolId: next === '' ? null : next })}
                      emptyLabel="None"
                      options={(setup?.tools ?? []).map((tool) => ({
                        value: tool.id,
                        label:
                          tool.colourCode === null ? tool.name : `${tool.name} (${tool.colourCode})`,
                      }))}
                    />
                    <TextField
                      label="Contact / dwell time (seconds)"
                      type="number"
                      min={0}
                      max={LIMITS.CLEANING_CONTACT_SECONDS_MAX}
                      value={step.durationSeconds === null || step.durationSeconds === undefined ? '' : String(step.durationSeconds)}
                      onChange={(event) =>
                        updateStep(index, {
                          durationSeconds:
                            event.target.value === '' ? null : Number(event.target.value),
                        })
                      }
                    />
                    <SwitchField
                      label="Required"
                      helperText="Skipping a required step demands a written reason."
                      checked={step.isMandatory ?? true}
                      onCheckedChange={(next) => updateStep(index, { isMandatory: next })}
                    />
                    <SwitchField
                      label="Needs a photo"
                      helperText="The task cannot be completed until one is attached to this step."
                      checked={step.requiresPhoto ?? false}
                      onCheckedChange={(next) => updateStep(index, { requiresPhoto: next })}
                    />
                  </FieldGroup>
                </li>
              ))}
            </ol>

            <Button
              type="button"
              variant="outline"
              className="mt-2"
              onClick={() => setSteps((current) => [...current, blankStep(current.length + 1)])}
              disabled={steps.length >= LIMITS.CLEANING_STEPS_PER_VERSION_MAX}
            >
              <PlusIcon data-icon="inline-start" />
              Add a step
            </Button>
          </div>

          <TextField
            label="What changed"
            helperText="Recorded on the version, so a controlled document has a change history."
            value={changeNote}
            onChange={(event) => setChangeNote(event.target.value)}
            maxLength={LIMITS.CLEANING_PROCEDURE_CHANGE_NOTE_MAX}
          />

          {editing && (procedure?.versions ?? []).length > 0 && (
            <div>
              <h3 className="font-heading text-sm font-semibold tracking-tight">Version history</h3>
              <ul className="divide-border mt-1 divide-y">
                {(procedure?.versions ?? []).map((version) => (
                  <li key={version.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="text-sm">
                      v{version.version}
                      {version.changeNote !== null && (
                        <span className="text-muted-foreground"> — {version.changeNote}</span>
                      )}
                    </span>
                    <span
                      className={cn(
                        'rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                        TONE_CHIP_CLASS[PROCEDURE_VERSION_TONE[version.status]],
                      )}
                    >
                      {version.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </FieldGroup>
      </form>
    </Modal>
  );
}
