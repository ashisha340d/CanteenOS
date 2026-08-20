import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  CLEANING_TASK_STATUS_LABELS,
  CLEANING_VERIFICATION_METHOD_LABELS,
  CORRECTIVE_ACTION_STATUS_LABELS,
  Capability,
  CleaningStepStatus,
  CleaningVerificationOutcome,
  LIMITS,
  type CleaningAssignmentCandidateDto,
  type CleaningTaskDto,
} from '@menuboard/shared';
import { cleaningApi, cleaningErrorMessage } from '../../src/api/cleaning';
import { equipmentApi } from '../../src/api/equipment';
import { ThemedBottomSheet } from '../../src/components/BottomSheet';
import { PickerSheet } from '../../src/components/PickerSheet';
import { PressableScale } from '../../src/components/PressableScale';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { TopAppBar } from '../../src/components/TopAppBar';
import { dueLabel } from '../../src/components/cleaning/CleaningTaskRow';
import { ReasonSheet } from '../../src/components/cleaning/ReasonSheet';
import { useCapabilities } from '../../src/permissions/useCapabilities';
import { radii, spacing, typography } from '../../src/theme/tokens';
import { useThemeColors } from '../../src/theme/useThemeColors';
import type { ColorPalette } from '../../src/theme/tokens';

/**
 * Doing one cleaning job, on the phone, standing in front of the thing.
 *
 * The screen is the procedure: safety first, then the numbered steps with a tick and a skip on
 * each, then the photo, then the one button that finishes it. Which buttons exist is decided by
 * the server's `canStart` / `canComplete` / `canVerify` flags, so the phone never offers an
 * action the server would refuse.
 *
 * A required step cannot be quietly skipped — skipping asks for a reason, and completion is
 * refused while one is pending. That refusal is the server's; this screen shows it verbatim.
 */
