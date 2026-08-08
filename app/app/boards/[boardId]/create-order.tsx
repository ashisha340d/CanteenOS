import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInRight, FadeOutLeft } from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import type {
  ActivityTypeDto,
  AttachmentDto,
  BoardMemberDto,
  MenuCategoryDto,
  MenuItemDto,
  OrderPriority,
} from '@menuboard/shared';
import { buildOrderNumber } from '@menuboard/shared';
import { boardRepository, masterRepository, orderRepository } from '../../../src/db/repositories';
import { attachmentRepository } from '../../../src/db/repositories/attachmentRepository';
import { useAuthStore } from '../../../src/state/authStore';
import { useLanguage } from '../../../src/state/languageStore';
import { FormInput } from '../../../src/components/FormInput';
import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { PressableScale } from '../../../src/components/PressableScale';
import { PickerSheet } from '../../../src/components/PickerSheet';
import { Card } from '../../../src/components/Card';
import { OrderItemsEditor, type DraftLine } from '../../../src/components/order/OrderItemsEditor';
import { DateTimeFields, defaultRequiredDate, defaultRequiredTime } from '../../../src/components/order/DateTimeFields';
import { newId } from '../../../src/utils/uuid';
import { compressImageForUpload } from '../../../src/utils/imageCompression';
import { colors, radii, spacing, typography, fonts } from '../../../src/theme/tokens';

/**
 * Three steps, not five.
 *
 * The old flow split Activity / Where & When / Menu / Media / Review across five screens,
 * which cost four "Next" taps before an order could be posted even when every field but the
 * dish was already right. Activity and Where & When are one short form, and Media collapsed
 * into the same step as the menu because attaching a photo is optional and almost never the
 * reason someone opened this screen. Review is gone entirely — the details step already
 * shows every value, so re-reading them on a sixth screen added a tap and told the user
 * nothing new.
 */
