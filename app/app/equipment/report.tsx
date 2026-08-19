import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type {
  EquipmentDto,
  MaintenanceAttachmentKind,
  MaintenancePriority,
  ProblemCategory,
} from '@menuboard/shared';
import {
  Capability,
  CaptureSource,
  LIMITS,
  MAINTENANCE_PRIORITY_LABELS,
  MEDIA,
  MaintenanceAttachmentKind as AttachmentKind,
  MaintenancePriority as Priority,
  PROBLEM_CATEGORY_LABELS,
  ProblemCategory as Category,
} from '@menuboard/shared';
import { equipmentApi, equipmentErrorMessage, maintenanceApi } from '../../src/api/equipment';
import { useCapabilities } from '../../src/permissions/useCapabilities';
import { useVoiceNoteRecorder } from '../../src/hooks/useVoiceNoteRecorder';
import { EmptyState } from '../../src/components/EmptyState';
import { FormInput } from '../../src/components/FormInput';
import { PickerSheet } from '../../src/components/PickerSheet';
import { PressableScale } from '../../src/components/PressableScale';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { TopAppBar } from '../../src/components/TopAppBar';
import { ChoiceChips, type Choice } from '../../src/components/equipment/ChoiceChips';
import { pickEquipmentPhoto, pickEquipmentVideo } from '../../src/utils/attachmentPicker';
import { isUuid } from '../../src/utils/uuid';
import { radii, spacing, typography } from '../../src/theme/tokens';
import { useThemeColors } from '../../src/theme/useThemeColors';

/**
 * Reporting a problem, in as few taps as the situation allows.
 *
 * Arriving from an asset (`?equipmentId=`) the screen is already pointed at the right machine, so
 * the whole job is one category chip and one button — two taps. Everything else on the screen is
 * optional detail for the cases that need it.
 *
 * Nothing the system already knows is asked for: location, supplier, reporter, timestamps and
 * the default priority are all resolved server-side from the equipment record.
 */

const CATEGORY_CHOICES: readonly Choice<ProblemCategory>[] = [
  { value: Category.NOT_WORKING, label: PROBLEM_CATEGORY_LABELS.NOT_WORKING, icon: 'power-off' },
  { value: Category.ABNORMAL_NOISE, label: PROBLEM_CATEGORY_LABELS.ABNORMAL_NOISE, icon: 'graphic-eq' },
  { value: Category.TEMPERATURE, label: PROBLEM_CATEGORY_LABELS.TEMPERATURE, icon: 'thermostat' },
  { value: Category.LEAKAGE, label: PROBLEM_CATEGORY_LABELS.LEAKAGE, icon: 'water-drop' },
  { value: Category.ELECTRICAL, label: PROBLEM_CATEGORY_LABELS.ELECTRICAL, icon: 'bolt' },
  { value: Category.PHYSICAL_DAMAGE, label: PROBLEM_CATEGORY_LABELS.PHYSICAL_DAMAGE, icon: 'broken-image' },
  { value: Category.PERFORMANCE, label: PROBLEM_CATEGORY_LABELS.PERFORMANCE, icon: 'trending-down' },
  { value: Category.CLEANING, label: PROBLEM_CATEGORY_LABELS.CLEANING, icon: 'cleaning-services' },
  { value: Category.SAFETY, label: PROBLEM_CATEGORY_LABELS.SAFETY, icon: 'warning' },
  { value: Category.OTHER, label: PROBLEM_CATEGORY_LABELS.OTHER, icon: 'more-horiz' },
];

const PRIORITY_CHOICES: readonly Choice<MaintenancePriority>[] = [
  { value: Priority.LOW, label: MAINTENANCE_PRIORITY_LABELS.LOW },
  { value: Priority.NORMAL, label: MAINTENANCE_PRIORITY_LABELS.NORMAL },
  { value: Priority.HIGH, label: MAINTENANCE_PRIORITY_LABELS.HIGH },
  { value: Priority.CRITICAL, label: MAINTENANCE_PRIORITY_LABELS.CRITICAL },
];

