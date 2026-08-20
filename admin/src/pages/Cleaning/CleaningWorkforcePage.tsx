import { useState } from 'react';
import {
  CLEANING_ASSIGNMENT_STRATEGY_LABELS,
  Capability,
  CleaningAssignmentStrategy,
  LIMITS,
  SKILL_LEVEL_LABELS,
  SkillLevel,
  type CleaningAssignmentRuleDto,
  type CleaningWorkforceMemberDto,
} from '@menuboard/shared';
import { PlusIcon, XIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldGroup, SelectField, SwitchField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TONE_CHIP_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/notify';
import { readError } from '../../services/errorMessage';
import { useAuth } from '../../services/AuthContext';
import {
  useAssignShift,
  useAssignmentPolicies,
  useCleaningRoster,
  useCleaningSetup,
  useGrantSkill,
  useRemoveAreaResponsibility,
  useRemoveShift,
  useRevokeSkill,
  useSaveAssignmentPolicy,
  useSetAreaResponsibility,
} from '../../hooks/useCleaning';
import { formatDate } from './cleaningTone';

/**
 * Who can clean what, when — and the policy the assignment engine follows.
 *
 * This page is the difference between an engine that assigns sensibly and one that hands a
 * mixer strip-down to whoever happens to be idle. Everything here is read by
 * `CleaningAssignmentService` on every task it raises.
 */
export function CleaningWorkforcePage(): JSX.Element {
  const { hasCapability } = useAuth();
  const canManage = hasCapability(Capability.CLEANING_WORKFORCE_MANAGE);

  return (
    <>
      <PageHeader title="Cleaning workforce" />
      <Tabs defaultValue="people" className="flex min-h-0 flex-col gap-3">
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="policies">Assignment policy</TabsTrigger>
        </TabsList>
        <TabsContent value="people" className="mt-0">
          <RosterTab canManage={canManage} />
        </TabsContent>
        <TabsContent value="policies" className="mt-0">
          <PolicyTab canManage={canManage} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/* ----------------------------------------------------------------------- roster */

function RosterTab({ canManage }: { canManage: boolean }): JSX.Element {
  const { data: roster, isLoading } = useCleaningRoster();
  const [editing, setEditing] = useState<CleaningWorkforceMemberDto | null>(null);

  if (isLoading) {
    return <p className="text-muted-foreground py-8 text-center text-sm">Loading the roster…</p>;
  }

  return (
    <>
      <p className="text-muted-foreground mb-3 text-xs">
        The engine will not give somebody work they are not qualified for, and by default will
        not give it to somebody who is off shift. Nothing here is cosmetic.
      </p>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(roster ?? []).map((member) => (
          <article key={member.userId} className="bg-card rounded-xl border p-4">
            <header className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{member.name}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {member.username} · {member.role}
                </p>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                  TONE_CHIP_CLASS[member.onShiftNow ? 'success' : 'muted'],
                )}
              >
                {member.onShiftNow ? 'On shift' : 'Off shift'}
              </span>
            </header>

            <dl className="mb-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Open tasks</dt>
              <dd className="text-right tabular-nums">{member.openTaskCount}</dd>
              <dt className="text-muted-foreground">Overdue</dt>
              <dd
                className={cn(
                  'text-right tabular-nums',
                  member.overdueTaskCount > 0 && 'text-tone-danger font-medium',
                )}
              >
                {member.overdueTaskCount}
              </dd>
            </dl>

            <Row label="Skills">
              {member.skills.length === 0 ? (
                <span className="text-muted-foreground text-xs">none</span>
              ) : (
                member.skills.map((skill) => (
                  <span
                    key={skill.skillId}
                    className={cn(
                      'rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                      TONE_CHIP_CLASS[skill.isExpired ? 'danger' : 'info'],
                    )}
                    title={
                      skill.certifiedUntil === null
                        ? undefined
                        : `Certified until ${formatDate(skill.certifiedUntil)}`
                    }
                  >
                    {skill.skillName} · {SKILL_LEVEL_LABELS[skill.level]}
                    {skill.isExpired && ' (lapsed)'}
                  </span>
                ))
              )}
            </Row>

            <Row label="Shifts">
              {member.shifts.filter((shift) => shift.isCurrent).length === 0 ? (
                <span className="text-muted-foreground text-xs">none</span>
              ) : (
                member.shifts
                  .filter((shift) => shift.isCurrent)
                  .map((shift) => (
                    <span
                      key={shift.id}
                      className={cn(
                        'rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                        TONE_CHIP_CLASS.neutral,
                      )}
                    >
                      {shift.shiftName}
                    </span>
                  ))
              )}
            </Row>

            <Row label="Areas">
              {member.areas.length === 0 ? (
                <span className="text-muted-foreground text-xs">none</span>
              ) : (
                member.areas.map((area) => (
                  <span
                    key={area.areaId}
                    className={cn(
                      'rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                      TONE_CHIP_CLASS[area.isPrimary ? 'success' : 'neutral'],
                    )}
                  >
                    {area.areaName}
                    {area.isPrimary && ' ★'}
                  </span>
                ))
              )}
            </Row>

            {canManage && (
              <Button
                size="sm"
                variant="outline"
                className="mt-3 w-full"
                onClick={() => setEditing(member)}
              >
                Edit
              </Button>
            )}
          </article>
        ))}
      </div>

      {editing !== null && (
        <MemberModal member={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-1.5">
      <p className="text-muted-foreground text-[0.7188rem] tracking-[0.06em] uppercase">{label}</p>
      <div className="mt-0.5 flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- member editor */

function MemberModal({
  member,
  onClose,
}: {
  member: CleaningWorkforceMemberDto;
  onClose: () => void;
}): JSX.Element {
  const { data: setup } = useCleaningSetup();
  const grantSkill = useGrantSkill();
  const revokeSkill = useRevokeSkill();
  const assignShift = useAssignShift();
  const removeShift = useRemoveShift();
  const setArea = useSetAreaResponsibility();
  const removeArea = useRemoveAreaResponsibility();

  const [skillId, setSkillId] = useState('');
  const [level, setLevel] = useState<string>(SkillLevel.BASIC);
  const [certifiedUntil, setCertifiedUntil] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [areaId, setAreaId] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, message: string): Promise<void> {
    setError(null);
    try {
      await action();
      notify.success(message);
    } catch (err) {
      const text = readError(err).message;
      setError(text);
      notify.error(text);
    }
  }

  return (
    <Modal
      id="cleaning-workforce-member"
      title={member.name}
      description="What they are qualified for, when they work, and which areas are theirs."
      open
      onClose={onClose}
      minWidth={560}
      footer={<Button variant="outline" onClick={onClose}>Close</Button>}
    >
      <div className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <section>
          <h3 className="font-heading mb-1 text-sm font-semibold">Skills</h3>
          <ul className="divide-border mb-2 divide-y rounded-md border">
            {member.skills.length === 0 && (
              <li className="text-muted-foreground px-3 py-2 text-sm">
                Nothing yet. A rule requiring a competence will never be given to them.
              </li>
            )}
            {member.skills.map((skill) => (
              <li key={skill.skillId} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-sm">
                  {skill.skillName} · {SKILL_LEVEL_LABELS[skill.level]}
                  {skill.certifiedUntil !== null && (
                    <span className={cn('ml-1 text-xs', skill.isExpired && 'text-tone-danger')}>
                      until {formatDate(skill.certifiedUntil)}
                    </span>
                  )}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Revoke ${skill.skillName}`}
                  onClick={() =>
                    run(
                      () =>
                        revokeSkill.mutateAsync({
                          userId: member.userId,
                          skillId: skill.skillId,
                        }),
                      'Skill revoked.',
                    )
                  }
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
          <FieldGroup>
            <SelectField
              label="Grant a skill"
              value={skillId}
              onChange={setSkillId}
              emptyLabel="Choose a skill"
              options={(setup?.skills ?? []).map((skill) => ({
                value: skill.id,
                label: skill.name,
              }))}
            />
            <SelectField
              label="Level"
              value={level}
              onChange={setLevel}
              options={Object.values(SkillLevel).map((value) => ({
                value,
                label: SKILL_LEVEL_LABELS[value],
              }))}
            />
            <TextField
              label="Certified until"
              type="date"
              helperText="A lapsed certificate stops satisfying a rule that requires the skill."
              value={certifiedUntil}
              onChange={(event) => setCertifiedUntil(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={skillId === '' || grantSkill.isPending}
              onClick={() =>
                run(
                  () =>
                    grantSkill.mutateAsync({
                      userId: member.userId,
                      body: {
                        skillId,
                        level: level as SkillLevel,
                        ...(certifiedUntil !== '' ? { certifiedUntil } : {}),
                      },
                    }),
                  'Skill granted.',
                )
              }
            >
              <PlusIcon data-icon="inline-start" />
              Grant
            </Button>
          </FieldGroup>
        </section>

        <section>
          <h3 className="font-heading mb-1 text-sm font-semibold">Shifts</h3>
          <ul className="divide-border mb-2 divide-y rounded-md border">
            {member.shifts.length === 0 && (
              <li className="text-muted-foreground px-3 py-2 text-sm">
                Nobody off shift is given work by default.
              </li>
            )}
            {member.shifts.map((shift) => (
              <li key={shift.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-sm">
                  {shift.shiftName}
                  <span className="text-muted-foreground ml-1 text-xs">
                    from {formatDate(shift.effectiveFrom)}
                    {shift.effectiveTo !== null && ` to ${formatDate(shift.effectiveTo)}`}
                  </span>
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Remove shift"
                  onClick={() =>
                    run(
                      () =>
                        removeShift.mutateAsync({
                          userId: member.userId,
                          assignmentId: shift.id,
                        }),
                      'Shift removed.',
                    )
                  }
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
          <FieldGroup>
            <SelectField
              label="Put them on a shift"
              value={shiftId}
              onChange={setShiftId}
              emptyLabel="Choose a shift"
              options={(setup?.shifts ?? []).map((shift) => ({
                value: shift.id,
                label: `${shift.name} (${shift.startsAt}–${shift.endsAt})`,
              }))}
            />
            <TextField
              label="From"
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={shiftId === '' || assignShift.isPending}
              onClick={() =>
                run(
                  () =>
                    assignShift.mutateAsync({
                      userId: member.userId,
                      body: { shiftId, effectiveFrom },
                    }),
                  'Shift assigned.',
                )
              }
            >
              <PlusIcon data-icon="inline-start" />
              Assign
            </Button>
          </FieldGroup>
        </section>

        <section>
          <h3 className="font-heading mb-1 text-sm font-semibold">Areas</h3>
          <ul className="divide-border mb-2 divide-y rounded-md border">
            {member.areas.length === 0 && (
              <li className="text-muted-foreground px-3 py-2 text-sm">
                The area's own person is picked first by the default policy.
              </li>
            )}
            {member.areas.map((area) => (
              <li key={area.areaId} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-sm">
                  {area.areaName}
                  {area.isPrimary && (
                    <span className="text-muted-foreground ml-1 text-xs">primary</span>
                  )}
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Remove area"
                  onClick={() =>
                    run(
                      () =>
                        removeArea.mutateAsync({
                          userId: member.userId,
                          areaId: area.areaId,
                        }),
                      'Area removed.',
                    )
                  }
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
          <FieldGroup>
            <SelectField
              label="Make them responsible for"
              value={areaId}
              onChange={setAreaId}
              emptyLabel="Choose an area"
              options={(setup?.areas ?? []).map((area) => ({ value: area.id, label: area.name }))}
            />
            <SwitchField
              label="Primary"
              helperText="The first person the engine considers for anything in that area."
              checked={isPrimary}
              onCheckedChange={setIsPrimary}
            />
            <Button
              type="button"
              variant="outline"
              disabled={areaId === '' || setArea.isPending}
              onClick={() =>
                run(
                  () =>
                    setArea.mutateAsync({
                      userId: member.userId,
                      body: { areaId, isPrimary },
                    }),
                  'Area responsibility saved.',
                )
              }
            >
              <PlusIcon data-icon="inline-start" />
              Save
            </Button>
          </FieldGroup>
        </section>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------------- policies */

function PolicyTab({ canManage }: { canManage: boolean }): JSX.Element {
  const { data: policies, isLoading } = useAssignmentPolicies();
  const { data: setup } = useCleaningSetup();
  const save = useSaveAssignmentPolicy();

  const [open, setOpen] = useState(false);
  const [areaId, setAreaId] = useState('');
  const [strategy, setStrategy] = useState<string>(
    CleaningAssignmentStrategy.PRIMARY_RESPONSIBLE_FIRST,
  );
  const [requireSkillMatch, setRequireSkillMatch] = useState(true);
  const [requireShiftMatch, setRequireShiftMatch] = useState(true);
  const [requireAreaMatch, setRequireAreaMatch] = useState(false);
  const [maxOpenTasks, setMaxOpenTasks] = useState('10');
  const [allowRelaxedFallback, setAllowRelaxedFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start(existing: CleaningAssignmentRuleDto | null): void {
    setAreaId(existing?.areaId ?? '');
    setStrategy(existing?.strategy ?? CleaningAssignmentStrategy.PRIMARY_RESPONSIBLE_FIRST);
    setRequireSkillMatch(existing?.requireSkillMatch ?? true);
    setRequireShiftMatch(existing?.requireShiftMatch ?? true);
    setRequireAreaMatch(existing?.requireAreaMatch ?? false);
    setMaxOpenTasks(String(existing?.maxOpenTasks ?? 10));
    setAllowRelaxedFallback(existing?.allowRelaxedFallback ?? false);
    setError(null);
    setOpen(true);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await save.mutateAsync({
        areaId: areaId === '' ? null : areaId,
        strategy: strategy as CleaningAssignmentStrategy,
        requireSkillMatch,
        requireShiftMatch,
        requireAreaMatch,
        maxOpenTasks: Number(maxOpenTasks),
        allowRelaxedFallback,
      });
      notify.success('Policy saved.');
      setOpen(false);
    } catch (err) {
      setError(readError(err).message);
    }
  }

  if (isLoading) return <p className="text-muted-foreground py-8 text-center text-sm">Loading…</p>;

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground max-w-prose text-xs">
          How the engine breaks a tie between people who could all take a job. The policy with no
          area is the fallback everywhere else uses.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => start(null)}>
            <PlusIcon data-icon="inline-start" />
            Policy for an area
          </Button>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(policies ?? []).map((policy) => (
          <article key={policy.id} className="bg-card rounded-xl border p-4">
            <p className="text-sm font-semibold">
              {policy.areaName ?? 'Everywhere else (fallback)'}
            </p>
            <p className="text-muted-foreground mb-2 text-xs">
              {CLEANING_ASSIGNMENT_STRATEGY_LABELS[policy.strategy]}
            </p>
            <ul className="space-y-0.5 text-xs">
              <li>Must hold the skill: {policy.requireSkillMatch ? 'yes' : 'no'}</li>
              <li>Must be on shift: {policy.requireShiftMatch ? 'yes' : 'no'}</li>
              <li>Must own the area: {policy.requireAreaMatch ? 'yes' : 'no'}</li>
              <li>Ceiling: {policy.maxOpenTasks} open tasks</li>
              <li>
                If nobody qualifies:{' '}
                {policy.allowRelaxedFallback
                  ? 'try again ignoring shift and area'
                  : 'leave it for a supervisor'}
              </li>
            </ul>
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                className="mt-3 w-full"
                onClick={() => start(policy)}
              >
                Edit
              </Button>
            )}
          </article>
        ))}
      </div>

      <Modal
        id="cleaning-assignment-policy"
        title={areaId === '' ? 'Fallback assignment policy' : 'Area assignment policy'}
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <FormModalFooter
            formId="assignment-policy-form"
            onCancel={() => setOpen(false)}
            submitting={save.isPending}
          />
        }
      >
        <form id="assignment-policy-form" onSubmit={submit}>
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <SelectField
              label="Applies to"
              value={areaId}
              onChange={setAreaId}
              emptyLabel="Everywhere with no policy of its own"
              options={(setup?.areas ?? []).map((area) => ({ value: area.id, label: area.name }))}
            />
            <SelectField
              label="Break ties by"
              value={strategy}
              onChange={setStrategy}
              options={Object.values(CleaningAssignmentStrategy).map((value) => ({
                value,
                label: CLEANING_ASSIGNMENT_STRATEGY_LABELS[value],
              }))}
            />
            <SwitchField
              label="Must hold the required competence"
              helperText="Turning this off lets uncertified people be given qualified work."
              checked={requireSkillMatch}
              onCheckedChange={setRequireSkillMatch}
            />
            <SwitchField
              label="Must be on shift"
              checked={requireShiftMatch}
              onCheckedChange={setRequireShiftMatch}
            />
            <SwitchField
              label="Must be responsible for the area"
              checked={requireAreaMatch}
              onCheckedChange={setRequireAreaMatch}
            />
            <TextField
              label="Open-task ceiling"
              type="number"
              min={1}
              max={LIMITS.CLEANING_MAX_OPEN_TASKS_CEILING}
              helperText="Beyond this many open cleaning tasks, the engine skips a candidate."
              value={maxOpenTasks}
              onChange={(event) => setMaxOpenTasks(event.target.value)}
            />
            <SwitchField
              label="If nobody qualifies, relax shift and area"
              helperText="Never relaxes the skill requirement. Off by default: a supervisor deciding beats a bad guess."
              checked={allowRelaxedFallback}
              onCheckedChange={setAllowRelaxedFallback}
            />
          </FieldGroup>
        </form>
      </Modal>
    </>
  );
}