const STEPS = ['Details', 'Items', 'Confirm'];
const PRIORITIES: OrderPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const PRIORITY_LABEL: Record<OrderPriority, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export default function CreateOrderScreen(): React.JSX.Element {
  const { boardId } = useLocalSearchParams<{ boardId: string }>();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const language = useLanguage();

  const [activityTypes, setActivityTypes] = useState<ActivityTypeDto[]>([]);
  const [categories, setCategories] = useState<MenuCategoryDto[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemDto[]>([]);
  const [members, setMembers] = useState<BoardMemberDto[]>([]);

  const [step, setStep] = useState(0);
  const [activityTypeId, setActivityTypeId] = useState<string | null>(null);
  const [customActivity, setCustomActivity] = useState('');
  const [venue, setVenue] = useState('');
  const [pax, setPax] = useState('');
  const [requiredDate, setRequiredDate] = useState(defaultRequiredDate());
  const [requiredTime, setRequiredTime] = useState(defaultRequiredTime());
  const [priority, setPriority] = useState<OrderPriority>('NORMAL');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<AttachmentDto[]>([]);
  const [pendingLocalUris, setPendingLocalUris] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showActivitySheet, setShowActivitySheet] = useState(false);

  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);

  const venueRef = useRef<TextInput>(null);

  useEffect(() => {
    (async () => {
      const [a, c, i, m] = await Promise.all([
        masterRepository.listActiveActivityTypes(),
        masterRepository.listActiveMenuCategories(),
        masterRepository.listActiveMenuItems(),
        boardId ? boardRepository.listMembers(boardId) : Promise.resolve([]),
      ]);
      setActivityTypes(a);
      setCategories(c);
      setMenuItems(i);
      setMembers(m);
    })();
  }, [boardId]);

  const activityLabel = useMemo(() => {
    const found = activityTypes.find((a) => a.id === activityTypeId);
    return found?.name ?? (customActivity.trim() || 'Choose activity');
  }, [activityTypes, activityTypeId, customActivity]);

  const photoCount = pendingAttachments.filter((a) => a.kind === 'IMAGE').length;
  const voiceCount = pendingAttachments.filter((a) => a.kind === 'VOICE_NOTE').length;

  const onPickPhoto = async (): Promise<void> => {
    if (!user) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0]!;

    const width = asset.width ?? 0;
    const height = asset.height ?? 0;
    const compressed = width > 0 && height > 0
      ? await compressImageForUpload(asset.uri, width, height)
      : {
        uri: asset.uri,
        width: width || null,
        height: height || null,
        sizeBytes: asset.fileSize ?? 0,
        mimeType: asset.mimeType ?? 'image/jpeg',
      };

    const attachment = await attachmentRepository.captureLocal({
      ownerType: 'ORDER',
      ownerId: null,
      kind: 'IMAGE',
      fileName: asset.fileName ?? `photo-${newId()}.jpg`,
      localPath: compressed.uri,
      mimeType: compressed.mimeType,
      sizeBytes: compressed.sizeBytes,
      width: compressed.width,
      height: compressed.height,
      uploadedBy: user.id,
    });
    setPendingAttachments((prev) => [...prev, attachment]);
    setPendingLocalUris((prev) => ({ ...prev, [attachment.id]: compressed.uri }));
  };

  const onToggleRecording = async (): Promise<void> => {
    if (!user) return;
    if (isRecording && recording) {
      setIsRecording(false);
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      const status = await recording.getStatusAsync();
      setRecording(null);
      if (uri) {
        const attachment = await attachmentRepository.captureLocal({
          ownerType: 'ORDER',
          ownerId: null,
          kind: 'VOICE_NOTE',
          fileName: `voice-${newId()}.m4a`,
          localPath: uri,
          mimeType: 'audio/m4a',
          sizeBytes: 0,
          durationMs: status.durationMillis ?? recordingDurationMs ?? null,
          uploadedBy: user.id,
        });
        setPendingAttachments((prev) => [...prev, attachment]);
        setPendingLocalUris((prev) => ({ ...prev, [attachment.id]: uri }));
      }
      return;
    }
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) return;
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const { recording: newRecording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY,
      (status) => setRecordingDurationMs(status.durationMillis ?? 0),
    );
    setRecording(newRecording);
    setIsRecording(true);
  };

  const onSubmit = async (): Promise<void> => {
    if (!user || !boardId) return;
    setSubmitting(true);
    setError(null);
    try {
      const id = newId();
      const orderNumber = buildOrderNumber(id, requiredDate);
      const order = await orderRepository.createLocal({
        id,
        orderNumber,
        boardId,
        activityTypeId,
        customActivity: activityTypeId ? null : customActivity.trim(),
        venue: venue.trim(),
        pax: Number(pax) || 0,
        requiredDate,
        requiredTime,
        priority,
        createdBy: user.id,
        items: lines.map((line, index) => ({
          menuItemId: line.menuItemId,
          customItemName: line.customItemName,
          quantity: line.quantity,
          unit: line.unit,
          notes: line.notes.trim() || null,
          mentionedUserIds: line.mentionedUserIds,
          sortOrder: index,
        })),
      });
      for (const attachment of pendingAttachments) {
        await attachmentRepository.bindOwner(attachment.id, 'ORDER', order.id);
      }
      router.replace({ pathname: '/boards/[boardId]', params: { boardId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the order.');
    } finally {
      setSubmitting(false);
    }
  };

  const canAdvance = (): boolean => {
    if (step === 0) {
      return (
        (!!activityTypeId || customActivity.trim().length > 0) && venue.trim().length > 0
      );
    }
    if (step === 1) return lines.length > 0;
    return true;
  };

  const StepHeader = (
    <View style={styles.stepHeader}>
      {STEPS.map((label, i) => (
        <PressableScale
          key={label}
          style={styles.stepDotWrap}
          // Going back is always allowed; going forward still has to pass the same gate as
          // Next, so the header cannot be used to skip a required field.
          onPress={() => {
            if (i < step || (i === step + 1 && canAdvance())) setStep(i);
          }}
        >
          <View style={[styles.stepDot, i === step && styles.stepDotActive, i < step && styles.stepDotDone]}>
            {i < step ? (
              <Ionicons name="checkmark" size={12} color={colors.white} />
            ) : (
              <Text style={[styles.stepNumber, i === step && styles.stepNumberActive]}>{i + 1}</Text>
            )}
          </View>
          <Text style={[styles.stepLabel, i === step && styles.stepLabelActive]}>{label}</Text>
          {i < STEPS.length - 1 ? <View style={styles.stepLine} /> : null}
        </PressableScale>
      ))}
    </View>
  );

  const renderStep = (): React.JSX.Element | null => {
    switch (step) {
      case 0:
        return (
          <Animated.View key="step0" entering={FadeInRight.duration(220)} exiting={FadeOutLeft.duration(160)}>
            <PressableScale onPress={() => setShowActivitySheet(true)}>
              <Card style={styles.selectorCard}>
                <Text style={styles.selectorLabel}>Activity</Text>
                <Text style={styles.selectorValue}>{activityLabel}</Text>
                <Ionicons name="chevron-down" size={18} color={colors.gray400} style={styles.selectorChevron} />
              </Card>
            </PressableScale>
            {!activityTypeId ? (
              <FormInput
                label="Or type a custom activity"
                value={customActivity}
                onChangeText={setCustomActivity}
                placeholder="e.g. Evening Satsang"
              />
            ) : null}

            <FormInput
              ref={venueRef}
              label="Venue"
              value={venue}
              onChangeText={setVenue}
              placeholder="e.g. Main Hall"
              returnKeyType="next"
            />
            <FormInput label="Pax" value={pax} onChangeText={setPax} keyboardType="numeric" placeholder="0" />
            <View style={styles.dateTimeWrap}>
              <DateTimeFields
                date={requiredDate}
                time={requiredTime}
                onChangeDate={setRequiredDate}
                onChangeTime={setRequiredTime}
              />
            </View>

            <Text style={styles.fieldLabel}>Priority</Text>
            <View style={styles.priorityRow}>
              {PRIORITIES.map((p) => (
                <PressableScale key={p} style={styles.flex1} onPress={() => setPriority(p)}>
                  <View style={[styles.priorityChip, priority === p && styles.priorityChipOn]}>
                    <Text style={[styles.priorityText, priority === p && styles.priorityTextOn]}>
                      {PRIORITY_LABEL[p]}
                    </Text>
                  </View>
                </PressableScale>
              ))}
            </View>
          </Animated.View>
        );

      case 1:
        return (
          <Animated.View key="step1" entering={FadeInRight.duration(220)} exiting={FadeOutLeft.duration(160)}>
            <OrderItemsEditor
              menuItems={menuItems}
              categories={categories}
              lines={lines}
              onChange={setLines}
              language={language}
              members={members}
              // One serving per guest is the overwhelmingly common case, so a new line starts
              // at the pax entered on the previous step rather than at 1.
              defaultQuantity={Number(pax) || 1}
            />
          </Animated.View>
        );

      case 2:
        return (
          <Animated.View key="step2" entering={FadeInRight.duration(220)} exiting={FadeOutLeft.duration(160)}>
            <Card style={styles.summaryCard}>
              <SummaryRow label="Activity" value={activityLabel} />
              <SummaryRow label="Venue" value={venue.trim() || '—'} />
              <SummaryRow label="Pax" value={pax || '0'} />
              <SummaryRow label="When" value={`${requiredDate} · ${requiredTime}`} />
              <SummaryRow label="Priority" value={PRIORITY_LABEL[priority]} />
            </Card>

            <Card style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>{lines.length} item{lines.length === 1 ? '' : 's'}</Text>
              {lines.map((line) => (
                <View key={line.key} style={styles.summaryItemRow}>
                  <Text style={styles.summaryItemName} numberOfLines={1}>
                    {line.name}
                    {line.customItemName !== null ? ' (custom)' : ''}
                  </Text>
                  <Text style={styles.summaryItemQty}>
                    {line.quantity} {line.unit}
                  </Text>
                </View>
              ))}
            </Card>

            {/* Media lives here rather than on its own step: it is optional, and putting it
                beside the final button means it costs a tap only when it is actually wanted. */}
            <View style={styles.mediaRow}>
              <PressableScale style={styles.flex1} onPress={onPickPhoto}>
                <Card style={styles.mediaCard}>
                  <Ionicons name="image-outline" size={24} color={colors.primary600} />
                  <Text style={styles.mediaTitle}>Photo</Text>
                  <Text style={styles.mediaSubtitle}>{photoCount} attached</Text>
                </Card>
              </PressableScale>
              <PressableScale style={styles.flex1} onPress={onToggleRecording}>
                <Card style={[styles.mediaCard, isRecording && styles.recordingCard]}>
                  <Ionicons
                    name={isRecording ? 'stop' : 'mic-outline'}
                    size={24}
                    color={isRecording ? colors.danger500 : colors.primary600}
                  />
                  <Text style={styles.mediaTitle}>{isRecording ? 'Stop' : 'Voice'}</Text>
                  <Text style={styles.mediaSubtitle}>
                    {isRecording ? `${Math.round(recordingDurationMs / 1000)}s` : `${voiceCount} recorded`}
                  </Text>
                </Card>
              </PressableScale>
            </View>

            {photoCount > 0 ? (
              <View style={styles.photoRow}>
                {pendingAttachments
                  .filter((a) => a.kind === 'IMAGE')
                  .map((a) => (
                    <Image key={a.id} source={{ uri: pendingLocalUris[a.id] }} style={styles.thumb} />
                  ))}
              </View>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </Animated.View>
        );

      default:
        return null;
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {StepHeader}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {renderStep()}
      </ScrollView>

      <View style={styles.navBar}>
        {step > 0 ? (
          <PrimaryButton label="Back" variant="secondary" onPress={() => setStep((s) => s - 1)} />
        ) : (
          <View style={styles.navSpacer} />
        )}
        {step < STEPS.length - 1 ? (
          <PrimaryButton
            label={step === 1 ? `Review (${lines.length})` : 'Next'}
            onPress={() => setStep((s) => s + 1)}
            disabled={!canAdvance()}
          />
        ) : (
          <PrimaryButton label="Post order" onPress={onSubmit} loading={submitting} />
        )}
      </View>

      <PickerSheet
        isOpen={showActivitySheet}
        onClose={() => setShowActivitySheet(false)}
        title="Activity type"
        searchable
        options={activityTypes.map((a) => ({
          id: a.id,
          label: a.name,
          subtitle: a.description ?? undefined,
        }))}
        selectedId={activityTypeId}
        onSelect={(o) => {
          setActivityTypeId(o.id);
          setCustomActivity('');
          // Choosing the activity is never the last thing anyone wants to do, so the flow
          // carries straight on to the next field instead of leaving the user looking at a
          // closed sheet. The sheet has to finish unmounting first or the focus is stolen
          // back by its own teardown.
          setTimeout(() => venueRef.current?.focus(), 250);
        }}
      />
    </KeyboardAvoidingView>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  stepHeader: { flexDirection: 'row', paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  stepDotWrap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.gray200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: colors.primary600 },
  stepDotDone: { backgroundColor: colors.success500 },
  stepNumber: {
    fontFamily: fonts.sansBold,
    fontSize: typography.caption.size,
    fontWeight: '700',
    color: colors.textMuted,
  },
  stepNumberActive: { color: colors.white },
  stepLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.caption.size,
    color: colors.textMuted,
    marginLeft: spacing[1],
    fontWeight: '600',
  },
  stepLabelActive: { color: colors.primary600, fontWeight: '700' },
  stepLine: { flex: 1, height: 2, backgroundColor: colors.gray200, marginHorizontal: spacing[1] },
  scrollContent: { paddingHorizontal: spacing[4], paddingBottom: spacing[12] },
  selectorCard: { marginBottom: spacing[4], paddingVertical: spacing[4] },
  selectorLabel: {
    fontFamily: fonts.sansBold,
    fontSize: typography.caption.size,
    fontWeight: typography.caption.weight,
    color: colors.textMuted,
    marginBottom: spacing[1],
  },
  selectorValue: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.title3.size,
    fontWeight: typography.title3.weight,
    color: colors.textPrimary,
  },
  selectorChevron: { position: 'absolute', right: spacing[4], top: spacing[5] },
  row2: { flexDirection: 'row', gap: spacing[3] },
  flex1: { flex: 1 },
  dateTimeWrap: { marginBottom: spacing[4] },
  fieldLabel: {
    fontFamily: fonts.sansBold,
    fontSize: typography.caption.size,
    fontWeight: typography.caption.weight,
    color: colors.textMuted,
    marginBottom: spacing[2],
    textTransform: 'uppercase',
  },
  priorityRow: { flexDirection: 'row', gap: spacing[2] },
  priorityChip: {
    paddingVertical: spacing[2.5],
    borderRadius: radii.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray200,
    alignItems: 'center',
  },
  priorityChipOn: { backgroundColor: colors.primary600, borderColor: colors.primary600 },
  priorityText: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.bodySm.size,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  priorityTextOn: { color: colors.white },
  summaryCard: { marginBottom: spacing[3], paddingVertical: spacing[3] },
  summaryTitle: {
    fontFamily: fonts.sansBold,
    fontSize: typography.caption.size,
    letterSpacing: typography.caption.letterSpacing,
    color: colors.textMuted,
    marginBottom: spacing[2],
    textTransform: 'uppercase',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[2],
  },
  summaryLabel: { fontFamily: fonts.sans, fontSize: typography.body.size, color: colors.textMuted },
  summaryValue: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.body.size,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
    marginLeft: spacing[3],
  },
  summaryItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[1.5],
  },
  summaryItemName: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: typography.body.size,
    color: colors.textPrimary,
  },
  summaryItemQty: {
    fontFamily: fonts.mono,
    fontSize: typography.dataMono.size,
    color: colors.textSecondary,
    marginLeft: spacing[3],
  },
  mediaRow: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[3] },
  mediaCard: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[4] },
  recordingCard: { backgroundColor: colors.danger50, borderColor: colors.danger100 },
  mediaTitle: {
    fontFamily: fonts.sansBold,
    fontSize: typography.body.size,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: spacing[1.5],
  },
  mediaSubtitle: {
    fontFamily: fonts.sansBold,
    fontSize: typography.caption.size,
    color: colors.textMuted,
    marginTop: spacing[0.5],
  },
  photoRow: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[3], flexWrap: 'wrap' },
  thumb: { width: 72, height: 72, borderRadius: radii.md, backgroundColor: colors.gray200 },
  error: { color: colors.danger500, marginTop: spacing[3], fontWeight: '600' },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.gray200,
    backgroundColor: colors.surface,
    gap: spacing[3],
  },
  navSpacer: { flex: 1 },
});