interface Attachment {
  mediaId: string;
  kind: MaintenanceAttachmentKind;
  /** Local preview for a photo; voice notes show a waveform-free duration row instead. */
  uri: string;
  durationMs?: number;
}

/** Seconds:centiseconds while recording — the same read-out the board composer uses. */
function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function ReportProblemScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ equipmentId?: string }>();
  const router = useRouter();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { has } = useCapabilities();
  const recorder = useVoiceNoteRecorder();

  // Attaching a photo or a voice note to a report needs the same capability as making the
  // report: `POST /equipment/media` is gated on `equipment.report_problem`, because a cook who
  // may report a fault must be able to show it. `equipment.upload_document` is a different
  // thing — binding a warranty card to an asset — and starts higher up.
  const canReport = has(Capability.EQUIPMENT_REPORT_PROBLEM);

  const [equipment, setEquipment] = useState<EquipmentDto | null>(null);
  const [candidates, setCandidates] = useState<EquipmentDto[]>([]);
  const [equipmentSheet, setEquipmentSheet] = useState(false);
  const [category, setCategory] = useState<ProblemCategory | null>(null);
  const [priority, setPriority] = useState<MaintenancePriority | null>(null);
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const [aiCategory, setAiCategory] = useState<ProblemCategory | null>(null);
  const [aiPriority, setAiPriority] = useState<MaintenancePriority | null>(null);
  const [aiConfidence, setAiConfidence] = useState<number | null>(null);
  const [aiAction, setAiAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'photo' | 'video' | 'voice' | 'thinking' | 'saving'>(
    null,
  );

  const requestedId = params.equipmentId;
  const arrivedWithAsset = requestedId !== undefined && requestedId !== '';
  /** Falls back to the picker when the caller named no asset, or naming one did not work. */
  const [needsPicker, setNeedsPicker] = useState(!arrivedWithAsset);

  useEffect(() => {
    if (!arrivedWithAsset) return;
    void (async () => {
      try {
        setEquipment(
          isUuid(requestedId)
            ? await equipmentApi.getById(requestedId)
            : await equipmentApi.resolve(requestedId),
        );
      } catch (caught) {
        setError(equipmentErrorMessage(caught, 'That equipment could not be loaded — pick it below.'));
        setNeedsPicker(true);
      }
    })();
  }, [arrivedWithAsset, requestedId]);

  // Only fetched when the reporter has to pick the machine themselves.
  useEffect(() => {
    if (!needsPicker) return;
    void (async () => {
      try {
        const page = await equipmentApi.list({ pageSize: 50 });
        setCandidates(page.items);
      } catch (caught) {
        setError(equipmentErrorMessage(caught, 'The equipment list could not be loaded.'));
      }
    })();
  }, [needsPicker]);

  /** Runs the classifier over whatever the reporter has supplied so far. */
  const classify = useCallback(
    async (input: { mediaId?: string; text?: string }): Promise<void> => {
      setBusy('thinking');
      setNotice(null);
      try {
        const draft = await equipmentApi.classifyProblem({
          equipmentId: equipment?.id ?? null,
          ...(input.text === undefined ? {} : { text: input.text }),
          ...(input.mediaId === undefined ? {} : { mediaId: input.mediaId }),
        });
        setAiCategory(draft.category);
        setAiPriority(draft.priority);
        setAiConfidence(draft.confidence);
        setAiAction(draft.suggestedAction);
        setCategory((current) => current ?? draft.category);
        setPriority((current) => current ?? draft.priority);
        const spoken = draft.transcript ?? draft.description;
        setDescription((current) => (current.trim() === '' ? spoken : current));
      } catch (caught) {
        setNotice(
          equipmentErrorMessage(
            caught,
            'The description could not be read automatically. Pick a category yourself.',
          ),
        );
      } finally {
        setBusy(null);
      }
    },
    [equipment],
  );

  const addPhoto = useCallback(
    async (source: 'camera' | 'library'): Promise<void> => {
      setError(null);
      const picked = await pickEquipmentPhoto(source);
      if (picked === null) return;
      setBusy('photo');
      try {
        const media = await equipmentApi.uploadMedia({
          uri: picked.uri,
          fileName: picked.fileName,
          mimeType: picked.mimeType,
        });
        setAttachments((current) => [
          ...current,
          { mediaId: media.id, kind: AttachmentKind.PHOTO, uri: picked.uri },
        ]);
        setBusy(null);
        await classify({ mediaId: media.id });
      } catch (caught) {
        setBusy(null);
        setError(equipmentErrorMessage(caught, 'The photo could not be uploaded.'));
      }
    },
    [classify],
  );

  /**
   * A clip of the fault.
   *
   * Not passed to the classifier: `POST /equipment/ai/classify-problem` reads a photo or a voice
   * note, and handing it a video would answer with a refusal the reporter can do nothing about.
   * The clip is evidence for whoever picks the ticket up, which is the whole ask.
   */
  const addVideo = useCallback(
    async (source: 'camera' | 'library'): Promise<void> => {
      setError(null);
      const outcome = await pickEquipmentVideo(source);
      if (outcome.status === 'CANCELLED') return;
      if (outcome.status === 'REFUSED') {
        setError(outcome.message);
        return;
      }
      setBusy('video');
      try {
        const media = await equipmentApi.uploadMedia({
          uri: outcome.video.uri,
          fileName: outcome.video.fileName,
          mimeType: outcome.video.mimeType,
        });
        setAttachments((current) => [
          ...current,
          { mediaId: media.id, kind: AttachmentKind.VIDEO, uri: outcome.video.uri },
        ]);
      } catch (caught) {
        setError(equipmentErrorMessage(caught, 'The video could not be uploaded.'));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const stopRecording = useCallback(async (): Promise<void> => {
    const take = await recorder.stop();
    if (take === null) return;
    setBusy('voice');
    try {
      const media = await equipmentApi.uploadMedia({
        uri: take.uri,
        fileName: `problem-${Date.now()}.m4a`,
        mimeType: 'audio/m4a',
      });
      setAttachments((current) => [
        ...current,
        {
          mediaId: media.id,
          kind: AttachmentKind.VOICE,
          uri: take.uri,
          durationMs: take.durationMs,
        },
      ]);
      setBusy(null);
      // The classifier transcribes the clip, so the reporter never has to type what they said.
      await classify({ mediaId: media.id });
    } catch (caught) {
      setBusy(null);
      setError(equipmentErrorMessage(caught, 'The voice note could not be uploaded.'));
    }
  }, [classify, recorder]);

  const submit = useCallback(async (): Promise<void> => {
    if (equipment === null) {
      setError('Choose which machine this is about.');
      return;
    }
    setBusy('saving');
    setError(null);
    try {
      const ticket = await maintenanceApi.createTicket({
        equipmentId: equipment.id,
        problemCategory: category,
        description: description.trim() === '' ? null : description.trim(),
        ...(priority === null ? {} : { priority }),
        attachments: attachments.map((attachment) => ({
          mediaId: attachment.mediaId,
          kind: attachment.kind,
        })),
        aiSuggestedCategory: aiCategory,
        aiConfidence,
        capturedVia:
          attachments.some((attachment) => attachment.kind === AttachmentKind.VOICE)
            ? CaptureSource.VOICE
            : aiCategory !== null
              ? CaptureSource.PHOTO_AI
              : CaptureSource.MANUAL,
      });
      router.replace({
        pathname: '/equipment/tickets/[ticketId]',
        params: { ticketId: ticket.id },
      });
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'The problem was not reported.'));
    } finally {
      setBusy(null);
    }
  }, [aiCategory, aiConfidence, attachments, category, description, equipment, priority, router]);

  if (!canReport) {
    return (
      <View style={styles.screen}>
        <TopAppBar title="Report a problem" onBack={() => router.back()} />
        <EmptyState
          title="Not available"
          subtitle="Your account cannot raise maintenance problems."
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <TopAppBar title="Report a problem" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>Which machine</Text>
        {!needsPicker && equipment !== null ? (
          <View style={styles.assetCard}>
            <MaterialIcons
              name="precision-manufacturing"
              size={22}
              color={colors.onSurfaceVariant}
            />
            <View style={styles.assetText}>
              <Text style={styles.assetName} numberOfLines={1}>
                {equipment.name}
              </Text>
              <Text style={styles.assetMeta} numberOfLines={1}>
                {[equipment.assetId, equipment.locationPath].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </View>
        ) : (
          <PressableScale
            onPress={() => setEquipmentSheet(true)}
            accessibilityRole="button"
            accessibilityLabel="Choose equipment"
          >
            <View style={styles.selectRow}>
              <Text
                style={[styles.selectValue, equipment === null && styles.selectPlaceholder]}
                numberOfLines={1}
              >
                {equipment === null
                  ? 'Choose the equipment'
                  : `${equipment.name} — ${equipment.assetId}`}
              </Text>
              <MaterialIcons name="expand-more" size={22} color={colors.outline} />
            </View>
          </PressableScale>
        )}

        <Text style={styles.sectionTitle}>What is wrong</Text>
        <ChoiceChips choices={CATEGORY_CHOICES} selected={category} onSelect={setCategory} />

        {aiCategory !== null ? (
          <View style={styles.aiBanner}>
            <MaterialIcons name="auto-awesome" size={18} color={colors.onPrimaryContainer} />
            <View style={styles.aiBannerBody}>
              <Text style={styles.aiBannerText}>
                AI suggestion: {PROBLEM_CATEGORY_LABELS[aiCategory]}
                {aiPriority === null ? '' : ` · ${MAINTENANCE_PRIORITY_LABELS[aiPriority]} priority`}
              </Text>
              {aiAction !== null && aiAction !== '' ? (
                <Text style={styles.aiBannerDetail}>{aiAction}</Text>
              ) : null}
              <Text style={styles.aiBannerDetail}>
                Confirm it, or tap a different chip — nothing is submitted until you do.
              </Text>
            </View>
          </View>
        ) : null}

        {notice !== null ? (
          <View style={styles.noticeBar}>
            <MaterialIcons name="info-outline" size={18} color={colors.onTertiaryContainer} />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}
        {error !== null ? (
          <View style={styles.errorBar}>
            <MaterialIcons name="error-outline" size={18} color={colors.onErrorContainer} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>How urgent</Text>
        <ChoiceChips choices={PRIORITY_CHOICES} selected={priority} onSelect={setPriority} />
        <Text style={styles.hint}>
          Leave this alone and the server sets it from the category — a safety or electrical fault
          opens as critical on its own.
        </Text>

        <Text style={styles.sectionTitle}>Say more (optional)</Text>
        <FormInput
          label=""
          value={description}
          onChangeText={setDescription}
          placeholder="Making a grinding noise since this morning"
          multiline
          maxLength={LIMITS.MAINTENANCE_DESCRIPTION_MAX}
        />
        {/* The one AI path open to everyone who can report: no upload right needed, because the
            classifier is reading text the reporter typed rather than a file. */}
        {description.trim() !== '' ? (
          <PrimaryButton
            label="Suggest a category from that"
            variant="ghost"
            size="sm"
            loading={busy === 'thinking'}
            disabled={busy !== null}
            onPress={() => void classify({ text: description.trim() })}
          />
        ) : null}

        {canReport ? (
          <>
            <View style={styles.mediaRow}>
              <MediaButton
                icon="photo-camera"
                label="Photo"
                busy={busy === 'photo'}
                disabled={busy !== null || recorder.isRecording}
                onPress={() => void addPhoto('camera')}
              />
              <MediaButton
                icon="image"
                label="Gallery"
                disabled={busy !== null || recorder.isRecording}
                onPress={() => void addPhoto('library')}
              />
              <MediaButton
                icon={recorder.isRecording ? 'stop-circle' : 'mic'}
                label={recorder.isRecording ? clock(recorder.durationMs) : 'Voice note'}
                tone={recorder.isRecording ? 'danger' : 'default'}
                busy={busy === 'voice'}
                disabled={
                  busy === 'photo' || busy === 'video' || busy === 'saving' || busy === 'thinking'
                }
                onPress={() => {
                  if (recorder.isRecording) void stopRecording();
                  else void recorder.start();
                }}
              />
            </View>
            <View style={styles.mediaRow}>
              <MediaButton
                icon="videocam"
                label="Film it"
                busy={busy === 'video'}
                disabled={busy !== null || recorder.isRecording}
                onPress={() => void addVideo('camera')}
              />
              <MediaButton
                icon="video-library"
                label="Pick a clip"
                disabled={busy !== null || recorder.isRecording}
                onPress={() => void addVideo('library')}
              />
            </View>
            <Text style={styles.hint}>
              A noise, a leak or a flame that will not hold is easier to film than to describe. Up
              to {MEDIA.VIDEO_MAX_DURATION_SECONDS} seconds.
            </Text>
            {recorder.permissionDenied ? (
              <Text style={styles.hint}>
                Microphone access was refused, so a voice note cannot be recorded. Type instead.
              </Text>
            ) : null}
            {busy === 'thinking' ? (
              <Text style={styles.hint}>Reading what you sent…</Text>
            ) : null}
            {/* A clip at the size ceiling is a minute of kitchen Wi-Fi, and `POST /equipment/media`
                reports no progress, so the wait is named rather than left to look like a hang. */}
            {busy === 'video' ? (
              <View style={styles.uploadBar}>
                <ActivityIndicator size="small" color={colors.onPrimaryContainer} />
                <Text style={styles.uploadText}>
                  Sending the clip. Keep filling the form in — the report waits for the upload, not
                  the other way round.
                </Text>
              </View>
            ) : null}

            {attachments.length > 0 ? (
              <View style={styles.attachmentRow}>
                {attachments.map((attachment) => (
                  <View key={attachment.mediaId} style={styles.attachmentTile}>
                    {attachment.kind === AttachmentKind.PHOTO ? (
                      <Image source={{ uri: attachment.uri }} style={styles.attachmentImage} />
                    ) : attachment.kind === AttachmentKind.VIDEO ? (
                      // No frame is extracted: there is no thumbnail dependency, and a labelled
                      // tile is honest where a broken <Image> would not be.
                      <View style={[styles.attachmentImage, styles.attachmentVideo]}>
                        <MaterialIcons name="play-circle-outline" size={24} color={colors.white} />
                        <Text style={styles.attachmentVideoText} numberOfLines={1}>
                          Video
                        </Text>
                      </View>
                    ) : (
                      <View style={[styles.attachmentImage, styles.attachmentVoice]}>
                        <MaterialIcons name="graphic-eq" size={20} color={colors.taskBar} />
                        <Text style={styles.attachmentVoiceText}>
                          {clock(attachment.durationMs ?? 0)}
                        </Text>
                      </View>
                    )}
                    <PressableScale
                      onPress={() =>
                        setAttachments((current) =>
                          current.filter((item) => item.mediaId !== attachment.mediaId),
                        )
                      }
                      accessibilityRole="button"
                      accessibilityLabel="Remove attachment"
                    >
                      <View style={styles.attachmentRemove}>
                        <MaterialIcons name="close" size={14} color={colors.onError} />
                      </View>
                    </PressableScale>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <View style={styles.submitBar}>
        <PrimaryButton
          label="Report it"
          loading={busy === 'saving'}
          disabled={equipment === null || busy !== null || recorder.isRecording}
          onPress={() => void submit()}
        />
      </View>

      <PickerSheet
        isOpen={equipmentSheet}
        onClose={() => setEquipmentSheet(false)}
        title="Equipment"
        searchable
        options={candidates.map((candidate) => ({
          id: candidate.id,
          label: candidate.name,
          subtitle: [candidate.assetId, candidate.locationPath].filter(Boolean).join(' · '),
        }))}
        selectedId={equipment?.id ?? null}
        onSelect={(option) => {
          const found = candidates.find((candidate) => candidate.id === option.id);
          if (found !== undefined) setEquipment(found);
        }}
      />
    </View>
  );
}

function MediaButton({
  icon,
  label,
  onPress,
  busy = false,
  disabled = false,
  tone = 'default',
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const tint = tone === 'danger' ? colors.error : colors.taskBar;
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.mediaPress}
    >
      <View style={[styles.mediaTile, (disabled || busy) && styles.mediaTileDisabled]}>
        <MaterialIcons name={icon} size={22} color={tint} />
        <Text style={[styles.mediaLabel, { color: tint }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}

function createStyles(colors: ReturnType<typeof useThemeColors>['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.marginMobile, paddingBottom: spacing[8] },

    sectionTitle: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      letterSpacing: typography.labelCaps.letterSpacing,
      color: colors.onSurfaceVariant,
      textTransform: 'uppercase',
      marginTop: spacing[5],
      marginBottom: spacing[3],
    },
    hint: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.outline,
      marginTop: spacing[2],
    },

    assetCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
      padding: spacing[3],
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainerLowest,
    },
    assetText: { flex: 1 },
    assetName: {
      fontFamily: typography.headlineMd.fontFamily,
      fontSize: typography.bodyMd.size,
      lineHeight: typography.headlineMd.lineHeight,
      color: colors.onSurface,
    },
    assetMeta: {
      fontFamily: typography.dataMono.fontFamily,
      fontSize: typography.bodySm.size,
      letterSpacing: typography.dataMono.letterSpacing,
      color: colors.onSurfaceVariant,
    },

    selectRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      minHeight: 48,
      paddingHorizontal: spacing[3],
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.gray200,
      backgroundColor: colors.surfaceContainerLowest,
    },
    selectValue: {
      flex: 1,
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.textPrimary,
    },
    selectPlaceholder: { color: colors.gray400 },

    aiBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing[2],
      padding: spacing[3],
      borderRadius: radii.lg,
      backgroundColor: colors.primaryFixed,
      marginTop: spacing[3],
    },
    aiBannerBody: { flex: 1, gap: spacing[0.5] },
    aiBannerText: {
      fontFamily: typography.headlineMd.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodyMd.lineHeight,
      color: colors.onPrimaryContainer,
    },
    aiBannerDetail: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onPrimaryContainer,
    },
    noticeBar: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing[2],
      padding: spacing[3],
      borderRadius: radii.lg,
      backgroundColor: colors.tertiaryFixed,
      marginTop: spacing[3],
    },
    noticeText: {
      flex: 1,
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onTertiaryContainer,
    },
    errorBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      padding: spacing[3],
      borderRadius: radii.lg,
      backgroundColor: colors.errorContainer,
      marginTop: spacing[3],
    },
    errorText: {
      flex: 1,
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onErrorContainer,
    },

    mediaRow: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] },
    uploadBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      padding: spacing[3],
      borderRadius: radii.lg,
      backgroundColor: colors.primaryFixed,
      marginTop: spacing[3],
    },
    uploadText: {
      flex: 1,
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onPrimaryContainer,
    },
    mediaPress: { flex: 1 },
    mediaTile: {
      minHeight: 60,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing[1],
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainerLowest,
    },
    mediaTileDisabled: { opacity: 0.5 },
    mediaLabel: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      letterSpacing: typography.labelCaps.letterSpacing,
    },

    attachmentRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing[3],
      marginTop: spacing[4],
    },
    attachmentTile: { position: 'relative' },
    attachmentImage: {
      width: 76,
      height: 76,
      borderRadius: radii.lg,
      backgroundColor: colors.surfaceContainerLow,
    },
    attachmentVoice: { alignItems: 'center', justifyContent: 'center', gap: spacing[0.5] },
    attachmentVoiceText: {
      fontFamily: typography.dataMono.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.onSurfaceVariant,
    },
    attachmentVideo: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing[0.5],
      backgroundColor: colors.gray900,
    },
    attachmentVideoText: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      letterSpacing: typography.labelCaps.letterSpacing,
      color: colors.white,
    },
    attachmentRemove: {
      position: 'absolute',
      top: -spacing[1.5],
      right: -spacing[1.5],
      width: 22,
      height: 22,
      borderRadius: radii.full,
      backgroundColor: colors.error,
      alignItems: 'center',
      justifyContent: 'center',
    },

    submitBar: {
      paddingHorizontal: spacing.marginMobile,
      paddingTop: spacing[3],
      paddingBottom: spacing[4],
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.outlineVariant,
    },
  });
}
