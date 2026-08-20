import { useEffect, useMemo, useState } from 'react';
import {
  CALENDAR_FREQUENCY_KINDS,
  CLEANING_FREQUENCY_KIND_LABELS,
  CLEANING_TASK_PRIORITY_LABELS,
  CLEANING_TRIGGER_EVENT_LABELS,
  CLEANING_VERIFICATION_METHOD_LABELS,
  CleaningFrequencyKind,
  CleaningRuleScope,
  CleaningTaskPriority,
  CleaningVerificationMethod,
  LIMITS,
  PUBLISHABLE_TRIGGER_EVENTS,
  SKILL_LEVEL_LABELS,
  SkillLevel,
  UserRole,
  type CleaningRuleDto,
  type CleaningTriggerEvent,
} from '@menuboard/shared';
import { PlayIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { FieldGroup, SelectField, SwitchField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { notify } from '@/lib/notify';
import { readError } from '../../services/errorMessage';
import {
  useCleaningSetup,
  useCreateCleaningRule,
  useRulePreview,
  useUpdateCleaningRule,
} from '../../hooks/useCleaning';
import { formatDateTime } from './cleaningTone';

const FORM_ID = 'cleaning-rule-form';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Writing a cleaning rule.
 *
 * The form reshapes itself around two choices, because the rest only makes sense downstream of
 * them: the **scope** decides whether you are naming one asset, a type, or a type within an
 * area; and the **frequency kind** decides whether you are setting a calendar (day, time) or
 * subscribing to operational events.
 *
 * When editing, the live preview shows what the rule would raise right now and what — if
 * anything — is stopping it. A rule that reaches nothing is the failure this form exists to
 * prevent.
 */
export function CleaningRuleFormModal({
  open,
  onClose,
  rule,
  onRun,
}: {
  open: boolean;
  onClose: () => void;
  rule: CleaningRuleDto | null;
  onRun?: (rule: CleaningRuleDto) => Promise<void>;
}): JSX.Element {
  const editing = rule !== null;
  const { data: setup } = useCleaningSetup();
  const create = useCreateCleaningRule();
  const update = useUpdateCleaningRule();
  const { data: preview } = useRulePreview(open && editing ? rule.id : null);

  const [code, setCode] = useState('');
  const [taskName, setTaskName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [scope, setScope] = useState<string>(CleaningRuleScope.ASSET_TYPE_IN_AREA);
  const [cleanableAssetId, setCleanableAssetId] = useState('');
  const [assetTypeId, setAssetTypeId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [procedureId, setProcedureId] = useState('');
  const [frequencyKind, setFrequencyKind] = useState<string>(CleaningFrequencyKind.DAILY);
  const [intervalDays, setIntervalDays] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState('');
  const [dayOfMonth, setDayOfMonth] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [dueWithinMinutes, setDueWithinMinutes] = useState('');
  const [triggers, setTriggers] = useState<CleaningTriggerEvent[]>([]);
  const [skillId, setSkillId] = useState('');
  const [skillLevel, setSkillLevel] = useState<string>(SkillLevel.BASIC);
  const [responsibleRole, setResponsibleRole] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState('');
  const [priority, setPriority] = useState<string>(CleaningTaskPriority.NORMAL);
  const [requiresVerification, setRequiresVerification] = useState(false);
  const [verificationMethod, setVerificationMethod] = useState('');
  const [verifierRole, setVerifierRole] = useState('');
  const [standardId, setStandardId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isCalendar = CALENDAR_FREQUENCY_KINDS.includes(frequencyKind as CleaningFrequencyKind);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCode(rule?.code ?? '');
    setTaskName(rule?.taskName ?? '');
    setPurpose(rule?.purpose ?? '');
    setScope(rule?.scope ?? CleaningRuleScope.ASSET_TYPE_IN_AREA);
    setCleanableAssetId(rule?.cleanableAssetId ?? '');
    setAssetTypeId(rule?.assetTypeId ?? '');
    setAreaId(rule?.areaId ?? '');
    setProcedureId(rule?.procedureId ?? '');
    setFrequencyKind(rule?.frequencyKind ?? CleaningFrequencyKind.DAILY);
    setIntervalDays(rule?.intervalDays === null || rule === null ? '' : String(rule.intervalDays));
    setDayOfWeek(rule?.dayOfWeek === null || rule === null ? '' : String(rule.dayOfWeek));
    setDayOfMonth(rule?.dayOfMonth === null || rule === null ? '' : String(rule.dayOfMonth));
    setShiftId(rule?.shiftId ?? '');
    setDueTime(rule?.dueTime ?? '');
    setDueWithinMinutes(
      rule?.dueWithinMinutes === null || rule === null ? '' : String(rule.dueWithinMinutes),
    );
    setTriggers(rule?.triggers ?? []);
    setSkillId(rule?.requiredSkills[0]?.skillId ?? '');
    setSkillLevel(rule?.requiredSkills[0]?.requiredLevel ?? SkillLevel.BASIC);
    setResponsibleRole(rule?.responsibleRole ?? '');
    setEstimatedMinutes(
      rule?.estimatedMinutes === null || rule === null ? '' : String(rule.estimatedMinutes),
    );
    setPriority(rule?.priority ?? CleaningTaskPriority.NORMAL);
    setRequiresVerification(rule?.requiresVerification ?? false);
    setVerificationMethod(rule?.verificationMethod ?? '');
    setVerifierRole(rule?.verifierRole ?? '');
    setStandardId(rule?.standardId ?? '');
    setIsActive(rule?.isActive ?? true);
  }, [open, rule]);

  const publishedProcedures = useMemo(
    () => (setup?.procedures ?? []).filter((procedure) => procedure.currentVersionId !== null),
    [setup],
  );
  const unpublishedProcedures = useMemo(
    () => (setup?.procedures ?? []).filter((procedure) => procedure.currentVersionId === null),
    [setup],
  );

  function toggleTrigger(event: CleaningTriggerEvent, on: boolean): void {
    setTriggers((current) =>
      on ? [...new Set([...current, event])] : current.filter((entry) => entry !== event),
    );
  }

  async function onSubmit(submitEvent: React.FormEvent): Promise<void> {
    submitEvent.preventDefault();
    setError(null);

    const body = {
      code: code.trim().toUpperCase(),
      taskName: taskName.trim(),
      purpose: purpose.trim() === '' ? null : purpose.trim(),
      scope: scope as CleaningRuleScope,
      cleanableAssetId: scope === CleaningRuleScope.ASSET ? cleanableAssetId || null : null,
      assetTypeId: scope === CleaningRuleScope.ASSET ? null : assetTypeId || null,
      areaId: scope === CleaningRuleScope.ASSET_TYPE_IN_AREA ? areaId || null : null,
      procedureId,
      frequencyKind: frequencyKind as CleaningFrequencyKind,
      intervalDays: intervalDays === '' ? null : Number(intervalDays),
      dayOfWeek: dayOfWeek === '' ? null : Number(dayOfWeek),
      dayOfMonth: dayOfMonth === '' ? null : Number(dayOfMonth),
      shiftId: shiftId === '' ? null : shiftId,
      dueTime: dueTime === '' ? null : dueTime,
      dueWithinMinutes: dueWithinMinutes === '' ? null : Number(dueWithinMinutes),
      triggers: isCalendar ? [] : triggers,
      requiredSkills:
        skillId === '' ? [] : [{ skillId, requiredLevel: skillLevel as SkillLevel }],
      responsibleRole: responsibleRole === '' ? null : (responsibleRole as UserRole),
      estimatedMinutes: estimatedMinutes === '' ? null : Number(estimatedMinutes),
      priority: priority as CleaningTaskPriority,
      requiresVerification,
      verificationMethod:
        requiresVerification && verificationMethod !== ''
          ? (verificationMethod as CleaningVerificationMethod)
          : null,
      verifierRole: verifierRole === '' ? null : (verifierRole as UserRole),
      standardId: standardId === '' ? null : standardId,
      isActive,
    };

    try {
      if (editing) {
        await update.mutateAsync({ id: rule.id, body });
        notify.success('Rule updated.');
      } else {
        await create.mutateAsync(body);
        notify.success('Rule created.');
      }
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="cleaning-rule-form"
      title={editing ? rule.taskName : 'New cleaning rule'}
      description="What must be cleaned, how often, to what standard, and by whom."
      open={open}
      onClose={onClose}
      minWidth={640}
      minHeight={520}
      footer={
        <FormModalFooter
          formId={FORM_ID}
          onCancel={onClose}
          submitting={create.isPending || update.isPending}
          saveLabel={editing ? 'Save' : 'Create'}
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

          {editing && preview !== undefined && (
            <Alert variant={preview.blockers.length > 0 ? 'destructive' : 'default'}>
              <AlertDescription>
                {preview.blockers.length > 0 ? (
                  <>
                    <span className="font-medium">This rule is not raising work.</span>{' '}
                    {preview.blockers.join(' ')}
                  </>
                ) : (
                  <>
                    Reaches {preview.targets.length} asset
                    {preview.targets.length === 1 ? '' : 's'}
                    {preview.nextDueAt !== null && ` · next due ${formatDateTime(preview.nextDueAt)}`}
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}

          <TextField
            label="Code"
            required
            placeholder="KIT-FOOD-DAILY"
            helperText="Short, stable and unique. It identifies the rule in every record it raises."
            value={code}
            onChange={(event) => setCode(event.target.value)}
            maxLength={LIMITS.CLEANING_RULE_CODE_MAX}
            disabled={editing}
          />

          <TextField
            label="Task name"
            required
            placeholder="Clean food contact surfaces"
            helperText="What the person doing it will see, with the asset's name appended."
            value={taskName}
            onChange={(event) => setTaskName(event.target.value)}
            maxLength={LIMITS.CLEANING_RULE_TASK_NAME_MAX}
          />

          <TextField
            label="Why it matters"
            multiline
            rows={2}
            placeholder="Prevent cross-contamination between raw and ready-to-eat food"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            maxLength={LIMITS.CLEANING_RULE_PURPOSE_MAX}
          />

          <SelectField
            label="Applies to"
            required
            value={scope}
            onChange={setScope}
            options={[
              { value: CleaningRuleScope.ASSET, label: 'One named thing' },
              { value: CleaningRuleScope.ASSET_TYPE_IN_AREA, label: 'A type, within one area' },
              { value: CleaningRuleScope.ASSET_TYPE_GLOBAL, label: 'A type, everywhere' },
            ]}
          />

          {scope === CleaningRuleScope.ASSET ? (
            <SelectField
              label="Which thing"
              required
              value={cleanableAssetId}
              onChange={setCleanableAssetId}
              emptyLabel="Choose an asset"
              options={(preview?.targets ?? []).map((target) => ({
                value: target.id,
                label: `${target.code} · ${target.name}`,
              }))}
              helperText="Search the register on the Assets tab if the one you want is not listed."
            />
          ) : (
            <SelectField
              label="Which type"
              required
              value={assetTypeId}
              onChange={setAssetTypeId}
              emptyLabel="Choose a type"
              options={(setup?.assetTypes ?? []).map((type) => ({
                value: type.id,
                label: type.name,
              }))}
            />
          )}

          {scope === CleaningRuleScope.ASSET_TYPE_IN_AREA && (
            <SelectField
              label="In which area"
              required
              value={areaId}
              onChange={setAreaId}
              emptyLabel="Choose an area"
              options={(setup?.areas ?? []).map((area) => ({ value: area.id, label: area.name }))}
            />
          )}

          <SelectField
            label="Procedure to follow"
            required
            helperText={
              unpublishedProcedures.length > 0
                ? `${unpublishedProcedures.length} procedure(s) are hidden here because they have never been published.`
                : 'Only published procedures can be used — a draft is a working copy nobody is following.'
            }
            value={procedureId}
            onChange={setProcedureId}
            emptyLabel="Choose a procedure"
            options={publishedProcedures.map((procedure) => ({
              value: procedure.id,
              label: `${procedure.code} · ${procedure.name}`,
            }))}
          />

          <SelectField
            label="How often"
            required
            value={frequencyKind}
            onChange={setFrequencyKind}
            options={Object.values(CleaningFrequencyKind).map((value) => ({
              value,
              label: CLEANING_FREQUENCY_KIND_LABELS[value],
            }))}
          />

          {frequencyKind === CleaningFrequencyKind.PERIODIC && (
            <TextField
              label="Every how many days"
              required
              type="number"
              min={1}
              max={LIMITS.CLEANING_INTERVAL_DAYS_MAX}
              value={intervalDays}
              onChange={(event) => setIntervalDays(event.target.value)}
            />
          )}

          {frequencyKind === CleaningFrequencyKind.WEEKLY && (
            <SelectField
              label="Which day"
              value={dayOfWeek}
              onChange={setDayOfWeek}
              emptyLabel="Any day of the week"
              options={DAYS.map((label, index) => ({ value: String(index), label }))}
            />
          )}

          {frequencyKind === CleaningFrequencyKind.MONTHLY && (
            <TextField
              label="Day of the month"
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={(event) => setDayOfMonth(event.target.value)}
            />
          )}

          {isCalendar ? (
            <TextField
              label="Due by"
              type="time"
              helperText="Leave blank for the end of the day it falls due."
              value={dueTime}
              onChange={(event) => setDueTime(event.target.value)}
            />
          ) : (
            <>
              <TextField
                label="Do it within (minutes)"
                type="number"
                min={1}
                max={LIMITS.CLEANING_DUE_WITHIN_MINUTES_MAX}
                helperText="Counted from the moment the event happens."
                value={dueWithinMinutes}
                onChange={(event) => setDueWithinMinutes(event.target.value)}
              />
              <div>
                <Label className="mb-1.5 block">Raised by</Label>
                <p className="text-muted-foreground mb-2 text-xs">
                  Which operational events make this fall due. Leaving all of them off lets the
                  server pick the one the frequency implies.
                </p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {PUBLISHABLE_TRIGGER_EVENTS.map((event) => (
                    <label key={event} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={triggers.includes(event)}
                        onCheckedChange={(next) => toggleTrigger(event, next === true)}
                      />
                      {CLEANING_TRIGGER_EVENT_LABELS[event]}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          <SelectField
            label="Shift"
            helperText="Ties the occurrence to one shift. Leave blank to use whichever is running."
            value={shiftId}
            onChange={setShiftId}
            emptyLabel="Whichever shift is on"
            options={(setup?.shifts ?? []).map((shift) => ({
              value: shift.id,
              label: `${shift.name} (${shift.startsAt}–${shift.endsAt})`,
            }))}
          />

          <SelectField
            label="Priority"
            value={priority}
            onChange={setPriority}
            options={Object.values(CleaningTaskPriority).map((value) => ({
              value,
              label: CLEANING_TASK_PRIORITY_LABELS[value],
            }))}
          />

          <TextField
            label="How long it takes (minutes)"
            type="number"
            min={0}
            max={LIMITS.CLEANING_ESTIMATED_MINUTES_MAX}
            value={estimatedMinutes}
            onChange={(event) => setEstimatedMinutes(event.target.value)}
          />

          <SelectField
            label="Competence required"
            helperText="The assignment engine will not give this to somebody without it."
            value={skillId}
            onChange={setSkillId}
            emptyLabel="Anybody may do it"
            options={(setup?.skills ?? []).map((skill) => ({
              value: skill.id,
              label: skill.name,
            }))}
          />

          {skillId !== '' && (
            <SelectField
              label="At what level"
              value={skillLevel}
              onChange={setSkillLevel}
              options={Object.values(SkillLevel).map((value) => ({
                value,
                label: SKILL_LEVEL_LABELS[value],
              }))}
            />
          )}

          <SelectField
            label="Restrict to role"
            value={responsibleRole}
            onChange={setResponsibleRole}
            emptyLabel="Anybody on the cleaning roster"
            options={[UserRole.EMPLOYEE, UserRole.USER, UserRole.MANAGER].map((value) => ({
              value,
              label: value,
            }))}
          />

          <SwitchField
            label="Somebody must check it afterwards"
            helperText="Nobody is ever allowed to sign off their own clean."
            checked={requiresVerification}
            onCheckedChange={setRequiresVerification}
          />

          {requiresVerification && (
            <>
              <SelectField
                label="How it is checked"
                required
                value={verificationMethod}
                onChange={setVerificationMethod}
                emptyLabel="Choose a method"
                options={Object.values(CleaningVerificationMethod).map((value) => ({
                  value,
                  label: CLEANING_VERIFICATION_METHOD_LABELS[value],
                }))}
              />
              <SelectField
                label="Who checks it"
                value={verifierRole}
                onChange={setVerifierRole}
                emptyLabel="Any supervisor"
                options={[UserRole.MANAGER, UserRole.ADMIN].map((value) => ({
                  value,
                  label: value,
                }))}
              />
              <SelectField
                label="Against which standard"
                helperText="A standard with a numeric window turns the check into a measurement."
                value={standardId}
                onChange={setStandardId}
                emptyLabel="No numeric standard"
                options={(setup?.standards ?? []).map((standard) => ({
                  value: standard.id,
                  label: standard.name,
                }))}
              />
            </>
          )}

          <SwitchField
            label="Active"
            helperText="Switching a rule off stops it raising anything, without deleting its history."
            checked={isActive}
            onCheckedChange={setIsActive}
          />

          {editing && onRun !== undefined && (
            <Button type="button" variant="outline" onClick={() => void onRun(rule)}>
              <PlayIcon data-icon="inline-start" />
              Run it now
            </Button>
          )}
        </FieldGroup>
      </form>
    </Modal>
  );
}