export default function CleaningTaskScreen(): React.JSX.Element {
  const router = useRouter();
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [task, setTask] = useState<CleaningTaskDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [failureReason, setFailureReason] = useState('');
  const [skipping, setSkipping] = useState<{ stepId: string; title: string } | null>(null);

  const { has } = useCapabilities();
  const canAssign = has(Capability.CLEANING_ASSIGN);
  const [assignSheet, setAssignSheet] = useState(false);
  const [peopleSheet, setPeopleSheet] = useState(false);
  const [candidates, setCandidates] = useState<CleaningAssignmentCandidateDto[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [chosen, setChosen] = useState<CleaningAssignmentCandidateDto | null>(null);
  const [assignNote, setAssignNote] = useState('');

  const load = useCallback(async (): Promise<void> => {
    if (typeof taskId !== 'string') return;
    setError(null);
    try {
      setTask(await cleaningApi.getTask(taskId));
    } catch (caught) {
      setError(cleaningErrorMessage(caught, 'That cleaning task could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function run(action: () => Promise<CleaningTaskDto>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setTask(await action());
    } catch (caught) {
      setError(cleaningErrorMessage(caught, 'That could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Takes the photo and binds it to the task in one gesture.
   *
   * Uploaded through the shared media endpoint the equipment module already uses, so there is
   * one blob store and one signed-URL path rather than a second one for cleaning.
   */
  async function attachPhoto(stepId: string | null): Promise<void> {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera needed', 'Allow the camera to attach a photo of the work.');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (shot.canceled || shot.assets[0] === undefined) return;
    const asset = shot.assets[0];

    setBusy(true);
    setError(null);
    try {
      const media = await equipmentApi.uploadMedia({
        uri: asset.uri,
        fileName: asset.fileName ?? `cleaning-${Date.now()}.jpg`,
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
      setTask(
        await cleaningApi.addEvidence(taskId as string, {
          mediaId: media.id,
          kind: 'AFTER',
          ...(stepId !== null ? { stepId } : {}),
        }),
      );
    } catch (caught) {
      setError(cleaningErrorMessage(caught, 'The photo could not be attached.'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Skipping needs a written reason, and `Alert.prompt` does not exist on Android — so the
   * reason is captured in a sheet. Without this the button was a silent no-op and, since the
   * server refuses completion while a mandatory step is pending, the job could not be finished
   * at all.
   */
  /**
   * Opens the assign sheet and asks the server who could take it.
   *
   * The roster is the engine's own scored list, in the engine's own order, so the person a
   * supervisor picks by hand and the person the engine would have picked are judged by the
   * same rules — and the reasons are on screen when they disagree.
   */
  function openAssign(): void {
    setChosen(null);
    setAssignNote('');
    setAssignSheet(true);
    setCandidatesLoading(true);
    void (async () => {
      try {
        setCandidates(await cleaningApi.candidates(taskId as string));
      } catch (caught) {
        setError(cleaningErrorMessage(caught, 'The roster could not be loaded.'));
      } finally {
        setCandidatesLoading(false);
      }
    })();
  }

  /** `null` hands the task back to the pool, which is a decision worth being able to make. */
  async function submitAssign(assignedTo: string | null): Promise<void> {
    setAssignSheet(false);
    await run(() =>
      cleaningApi.assign(taskId as string, {
        assignedTo,
        ...(assignNote.trim() === '' ? {} : { note: assignNote.trim() }),
      }),
    );
    setChosen(null);
    setAssignNote('');
  }

  function confirmSkip(reason: string): void {
    const step = skipping;
    if (step === null) return;
    setSkipping(null);
    void run(() =>
      cleaningApi.recordStep(taskId as string, step.stepId, {
        status: CleaningStepStatus.SKIPPED,
        skipReason: reason,
      }),
    );
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <TopAppBar title="Cleaning" onBack={() => router.back()} />
        <ActivityIndicator style={styles.loader} color={colors.primary} />
      </View>
    );
  }

  if (task === null) {
    return (
      <View style={styles.screen}>
        <TopAppBar title="Cleaning" onBack={() => router.back()} />
        <Text style={styles.errorText}>{error ?? 'That task no longer exists.'}</Text>
      </View>
    );
  }

  const procedure = task.procedure;

  return (
    <View style={styles.screen}>
      <TopAppBar title={task.cleanableAssetName ?? 'Cleaning'} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.body}>
        {error !== null ? (
          <View style={styles.errorBar}>
            <MaterialIcons name="error-outline" size={18} color={colors.onErrorContainer} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.header}>
          <Text style={styles.title}>{task.taskName}</Text>
          <Text style={styles.meta}>{task.locationPath ?? task.areaName}</Text>
          <View style={styles.headerChips}>
            <View style={styles.chip}>
              <Text style={styles.chipText}>{CLEANING_TASK_STATUS_LABELS[task.status]}</Text>
            </View>
            <Text style={[styles.meta, task.isOverdue ? { color: colors.error } : null]}>
              {dueLabel(task.dueAt, task.isOverdue)}
            </Text>
          </View>
        </View>

        <Section title="Who is doing it">
          <Text style={styles.body14}>{task.assignedToName ?? 'Nobody yet'}</Text>
          {task.assignedToName === null ? (
            <Text style={styles.meta}>
              Unowned work is the kind that does not get done. Hand it to somebody.
            </Text>
          ) : null}
          {canAssign && task.isOpen ? (
            <View style={styles.actions}>
              <PrimaryButton
                variant="secondary"
                label={task.assignedToId === null ? 'Assign it' : 'Hand it to someone else'}
                disabled={busy}
                onPress={openAssign}
              />
              {task.assignedToId !== null ? (
                <PrimaryButton
                  variant="ghost"
                  label="Back to the pool"
                  disabled={busy}
                  onPress={() => void submitAssign(null)}
                />
              ) : null}
            </View>
          ) : null}
        </Section>

        {procedure?.safetyNotes !== null && procedure?.safetyNotes !== undefined ? (
          <View style={styles.safety}>
            <MaterialIcons name="warning-amber" size={18} color={colors.onErrorContainer} />
            <Text style={styles.safetyText}>{procedure.safetyNotes}</Text>
          </View>
        ) : null}

        {procedure?.ppeRequired !== null && procedure?.ppeRequired !== undefined ? (
          <Section title="Wear">
            <Text style={styles.body14}>{procedure.ppeRequired}</Text>
          </Section>
        ) : null}

        {procedure?.standardAcceptanceText !== null &&
        procedure?.standardAcceptanceText !== undefined ? (
          <Section title="Clean means">
            <Text style={styles.body14}>{procedure.standardAcceptanceText}</Text>
          </Section>
        ) : null}

        <Section title={`Steps (${task.stepsDone ?? 0}/${task.stepCount ?? 0})`}>
          {(task.steps ?? []).map((step) => {
            const done = step.status === CleaningStepStatus.DONE;
            const skipped = step.status === CleaningStepStatus.SKIPPED;
            return (
              <View key={step.id} style={styles.step}>
                <PressableScale
                  onPress={() => {
                    if (task.canComplete !== true || done) return;
                    void run(() =>
                      cleaningApi.recordStep(taskId as string, step.stepId, {
                        status: CleaningStepStatus.DONE,
                      }),
                    );
                  }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: done }}
                  accessibilityLabel={step.title}
                >
                  <View
                    style={[
                      styles.tick,
                      done ? { backgroundColor: colors.secondaryContainer } : null,
                      skipped ? { backgroundColor: colors.tertiaryFixed } : null,
                    ]}
                  >
                    <MaterialIcons
                      name={done ? 'check' : skipped ? 'redo' : 'radio-button-unchecked'}
                      size={20}
                      color={
                        done
                          ? colors.onSecondaryContainer
                          : skipped
                            ? colors.onTertiaryFixedVariant
                            : colors.onSurfaceVariant
                      }
                    />
                  </View>
                </PressableScale>

                <View style={styles.stepBody}>
                  <Text style={styles.stepTitle}>
                    {step.stepNumber}. {step.title}
                    {step.isMandatory ? <Text style={{ color: colors.error }}> *</Text> : null}
                  </Text>
                  {step.instruction !== null ? (
                    <Text style={styles.meta}>{step.instruction}</Text>
                  ) : null}
                  <Text style={styles.meta}>
                    {[step.chemicalName, step.toolName, step.performedByName]
                      .filter((part) => part !== null && part !== '')
                      .join(' · ')}
                  </Text>
                  {step.skipReason !== null ? (
                    <Text style={[styles.meta, { color: colors.onTertiaryFixedVariant }]}>
                      Skipped: {step.skipReason}
                    </Text>
                  ) : null}

                  {task.canComplete === true && step.status === CleaningStepStatus.PENDING ? (
                    <View style={styles.stepActions}>
                      <PrimaryButton
                        size="sm"
                        variant="ghost"
                        label="Skip"
                        onPress={() =>
                          setSkipping({ stepId: step.stepId, title: step.title })
                        }
                      />
                      {step.requiresPhoto ? (
                        <PrimaryButton
                          size="sm"
                          variant="secondary"
                          label="Photo"
                          onPress={() => void attachPhoto(step.stepId)}
                        />
                      ) : null}
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </Section>

        {(task.evidence ?? []).length > 0 ? (
          <Section title={`Photos (${(task.evidence ?? []).length})`}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.photoRow}>
                {(task.evidence ?? []).map((item) => (
                  <Image key={item.id} source={{ uri: item.url }} style={styles.photo} />
                ))}
              </View>
            </ScrollView>
          </Section>
        ) : null}

        {task.canComplete === true ? (
          <Section title="Finish">
            <TextInput
              style={styles.input}
              placeholder="What you did (optional)"
              placeholderTextColor={colors.onSurfaceVariant}
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={LIMITS.CLEANING_TASK_COMPLETION_NOTE_MAX}
            />
            <View style={styles.actions}>
              <PrimaryButton
                variant="secondary"
                label="Add a photo"
                onPress={() => void attachPhoto(null)}
                disabled={busy}
              />
              <PrimaryButton
                label="Mark as done"
                loading={busy}
                onPress={() =>
                  void run(() =>
                    cleaningApi.complete(taskId as string, note.trim() === '' ? {} : { note: note.trim() }),
                  )
                }
              />
            </View>
          </Section>
        ) : null}

        {task.canStart === true ? (
          <View style={styles.actions}>
            <PrimaryButton
              label="Start"
              loading={busy}
              onPress={() => void run(() => cleaningApi.start(taskId as string))}
            />
          </View>
        ) : null}

        {task.canVerify === true ? (
          <Section
            title="Check the work"
            subtitle={
              task.verificationMethod === null
                ? undefined
                : CLEANING_VERIFICATION_METHOD_LABELS[task.verificationMethod]
            }
          >
            <Text style={styles.meta}>
              Done by {task.completedByName ?? '—'}. Nobody may sign off their own work.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="What is wrong with it (needed to fail it)"
              placeholderTextColor={colors.onSurfaceVariant}
              value={failureReason}
              onChangeText={setFailureReason}
              multiline
              maxLength={LIMITS.CLEANING_VERIFICATION_FAILURE_REASON_MAX}
            />
            <View style={styles.actions}>
              <PrimaryButton
                label="Pass"
                loading={busy}
                onPress={() =>
                  void run(() =>
                    cleaningApi.verify(taskId as string, {
                      outcome: CleaningVerificationOutcome.PASS,
                    }),
                  )
                }
              />
              <PrimaryButton
                variant="danger"
                label="Fail"
                disabled={busy || failureReason.trim() === ''}
                onPress={() =>
                  void run(() =>
                    cleaningApi.verify(taskId as string, {
                      outcome: CleaningVerificationOutcome.FAIL,
                      failureReason: failureReason.trim(),
                    }),
                  )
                }
              />
            </View>
          </Section>
        ) : null}

        {(task.verifications ?? []).length > 0 ? (
          <Section title="Checks">
            {(task.verifications ?? []).map((check) => (
              <Text key={check.id} style={styles.meta}>
                Attempt {check.attempt}: {check.outcome} — {check.verifiedByName ?? '—'}
                {check.failureReason !== null ? ` · ${check.failureReason}` : ''}
              </Text>
            ))}
          </Section>
        ) : null}

        {(task.correctiveActions ?? []).length > 0 ? (
          <Section
            title="Fixes"
            subtitle="Raised by a failed check. Tap one to record what caused it."
          >
            {(task.correctiveActions ?? []).map((action) => (
              <PressableScale
                key={action.id}
                onPress={() =>
                  router.push({
                    pathname: '/cleaning/corrective/[actionId]',
                    params: { actionId: action.id },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={action.failureSummary}
              >
                <View style={styles.linkRow}>
                  <View style={styles.linkBody}>
                    <Text style={styles.body14}>{action.failureSummary}</Text>
                    <Text style={[styles.meta, action.isOverdue ? { color: colors.error } : null]}>
                      {CORRECTIVE_ACTION_STATUS_LABELS[action.status]}
                      {action.assignedToName !== null ? ` · ${action.assignedToName}` : ''}
                      {action.isOverdue ? ' · overdue' : ''}
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={colors.onSurfaceVariant} />
                </View>
              </PressableScale>
            ))}
          </Section>
        ) : null}

        <Section title="History">
          {(task.history ?? []).map((entry) => (
            <Text key={entry.id} style={styles.meta}>
              {CLEANING_TASK_STATUS_LABELS[entry.toStatus]} · {entry.actorName ?? entry.source}
              {entry.note !== null ? ` — ${entry.note}` : ''}
            </Text>
          ))}
        </Section>
      </ScrollView>

      <ReasonSheet
        isOpen={skipping !== null}
        title="Why are you skipping it?"
        subtitle={skipping?.title}
        placeholder="The fryer was still hot"
        confirmLabel="Skip this step"
        maxLength={LIMITS.CLEANING_STEP_SKIP_REASON_MAX}
        busy={busy}
        onConfirm={confirmSkip}
        onClose={() => setSkipping(null)}
      />

      <ThemedBottomSheet
        isOpen={assignSheet}
        // Dropped on dismissal too, not only on open: a note typed here and abandoned would
        // otherwise be filed as the reason for the next assignment, in a record somebody may
        // have to defend.
        onClose={() => {
          setAssignSheet(false);
          setChosen(null);
          setAssignNote('');
        }}
        title="Hand this to somebody"
        scrollable
      >
        <PressableScale
          onPress={() => setPeopleSheet(true)}
          accessibilityRole="button"
          accessibilityLabel="Choose a person"
        >
          <View style={styles.selectRow}>
            <Text
              style={[styles.selectValue, chosen === null ? styles.selectPlaceholder : null]}
              numberOfLines={2}
            >
              {chosen === null
                ? candidatesLoading
                  ? 'Loading the roster…'
                  : 'Nobody chosen'
                : `${chosen.name}${chosen.eligible ? '' : ' — not eligible'}`}
            </Text>
            <MaterialIcons name="expand-more" size={22} color={colors.onSurfaceVariant} />
          </View>
        </PressableScale>

        {chosen !== null && !chosen.eligible ? (
          <Text style={[styles.meta, { color: colors.error }]}>
            {chosen.ineligibleReason ?? 'The engine would not have picked them.'} Assigning anyway
            is recorded against your name.
          </Text>
        ) : null}

        <TextInput
          style={styles.input}
          placeholder="Anything they need to know (optional)"
          placeholderTextColor={colors.onSurfaceVariant}
          value={assignNote}
          onChangeText={setAssignNote}
          multiline
          maxLength={LIMITS.CLEANING_STEP_NOTE_MAX}
        />

        <PrimaryButton
          label="Assign"
          loading={busy}
          disabled={chosen === null}
          onPress={() => void submitAssign(chosen?.userId ?? null)}
        />
      </ThemedBottomSheet>

      <PickerSheet
        isOpen={peopleSheet}
        onClose={() => setPeopleSheet(false)}
        title="Who can take it"
        searchable
        options={candidates.map((candidate) => ({
          id: candidate.userId,
          label: candidate.name,
          subtitle: candidateSubtitle(candidate),
        }))}
        selectedId={chosen?.userId ?? null}
        onSelect={(option) => {
          setChosen(candidates.find((c) => c.userId === option.id) ?? null);
          setPeopleSheet(false);
        }}
      />
    </View>
  );
}

/**
 * Why this person is on the list, in one line.
 *
 * The engine's score is shown rather than hidden because a hand assignment that disagrees with
 * it is a judgement somebody may have to defend — and because "they are already carrying nine
 * jobs" is the sort of thing a supervisor cannot see from the corridor.
 */
function candidateSubtitle(candidate: CleaningAssignmentCandidateDto): string {
  if (!candidate.eligible) {
    return candidate.ineligibleReason ?? 'Not eligible for this task';
  }
  const parts = [
    candidate.onShift ? 'on shift' : 'off shift',
    candidate.isPrimaryForArea
      ? 'primary here'
      : candidate.isAreaResponsible
        ? 'works this area'
        : null,
    `${candidate.openTaskCount} open`,
    candidate.missingSkills.length > 0 ? `missing ${candidate.missingSkills.join(', ')}` : null,
  ].filter((part): part is string => part !== null);
  return parts.join(' · ');
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle !== undefined ? <Text style={styles.meta}>{subtitle}</Text> : null}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: spacing[3], paddingBottom: spacing[16], gap: spacing[3] },
    loader: { marginTop: spacing[8] },
    header: { gap: spacing[0.5] },
    title: {
      fontFamily: typography.headlineLg.fontFamily,
      fontSize: typography.headlineMd.size,
      color: colors.onSurface,
    },
    headerChips: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      marginTop: spacing[1],
    },
    chip: {
      paddingHorizontal: spacing[2],
      paddingVertical: spacing[0.5],
      borderRadius: radii.sm,
      backgroundColor: colors.surfaceContainerHigh,
    },
    chipText: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      letterSpacing: typography.labelCaps.letterSpacing,
      color: colors.onSurfaceVariant,
    },
    meta: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onSurfaceVariant,
    },
    body14: {
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      lineHeight: typography.bodyMd.lineHeight,
      color: colors.onSurface,
    },
    section: {
      padding: spacing[3],
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainerLowest,
      gap: spacing[1],
    },
    sectionTitle: {
      fontFamily: typography.headlineMd.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.onSurface,
    },
    sectionBody: { gap: spacing[2] },
    safety: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing[2],
      padding: spacing[3],
      borderRadius: radii.lg,
      backgroundColor: colors.errorContainer,
    },
    safetyText: {
      flex: 1,
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.onErrorContainer,
    },
    step: { flexDirection: 'row', gap: spacing[3], alignItems: 'flex-start' },
    tick: {
      width: 40,
      height: 40,
      borderRadius: radii.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceContainerHigh,
    },
    stepBody: { flex: 1, gap: spacing[0.5] },
    stepTitle: {
      fontFamily: typography.headlineMd.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.onSurface,
    },
    stepActions: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[1] },
    photoRow: { flexDirection: 'row', gap: spacing[2] },
    photo: { width: 96, height: 96, borderRadius: radii.lg },
    input: {
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      borderRadius: radii.lg,
      padding: spacing[3],
      minHeight: 72,
      textAlignVertical: 'top',
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.onSurface,
      backgroundColor: colors.surfaceContainerLow,
    },
    actions: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[1] },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      paddingVertical: spacing[2],
    },
    linkBody: { flex: 1, gap: spacing[0.5] },
    selectRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing[2],
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      borderRadius: radii.lg,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[3],
      marginBottom: spacing[3],
      backgroundColor: colors.surfaceContainerLow,
    },
    selectValue: {
      flex: 1,
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.onSurface,
    },
    selectPlaceholder: { color: colors.onSurfaceVariant },
    errorBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      padding: spacing[3],
      borderRadius: radii.lg,
      backgroundColor: colors.errorContainer,
    },
    errorText: {
      flex: 1,
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.onErrorContainer,
    },
  });
}
