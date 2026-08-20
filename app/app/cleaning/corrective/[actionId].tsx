import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  CORRECTIVE_ACTION_STATUS_LABELS,
  Capability,
  CorrectiveActionStatus,
  LIMITS,
  type CleaningCorrectiveActionDto,
} from '@menuboard/shared';
import { cleaningApi, cleaningErrorMessage } from '../../../src/api/cleaning';
import { PressableScale } from '../../../src/components/PressableScale';
import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { TopAppBar } from '../../../src/components/TopAppBar';
import { useCapabilities } from '../../../src/permissions/useCapabilities';
import { radii, spacing, typography } from '../../../src/theme/tokens';
import { useThemeColors } from '../../../src/theme/useThemeColors';
import type { ColorPalette } from '../../../src/theme/tokens';

/**
 * One corrective action: a hygiene check failed, and this is what is being done about it.
 *
 * Until this screen existed the phone could list these and nothing else — the owner of a fix
 * could see it and had to find a desk to record anything, which is how a corrective action ends
 * up closed months later by somebody reconstructing it from memory.
 *
 * The close button is withheld until the root cause and the fix are both written down, because
 * that is exactly what the server refuses without. Offering a button that cannot succeed is the
 * same defect as offering one that does nothing.
 */
export default function CorrectiveActionScreen(): React.JSX.Element {
  const router = useRouter();
  const { actionId } = useLocalSearchParams<{ actionId: string }>();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { has } = useCapabilities();
  const canManage = has(Capability.CLEANING_CORRECTIVE_ACTION_MANAGE);

  const [action, setAction] = useState<CleaningCorrectiveActionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [immediate, setImmediate] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [corrective, setCorrective] = useState('');
  const [preventive, setPreventive] = useState('');
  const [closureNote, setClosureNote] = useState('');

  /** The server's copy is the truth; the fields are re-seeded from every response. */
  const adopt = useCallback((next: CleaningCorrectiveActionDto): void => {
    setAction(next);
    setImmediate(next.immediateAction ?? '');
    setRootCause(next.rootCause ?? '');
    setCorrective(next.correctiveAction ?? '');
    setPreventive(next.preventiveAction ?? '');
    setClosureNote(next.closureNote ?? '');
  }, []);

  const load = useCallback(async (): Promise<void> => {
    if (typeof actionId !== 'string') return;
    setError(null);
    try {
      adopt(await cleaningApi.getCorrectiveAction(actionId));
    } catch (caught) {
      setError(cleaningErrorMessage(caught, 'That corrective action could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [actionId, adopt]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // The "Saved" line is a confirmation, not a state — it goes away on its own so it can never be
  // read as the current status of something edited since.
  useEffect(() => {
    if (!saved) return undefined;
    const handle = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(handle);
  }, [saved]);

  const trimmedOrNull = (value: string): string | null =>
    value.trim() === '' ? null : value.trim();

  async function save(status?: CorrectiveActionStatus): Promise<void> {
    if (typeof actionId !== 'string') return;
    setBusy(true);
    setError(null);
    try {
      adopt(
        await cleaningApi.updateCorrectiveAction(actionId, {
          immediateAction: trimmedOrNull(immediate),
          rootCause: trimmedOrNull(rootCause),
          correctiveAction: trimmedOrNull(corrective),
          preventiveAction: trimmedOrNull(preventive),
          closureNote: trimmedOrNull(closureNote),
          ...(status !== undefined ? { status } : {}),
        }),
      );
      setSaved(true);
    } catch (caught) {
      setError(cleaningErrorMessage(caught, 'That could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <TopAppBar title="Fix" onBack={() => router.back()} />
        <ActivityIndicator style={styles.loader} color={colors.primary} />
      </View>
    );
  }

  if (action === null) {
    return (
      <View style={styles.screen}>
        <TopAppBar title="Fix" onBack={() => router.back()} />
        <Text style={styles.errorText}>{error ?? 'That corrective action no longer exists.'}</Text>
      </View>
    );
  }

  const isClosed =
    action.status === CorrectiveActionStatus.CLOSED ||
    action.status === CorrectiveActionStatus.CANCELLED;
  const editable = canManage && !isClosed;
  /** The server's own precondition for closing, checked here so the button is honest. */
  const closable = rootCause.trim() !== '' && corrective.trim() !== '';

  return (
    <View style={styles.screen}>
      <TopAppBar title="Fix" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {error !== null ? (
          <View style={styles.errorBar}>
            <MaterialIcons name="error-outline" size={18} color={colors.onErrorContainer} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.header}>
          <Text style={styles.title}>{action.failureSummary}</Text>
          <Text style={styles.meta}>{action.cleanableAssetName ?? action.areaName ?? '—'}</Text>
          <View style={styles.headerChips}>
            <View style={styles.chip}>
              <Text style={styles.chipText}>{CORRECTIVE_ACTION_STATUS_LABELS[action.status]}</Text>
            </View>
            {action.dueAt !== null ? (
              <Text style={[styles.meta, action.isOverdue ? { color: colors.error } : null]}>
                {action.isOverdue ? 'Overdue' : 'Due'} {formatWhen(action.dueAt)}
              </Text>
            ) : null}
          </View>
          <Text style={styles.meta}>
            Owner: {action.assignedToName ?? 'nobody yet'}
            {action.raisedByName !== null ? ` · raised by ${action.raisedByName}` : ''}
          </Text>
        </View>

        <PressableScale
          onPress={() =>
            router.push({ pathname: '/cleaning/[taskId]', params: { taskId: action.taskId } })
          }
          accessibilityRole="button"
          accessibilityLabel="Open the cleaning task this came from"
        >
          <View style={styles.linkRow}>
            <MaterialIcons name="cleaning-services" size={20} color={colors.onSurfaceVariant} />
            <Text style={styles.linkText} numberOfLines={1}>
              {action.taskName ?? 'The cleaning task this came from'}
            </Text>
            <MaterialIcons name="chevron-right" size={22} color={colors.onSurfaceVariant} />
          </View>
        </PressableScale>

        {!canManage ? (
          <View style={styles.notice}>
            <MaterialIcons name="lock-outline" size={18} color={colors.onSurfaceVariant} />
            <Text style={styles.meta}>
              You can read this, but recording the cause and closing it is a supervisor&apos;s job.
            </Text>
          </View>
        ) : null}

        <Field
          label="What was done straight away"
          placeholder="Taken out of use and re-sanitised"
          value={immediate}
          onChangeText={setImmediate}
          editable={editable}
          maxLength={LIMITS.CLEANING_CORRECTIVE_ACTION_TEXT_MAX}
        />
        <Field
          label="Why it happened"
          hint="Needed before this can be closed."
          placeholder="The sanitiser dosing pump was set to half strength"
          value={rootCause}
          onChangeText={setRootCause}
          editable={editable}
          maxLength={LIMITS.CLEANING_CORRECTIVE_ACTION_TEXT_MAX}
        />
        <Field
          label="What was done about it"
          hint="Needed before this can be closed."
          placeholder="Pump recalibrated and the reading checked against the standard"
          value={corrective}
          onChangeText={setCorrective}
          editable={editable}
          maxLength={LIMITS.CLEANING_CORRECTIVE_ACTION_TEXT_MAX}
        />
        <Field
          label="What stops it happening again"
          placeholder="Dosing added to the weekly equipment check"
          value={preventive}
          onChangeText={setPreventive}
          editable={editable}
          maxLength={LIMITS.CLEANING_CORRECTIVE_ACTION_TEXT_MAX}
        />
        <Field
          label="Closing note"
          placeholder="Rechecked at 200ppm on the next clean"
          value={closureNote}
          onChangeText={setClosureNote}
          editable={editable}
          maxLength={LIMITS.CLEANING_CORRECTIVE_CLOSURE_NOTE_MAX}
        />

        {saved ? <Text style={styles.savedText}>Saved.</Text> : null}

        {isClosed ? (
          <Text style={styles.meta}>
            Closed{action.closedByName !== null ? ` by ${action.closedByName}` : ''}
            {action.closedAt !== null ? ` · ${formatWhen(action.closedAt)}` : ''}
          </Text>
        ) : null}

        {editable ? (
          <View style={styles.actions}>
            <PrimaryButton
              variant="secondary"
              label="Save"
              loading={busy}
              onPress={() => void save()}
            />
            {action.status === CorrectiveActionStatus.OPEN ? (
              <PrimaryButton
                variant="ghost"
                label="Start"
                disabled={busy}
                onPress={() => void save(CorrectiveActionStatus.IN_PROGRESS)}
              />
            ) : null}
            <PrimaryButton
              label="Close it"
              loading={busy}
              disabled={!closable}
              onPress={() => void save(CorrectiveActionStatus.CLOSED)}
            />
          </View>
        ) : null}

        {editable && !closable ? (
          <Text style={styles.meta}>
            Write why it happened and what was done before closing it — a fix closed without a
            cause records that something went wrong and nothing was learned.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  hint,
  placeholder,
  value,
  onChangeText,
  editable,
  maxLength,
}: {
  label: string;
  hint?: string;
  placeholder: string;
  value: string;
  onChangeText: (next: string) => void;
  editable: boolean;
  maxLength: number;
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {hint !== undefined ? <Text style={styles.meta}>{hint}</Text> : null}
      {editable ? (
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={colors.onSurfaceVariant}
          value={value}
          onChangeText={onChangeText}
          multiline
          maxLength={maxLength}
        />
      ) : (
        <Text style={styles.body14}>{value === '' ? 'Nothing recorded' : value}</Text>
      )}
    </View>
  );
}

/** Local wall-clock, because a due date means the reader's day. */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
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
      borderRadius: radii.full,
      paddingHorizontal: spacing[2],
      paddingVertical: spacing[0.5],
      backgroundColor: colors.secondaryContainer,
    },
    chipText: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      color: colors.onSecondaryContainer,
    },
    meta: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.onSurfaceVariant,
    },
    body14: {
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.onSurface,
    },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      borderRadius: radii.lg,
      padding: spacing[3],
      backgroundColor: colors.surfaceContainerLow,
    },
    linkText: {
      flex: 1,
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.onSurface,
    },
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      borderRadius: radii.lg,
      padding: spacing[3],
      backgroundColor: colors.surfaceContainerLow,
    },
    field: { gap: spacing[1] },
    fieldLabel: {
      fontFamily: typography.callout.fontFamily,
      fontSize: typography.callout.size,
      color: colors.onSurface,
    },
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
    savedText: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.primary,
    },
    errorBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      borderRadius: radii.lg,
      padding: spacing[3],
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
