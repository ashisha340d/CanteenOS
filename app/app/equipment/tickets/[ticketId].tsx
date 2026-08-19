import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type {
  EquipmentSupplierDto,
  MaintenanceTicketDto,
  MaintenanceTicketStatus,
  UserDto,
} from '@menuboard/shared';
import {
  CALL_OUTCOME_LABELS,
  Capability,
  CallOutcome,
  LIMITS,
  MAINTENANCE_TICKET_STATUS_LABELS,
  MaintenanceAttachmentKind,
  MaintenanceTicketStatus as TicketStatus,
  PROBLEM_CATEGORY_LABELS,
  canTransitionMaintenanceStatus,
} from '@menuboard/shared';
import {
  equipmentApi,
  equipmentErrorMessage,
  maintenanceApi,
  suppliersApi,
} from '../../../src/api/equipment';
import { useCapabilities } from '../../../src/permissions/useCapabilities';
import { useSupplierContact } from '../../../src/hooks/useSupplierContact';
import { userRepository } from '../../../src/db/repositories';
import { ActionSheet, type ActionSheetItem } from '../../../src/components/ActionSheet';
import { ThemedBottomSheet } from '../../../src/components/BottomSheet';
import { EmptyState } from '../../../src/components/EmptyState';
import { FormInput } from '../../../src/components/FormInput';
import { LoadingScreen } from '../../../src/components/LoadingScreen';
import { PickerSheet } from '../../../src/components/PickerSheet';
import { PressableScale } from '../../../src/components/PressableScale';
import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { TopAppBar } from '../../../src/components/TopAppBar';
import { PriorityChip, TicketStatusChip } from '../../../src/components/StatusChip';
import { ActivityTimeline } from '../../../src/components/equipment/ActivityTimeline';
import { ChoiceChips, type Choice } from '../../../src/components/equipment/ChoiceChips';
import { pickEquipmentPhoto, pickEquipmentVideo } from '../../../src/utils/attachmentPicker';
import { radii, spacing, typography } from '../../../src/theme/tokens';
import { useThemeColors } from '../../../src/theme/useThemeColors';

/**
 * A maintenance ticket, with the actions this caller is actually allowed to take.
 *
 * Buttons that the signed-in user may not press are absent rather than disabled — a screen full
 * of greyed-out verbs teaches people to stop reading it. Status transitions come from the shared
 * state machine (`canTransitionMaintenanceStatus`), and the two statuses the server gates inside
 * its own controller (VERIFIED needs `maintenance.approve`, CLOSED/CANCELLED need
 * `maintenance.close`) are filtered here too so the sheet never offers a refusal.
 */

const ALL_STATUSES: readonly MaintenanceTicketStatus[] = [
  TicketStatus.ACKNOWLEDGED,
  TicketStatus.ASSIGNED,
  TicketStatus.SUPPLIER_CONTACTED,
  TicketStatus.TECHNICIAN_SCHEDULED,
  TicketStatus.UNDER_MAINTENANCE,
  TicketStatus.WAITING_FOR_PARTS,
  TicketStatus.RESOLVED,
  TicketStatus.VERIFIED,
  TicketStatus.CLOSED,
  TicketStatus.CANCELLED,
];

function stamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TicketDetailScreen(): React.JSX.Element {
  const { ticketId } = useLocalSearchParams<{ ticketId: string }>();
  const router = useRouter();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { has } = useCapabilities();
  const contact = useSupplierContact();

  const canAssign = has(Capability.MAINTENANCE_ASSIGN);
  const canApprove = has(Capability.MAINTENANCE_APPROVE);
  const canClose = has(Capability.MAINTENANCE_CLOSE);
  const canWork = has(Capability.MAINTENANCE_CREATE);
  const canContact = has(Capability.SUPPLIER_CONTACT);
  const canSeeSuppliers = has(Capability.SUPPLIER_VIEW);
  // Same gate as the media endpoint itself: whoever may report a fault may photograph it, and
  // whoever fixes it may photograph the repair.
  const canUpload = has(Capability.EQUIPMENT_REPORT_PROBLEM);

  const [ticket, setTicket] = useState<MaintenanceTicketDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    null | 'status' | 'assign' | 'complete' | 'note' | 'photo' | 'video'
  >(null);

  const [statusSheet, setStatusSheet] = useState(false);
  const [nextStatus, setNextStatus] = useState<MaintenanceTicketStatus | null>(null);
  const [statusNote, setStatusNote] = useState('');

  const [assignSheet, setAssignSheet] = useState(false);
  const [people, setPeople] = useState<UserDto[]>([]);
  const [suppliers, setSuppliers] = useState<EquipmentSupplierDto[]>([]);
  const [peopleSheet, setPeopleSheet] = useState(false);
  const [supplierSheet, setSupplierSheet] = useState(false);
  const [assignee, setAssignee] = useState<UserDto | null>(null);
  const [assignSupplier, setAssignSupplier] = useState<EquipmentSupplierDto | null>(null);
  const [assignNote, setAssignNote] = useState('');

  const [completeSheet, setCompleteSheet] = useState(false);
  const [resolution, setResolution] = useState('');
  const [partsReplaced, setPartsReplaced] = useState('');
  const [completionPhoto, setCompletionPhoto] = useState<{ mediaId: string; uri: string } | null>(
    null,
  );
  const [completionVideo, setCompletionVideo] = useState<{ mediaId: string } | null>(null);

  const [noteSheet, setNoteSheet] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async (): Promise<void> => {
    if (ticketId === undefined || ticketId === '') return;
    setError(null);
    try {
      setTicket(await maintenanceApi.getTicket(ticketId));
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'That ticket could not be loaded.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [ticketId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openAssign = useCallback(async (): Promise<void> => {
    setAssignSheet(true);
    // Users come from the local database (the roster syncs); suppliers are online-only.
    const [roster, supplierPage] = await Promise.all([
      userRepository.listAll().catch(() => [] as UserDto[]),
      canSeeSuppliers
        ? suppliersApi.list({ pageSize: 100 }).catch(() => ({ items: [] as EquipmentSupplierDto[] }))
        : Promise.resolve({ items: [] as EquipmentSupplierDto[] }),
    ]);
    setPeople(roster);
    setSuppliers(supplierPage.items);
  }, [canSeeSuppliers]);

  const submitStatus = useCallback(async (): Promise<void> => {
    if (ticket === null || nextStatus === null) return;
    setBusy('status');
    try {
      setTicket(
        await maintenanceApi.changeTicketStatus(ticket.id, {
          status: nextStatus,
          note: statusNote.trim() === '' ? null : statusNote.trim(),
        }),
      );
      setStatusSheet(false);
      setNextStatus(null);
      setStatusNote('');
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'The status was not changed.'));
    } finally {
      setBusy(null);
    }
  }, [nextStatus, statusNote, ticket]);

  const submitAssign = useCallback(async (): Promise<void> => {
    if (ticket === null) return;
    if (assignee === null && assignSupplier === null) {
      setError('Choose a person or a supplier.');
      return;
    }
    setBusy('assign');
    try {
      setTicket(
        await maintenanceApi.assignTicket(ticket.id, {
          assignedTo: assignee?.id ?? null,
          supplierId: assignSupplier?.id ?? null,
          notes: assignNote.trim() === '' ? null : assignNote.trim(),
        }),
      );
      setAssignSheet(false);
      setAssignee(null);
      setAssignSupplier(null);
      setAssignNote('');
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'The ticket was not assigned.'));
    } finally {
      setBusy(null);
    }
  }, [assignNote, assignSupplier, assignee, ticket]);

  const addCompletionPhoto = useCallback(async (): Promise<void> => {
    const picked = await pickEquipmentPhoto('camera');
    if (picked === null) return;
    setBusy('photo');
    try {
      const media = await equipmentApi.uploadMedia({
        uri: picked.uri,
        fileName: picked.fileName,
        mimeType: picked.mimeType,
      });
      setCompletionPhoto({ mediaId: media.id, uri: picked.uri });
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'The photo could not be uploaded.'));
    } finally {
      setBusy(null);
    }
  }, []);

  /** Video is never compressed — see `pickEquipmentVideo`, which refuses an unuploadable clip. */
  const addCompletionVideo = useCallback(async (): Promise<void> => {
    const outcome = await pickEquipmentVideo('camera');
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
      setCompletionVideo({ mediaId: media.id });
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'The video could not be uploaded.'));
    } finally {
      setBusy(null);
    }
  }, []);

  const submitComplete = useCallback(async (): Promise<void> => {
    if (ticket === null) return;
    setBusy('complete');
    try {
      const attachments = [
        ...(completionPhoto === null
          ? []
          : [{ mediaId: completionPhoto.mediaId, kind: MaintenanceAttachmentKind.PHOTO }]),
        ...(completionVideo === null
          ? []
          : [{ mediaId: completionVideo.mediaId, kind: MaintenanceAttachmentKind.VIDEO }]),
      ];
      setTicket(
        await maintenanceApi.completeTicket(ticket.id, {
          resolutionNotes: resolution.trim() === '' ? null : resolution.trim(),
          partsReplaced: partsReplaced.trim() === '' ? null : partsReplaced.trim(),
          ...(attachments.length === 0 ? {} : { attachments }),
        }),
      );
      setCompleteSheet(false);
      setResolution('');
      setPartsReplaced('');
      setCompletionPhoto(null);
      setCompletionVideo(null);
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'The job was not marked complete.'));
    } finally {
      setBusy(null);
    }
  }, [completionPhoto, completionVideo, partsReplaced, resolution, ticket]);

  /**
   * Hands an attachment to whatever the phone plays video with.
   *
   * The URL is signed for this user in its query string rather than by a bearer header, so an
   * external player can fetch it directly — the same reason `<Image>` can render a photo.
   */
  const openAttachment = useCallback(async (url: string): Promise<void> => {
    try {
      await Linking.openURL(url);
    } catch {
      setError('This phone has nothing installed that can play that clip.');
    }
  }, []);

  const submitNote = useCallback(async (): Promise<void> => {
    if (ticket === null || note.trim() === '') return;
    setBusy('note');
    try {
      setTicket(await maintenanceApi.addTicketNote(ticket.id, note.trim()));
      setNoteSheet(false);
      setNote('');
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'The note was not added.'));
    } finally {
      setBusy(null);
    }
  }, [note, ticket]);

  if (loading && ticket === null) {
    return <LoadingScreen label="Loading ticket…" />;
  }

  if (ticket === null) {
    return (
      <View style={styles.screen}>
        <TopAppBar title="Ticket" onBack={() => router.back()} />
        <EmptyState title="Not found" subtitle={error ?? 'That ticket no longer exists.'} />
        <View style={styles.notFoundActions}>
          <PrimaryButton label="Try again" variant="secondary" onPress={() => void load()} />
        </View>
      </View>
    );
  }

  const terminal =
    ticket.status === TicketStatus.CLOSED || ticket.status === TicketStatus.CANCELLED;

  const statusChoices: readonly Choice<MaintenanceTicketStatus>[] = ALL_STATUSES.filter(
    (status) =>
      canTransitionMaintenanceStatus(ticket.status, status) &&
      status !== ticket.status &&
      (status !== TicketStatus.VERIFIED || canApprove) &&
      ((status !== TicketStatus.CLOSED && status !== TicketStatus.CANCELLED) || canClose),
  ).map((status) => ({ value: status, label: MAINTENANCE_TICKET_STATUS_LABELS[status] }));

  const canAcknowledge =
    canAssign && ticket.status === TicketStatus.REPORTED && ticket.acknowledgedAt === null;

  const outcomeItems: ActionSheetItem[] = (
    [
      CallOutcome.RESOLVED,
      CallOutcome.TECHNICIAN_SCHEDULED,
      CallOutcome.PARTS_REQUIRED,
      CallOutcome.FOLLOW_UP_REQUIRED,
      CallOutcome.NO_ANSWER,
      CallOutcome.OTHER,
    ] as const
  ).map((outcome) => ({
    id: outcome,
    label: CALL_OUTCOME_LABELS[outcome],
    icon: 'checkmark-circle-outline' as const,
    onPress: () => void contact.recordOutcome(outcome),
  }));

  const photos = (ticket.attachments ?? []).filter(
    (attachment) => attachment.kind === MaintenanceAttachmentKind.PHOTO,
  );
  const videos = (ticket.attachments ?? []).filter(
    (attachment) => attachment.kind === MaintenanceAttachmentKind.VIDEO,
  );
  const others = (ticket.attachments ?? []).filter(
    (attachment) =>
      attachment.kind !== MaintenanceAttachmentKind.PHOTO &&
      attachment.kind !== MaintenanceAttachmentKind.VIDEO,
  );

  return (
    <View style={styles.screen}>
      <TopAppBar title={ticket.ticketNumber} onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.taskBar}
          />
        }
      >
        <View style={styles.headerBlock}>
          <Text style={styles.title}>{ticket.title}</Text>
          <View style={styles.chipRow}>
            <TicketStatusChip status={ticket.status} />
            <PriorityChip priority={ticket.priority} />
          </View>
          {ticket.description !== null && ticket.description !== '' ? (
            <Text style={styles.description}>{ticket.description}</Text>
          ) : null}
        </View>

        <PressableScale
          onPress={() =>
            router.push({
              pathname: '/equipment/[equipmentId]',
              params: { equipmentId: ticket.equipmentId },
            })
          }
          accessibilityRole="button"
          accessibilityLabel={`Open ${ticket.equipmentName ?? 'equipment'}`}
        >
          <View style={styles.assetCard}>
            {ticket.equipmentImageUrl !== null && ticket.equipmentImageUrl !== undefined ? (
              <Image source={{ uri: ticket.equipmentImageUrl }} style={styles.assetPhoto} />
            ) : (
              <View style={[styles.assetPhoto, styles.assetPhotoFallback]}>
                <MaterialIcons
                  name="precision-manufacturing"
                  size={22}
                  color={colors.onSurfaceVariant}
                />
              </View>
            )}
            <View style={styles.assetText}>
              <Text style={styles.assetName} numberOfLines={1}>
                {ticket.equipmentName ?? 'Equipment'}
              </Text>
              <Text style={styles.assetMeta} numberOfLines={1}>
                {[ticket.assetId, ticket.locationPath].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={colors.outline} />
          </View>
        </PressableScale>

        {error !== null ? <Banner tone="error" text={error} /> : null}
        {contact.error !== null ? (
          <PressableScale onPress={contact.clearError} accessibilityRole="button">
            <Banner tone="error" text={contact.error} />
          </PressableScale>
        ) : null}

        <View style={styles.actionRow}>
          {canAcknowledge ? (
            <ActionTile
              icon="how-to-reg"
              label="Acknowledge"
              busy={busy === 'status'}
              onPress={() => {
                setNextStatus(TicketStatus.ACKNOWLEDGED);
                setStatusNote('');
                setStatusSheet(true);
              }}
            />
          ) : null}
          {canAssign && !terminal && statusChoices.length > 0 ? (
            <ActionTile
              icon="autorenew"
              label="Change status"
              onPress={() => {
                setNextStatus(null);
                setStatusNote('');
                setStatusSheet(true);
              }}
            />
          ) : null}
          {canAssign && !terminal ? (
            <ActionTile icon="person" label="Assign" onPress={() => void openAssign()} />
          ) : null}
          {canWork && !terminal && ticket.status !== TicketStatus.RESOLVED ? (
            <ActionTile
              icon="task-alt"
              label="Complete"
              onPress={() => setCompleteSheet(true)}
            />
          ) : null}
        </View>

        <View style={styles.actionRow}>
          {canWork && !terminal ? (
            <ActionTile icon="note-add" label="Add note" onPress={() => setNoteSheet(true)} />
          ) : null}
          {canContact && ticket.supplierPhone !== null && ticket.supplierPhone !== undefined ? (
            <ActionTile
              icon="call"
              label="Call supplier"
              busy={contact.busy}
              onPress={() =>
                void contact.call({
                  equipmentId: ticket.equipmentId,
                  ticketId: ticket.id,
                  supplierId: ticket.supplierId,
                  phoneNumber: ticket.supplierPhone as string,
                })
              }
            />
          ) : null}
          {canContact ? (
            <ActionTile
              icon="chat"
              label="WhatsApp"
              busy={contact.busy}
              onPress={() =>
                void contact.whatsapp({
                  equipmentId: ticket.equipmentId,
                  ticketId: ticket.id,
                  supplierId: ticket.supplierId,
                })
              }
            />
          ) : null}
        </View>

        <Section title="Details">
          <DetailRow label="Reported" value={`${ticket.reportedByName ?? '—'} · ${stamp(ticket.reportedAt)}`} />
          {ticket.problemCategory !== null ? (
            <DetailRow label="Category" value={PROBLEM_CATEGORY_LABELS[ticket.problemCategory]} />
          ) : null}
          {ticket.assignedToName !== null && ticket.assignedToName !== undefined ? (
            <DetailRow label="Assigned to" value={ticket.assignedToName} />
          ) : null}
          {ticket.supplierName !== null && ticket.supplierName !== undefined ? (
            <DetailRow label="Supplier" value={ticket.supplierName} />
          ) : null}
          {ticket.scheduledAt !== null ? (
            <DetailRow label="Visit" value={stamp(ticket.scheduledAt)} />
          ) : null}
          {ticket.partsRequired !== null && ticket.partsRequired !== '' ? (
            <DetailRow label="Parts" value={ticket.partsRequired} />
          ) : null}
          {ticket.resolutionNotes !== null && ticket.resolutionNotes !== '' ? (
            <DetailRow label="Resolution" value={ticket.resolutionNotes} />
          ) : null}
        </Section>

        {(ticket.problems ?? []).length > 0 ? (
          <Section title="Reported problems">
            {(ticket.problems ?? []).map((problem) => (
              <View key={problem.id} style={styles.problemRow}>
                <Text style={styles.problemCategory}>
                  {PROBLEM_CATEGORY_LABELS[problem.category]}
                </Text>
                {problem.description !== null && problem.description !== '' ? (
                  <Text style={styles.problemDetail}>{problem.description}</Text>
                ) : null}
                {problem.aiSuggestedCategory !== null &&
                  problem.aiSuggestedCategory !== problem.category ? (
                  <Text style={styles.problemAi}>
                    AI had suggested {PROBLEM_CATEGORY_LABELS[problem.aiSuggestedCategory]}; the
                    reporter chose otherwise.
                  </Text>
                ) : null}
              </View>
            ))}
          </Section>
        ) : null}

        {(ticket.attachments ?? []).length > 0 ? (
          <Section title="Attachments">
            {photos.length > 0 ? (
              <View style={styles.photoGrid}>
                {photos.map((attachment) => (
                  <Image
                    key={attachment.id}
                    source={{ uri: attachment.url }}
                    style={styles.photoTile}
                  />
                ))}
              </View>
            ) : null}
            {/* A clip is handed to the phone's own player rather than rendered inline: there is no
                video component in this app, and an <Image> pointed at an mp4 draws nothing. */}
            {videos.map((attachment) => (
              <PressableScale
                key={attachment.id}
                onPress={() => void openAttachment(attachment.url)}
                accessibilityRole="button"
                accessibilityLabel={`Play ${attachment.fileName}`}
              >
                <View style={styles.videoRow}>
                  <View style={styles.videoThumb}>
                    <MaterialIcons name="play-arrow" size={24} color={colors.white} />
                  </View>
                  <View style={styles.fileText}>
                    <Text style={styles.fileName} numberOfLines={1}>
                      {attachment.fileName}
                    </Text>
                    <Text style={styles.videoHint}>
                      {attachment.durationMs === null
                        ? 'Tap to play'
                        : `${Math.round(attachment.durationMs / 1000)}s · tap to play`}
                    </Text>
                  </View>
                  <MaterialIcons name="open-in-new" size={18} color={colors.outline} />
                </View>
              </PressableScale>
            ))}
            {others.map((attachment) => (
              <View key={attachment.id} style={styles.fileRow}>
                <MaterialIcons
                  name={
                    attachment.kind === MaintenanceAttachmentKind.VOICE
                      ? 'graphic-eq'
                      : 'description'
                  }
                  size={20}
                  color={colors.taskBar}
                />
                <View style={styles.fileText}>
                  <Text style={styles.fileName} numberOfLines={1}>
                    {attachment.fileName}
                  </Text>
                  {attachment.transcript !== null && attachment.transcript !== '' ? (
                    <Text style={styles.fileTranscript}>{attachment.transcript}</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </Section>
        ) : null}

        {(ticket.assignments ?? []).length > 0 ? (
          <Section title="Assignments">
            {(ticket.assignments ?? []).map((assignment) => (
              <DetailRow
                key={assignment.id}
                label={assignment.isActive ? 'Current' : 'Previous'}
                value={[
                  assignment.assignedToName,
                  assignment.supplierName,
                  assignment.technicianName,
                  assignment.scheduledAt === null ? null : stamp(assignment.scheduledAt),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </Section>
        ) : null}

        <Section title="History">
          {(ticket.activities ?? []).length === 0 ? (
            <Text style={styles.emptyLine}>Nothing has happened on this ticket yet.</Text>
          ) : (
            <ActivityTimeline activities={ticket.activities ?? []} />
          )}
        </Section>
      </ScrollView>

      <ThemedBottomSheet
        isOpen={statusSheet}
        onClose={() => setStatusSheet(false)}
        title="Move this ticket on"
        scrollable
      >
        <ChoiceChips choices={statusChoices} selected={nextStatus} onSelect={setNextStatus} />
        <View style={styles.sheetField}>
          <FormInput
            label="Note (optional)"
            value={statusNote}
            onChangeText={setStatusNote}
            placeholder="What changed, in one line"
            multiline
            maxLength={LIMITS.MAINTENANCE_NOTE_MAX}
          />
        </View>
        <PrimaryButton
          label="Save"
          loading={busy === 'status'}
          disabled={nextStatus === null}
          onPress={() => void submitStatus()}
        />
      </ThemedBottomSheet>

      <ThemedBottomSheet
        isOpen={assignSheet}
        onClose={() => setAssignSheet(false)}
        title="Assign this ticket"
        scrollable
      >
        <SheetSelect
          label="Person"
          value={assignee?.name ?? 'Nobody chosen'}
          placeholder={assignee === null}
          onPress={() => setPeopleSheet(true)}
        />
        {canSeeSuppliers ? (
          <SheetSelect
            label="Supplier"
            value={assignSupplier?.name ?? 'No supplier chosen'}
            placeholder={assignSupplier === null}
            onPress={() => setSupplierSheet(true)}
          />
        ) : null}
        <View style={styles.sheetField}>
          <FormInput
            label="Note (optional)"
            value={assignNote}
            onChangeText={setAssignNote}
            placeholder="Anything the assignee needs to know"
            multiline
            maxLength={LIMITS.MAINTENANCE_NOTE_MAX}
          />
        </View>
        <PrimaryButton
          label="Assign"
          loading={busy === 'assign'}
          disabled={assignee === null && assignSupplier === null}
          onPress={() => void submitAssign()}
        />
      </ThemedBottomSheet>

      <ThemedBottomSheet
        isOpen={completeSheet}
        onClose={() => setCompleteSheet(false)}
        title="Mark it fixed"
        scrollable
      >
        <View style={styles.sheetField}>
          <FormInput
            label="What was done"
            value={resolution}
            onChangeText={setResolution}
            placeholder="Replaced the thermostat"
            multiline
            maxLength={LIMITS.MAINTENANCE_RESOLUTION_MAX}
          />
        </View>
        <View style={styles.sheetField}>
          <FormInput
            label="Parts replaced (optional)"
            value={partsReplaced}
            onChangeText={setPartsReplaced}
            maxLength={LIMITS.MAINTENANCE_PARTS_MAX}
          />
        </View>
        {canUpload ? (
          <>
            {completionPhoto === null ? (
              <>
                <PrimaryButton
                  label="Add a photo of the repair"
                  variant="secondary"
                  loading={busy === 'photo'}
                  disabled={busy === 'video'}
                  onPress={() => void addCompletionPhoto()}
                />
                <View style={styles.sheetSpacer} />
              </>
            ) : (
              <View style={styles.completionPhotoRow}>
                <Image source={{ uri: completionPhoto.uri }} style={styles.completionPhoto} />
                <PressableScale
                  onPress={() => setCompletionPhoto(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                >
                  <View style={styles.completionRemove}>
                    <MaterialIcons name="close" size={16} color={colors.onError} />
                  </View>
                </PressableScale>
              </View>
            )}

            {completionVideo === null ? (
              <>
                <PrimaryButton
                  label="Film it working again"
                  variant="secondary"
                  loading={busy === 'video'}
                  disabled={busy === 'photo'}
                  onPress={() => void addCompletionVideo()}
                />
                <View style={styles.sheetSpacer} />
              </>
            ) : (
              <View style={styles.completionPhotoRow}>
                <View style={[styles.completionPhoto, styles.completionVideo]}>
                  <MaterialIcons name="videocam" size={24} color={colors.white} />
                </View>
                <PressableScale
                  onPress={() => setCompletionVideo(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove video"
                >
                  <View style={styles.completionRemove}>
                    <MaterialIcons name="close" size={16} color={colors.onError} />
                  </View>
                </PressableScale>
              </View>
            )}

            {busy === 'video' ? (
              <Text style={styles.uploadHint}>
                Sending the clip. A long one takes a moment on kitchen Wi-Fi.
              </Text>
            ) : null}
          </>
        ) : null}
        <PrimaryButton
          label="It is fixed"
          loading={busy === 'complete'}
          disabled={busy === 'photo' || busy === 'video'}
          onPress={() => void submitComplete()}
        />
      </ThemedBottomSheet>

      <ThemedBottomSheet isOpen={noteSheet} onClose={() => setNoteSheet(false)} title="Add a note">
        <View style={styles.sheetField}>
          <FormInput
            label="Note"
            value={note}
            onChangeText={setNote}
            placeholder="Supplier says the part arrives Thursday"
            multiline
            autoFocus
            maxLength={LIMITS.MAINTENANCE_NOTE_MAX}
          />
        </View>
        <PrimaryButton
          label="Add note"
          loading={busy === 'note'}
          disabled={note.trim() === ''}
          onPress={() => void submitNote()}
        />
      </ThemedBottomSheet>

      <PickerSheet
        isOpen={peopleSheet}
        onClose={() => setPeopleSheet(false)}
        title="Person"
        searchable
        options={people.map((person) => ({
          id: person.id,
          label: person.name,
          subtitle: person.role,
        }))}
        selectedId={assignee?.id ?? null}
        onSelect={(option) => {
          setAssignee(people.find((person) => person.id === option.id) ?? null);
        }}
      />

      <PickerSheet
        isOpen={supplierSheet}
        onClose={() => setSupplierSheet(false)}
        title="Supplier"
        searchable
        options={suppliers.map((supplier) => ({
          id: supplier.id,
          label: supplier.name,
          subtitle: [supplier.serviceCategory, supplier.phone].filter(Boolean).join(' · '),
        }))}
        selectedId={assignSupplier?.id ?? null}
        onSelect={(option) => {
          setAssignSupplier(suppliers.find((supplier) => supplier.id === option.id) ?? null);
        }}
      />

      <ActionSheet
        isOpen={contact.pendingCallId !== null}
        onClose={contact.dismissOutcome}
        title="How did the call go?"
        items={outcomeItems}
      />
    </View>
  );
}

function ActionTile({
  icon,
  label,
  onPress,
  busy = false,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  busy?: boolean;
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <PressableScale
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.actionPress}
    >
      <View style={styles.actionTile}>
        {busy ? (
          <ActivityIndicator color={colors.taskBar} />
        ) : (
          <MaterialIcons name={icon} size={22} color={colors.taskBar} />
        )}
        <Text style={styles.actionLabel} numberOfLines={2}>
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}

function SheetSelect({
  label,
  value,
  placeholder,
  onPress,
}: {
  label: string;
  value: string;
  placeholder: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.sheetField}>
      <Text style={styles.sheetLabel}>{label}</Text>
      <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
        <View style={styles.selectRow}>
          <Text
            style={[styles.selectValue, placeholder && styles.selectPlaceholder]}
            numberOfLines={1}
          >
            {value}
          </Text>
          <MaterialIcons name="expand-more" size={22} color={colors.outline} />
        </View>
      </PressableScale>
    </View>
  );
}

function Banner({ tone, text }: { tone: 'error'; text: string }): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.errorBar}>
      <MaterialIcons
        name="error-outline"
        size={18}
        color={tone === 'error' ? colors.onErrorContainer : colors.onSurface}
      />
      <Text style={styles.errorText}>{text}</Text>
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useThemeColors>['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { paddingBottom: spacing[12] },
    notFoundActions: { paddingHorizontal: spacing[8] },

    headerBlock: {
      paddingHorizontal: spacing.marginMobile,
      paddingTop: spacing[4],
      gap: spacing[2],
    },
    title: {
      fontFamily: typography.headlineLg.fontFamily,
      fontSize: typography.headlineLg.size,
      lineHeight: typography.headlineLg.lineHeight,
      color: colors.onSurface,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
    description: {
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      lineHeight: typography.bodyMd.lineHeight,
      color: colors.onSurfaceVariant,
    },

    assetCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
      marginHorizontal: spacing.marginMobile,
      marginTop: spacing[4],
      padding: spacing[3],
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainerLowest,
    },
    assetPhoto: {
      width: 48,
      height: 48,
      borderRadius: radii.lg,
      backgroundColor: colors.surfaceContainerLow,
    },
    assetPhotoFallback: { alignItems: 'center', justifyContent: 'center' },
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

    errorBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      marginHorizontal: spacing.marginMobile,
      marginTop: spacing[3],
      padding: spacing[3],
      borderRadius: radii.lg,
      backgroundColor: colors.errorContainer,
    },
    errorText: {
      flex: 1,
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onErrorContainer,
    },

    actionRow: {
      flexDirection: 'row',
      gap: spacing[2],
      paddingHorizontal: spacing.marginMobile,
      paddingTop: spacing[3],
    },
    actionPress: { flex: 1 },
    actionTile: {
      minHeight: 72,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing[1],
      paddingHorizontal: spacing[1],
      paddingVertical: spacing[2],
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainerLowest,
    },
    actionLabel: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      lineHeight: typography.labelCaps.lineHeight,
      letterSpacing: typography.labelCaps.letterSpacing,
      color: colors.taskBar,
      textAlign: 'center',
    },

    section: { paddingHorizontal: spacing.marginMobile, paddingTop: spacing[6] },
    sectionTitle: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      letterSpacing: typography.labelCaps.letterSpacing,
      color: colors.onSurfaceVariant,
      textTransform: 'uppercase',
      marginBottom: spacing[3],
    },
    detailRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing[2],
      paddingVertical: spacing[2],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.outlineVariant,
    },
    detailLabel: {
      width: 96,
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodyMd.lineHeight,
      color: colors.outline,
    },
    detailValue: {
      flex: 1,
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      lineHeight: typography.bodyMd.lineHeight,
      color: colors.onSurface,
    },
    emptyLine: {
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.outline,
    },

    problemRow: {
      paddingVertical: spacing[2],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.outlineVariant,
      gap: spacing[0.5],
    },
    problemCategory: {
      fontFamily: typography.headlineMd.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.onSurface,
    },
    problemDetail: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onSurfaceVariant,
    },
    problemAi: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.outline,
    },

    photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
    photoTile: {
      width: 96,
      height: 96,
      borderRadius: radii.lg,
      backgroundColor: colors.surfaceContainerLow,
    },
    fileRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing[2],
      paddingVertical: spacing[2.5],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.outlineVariant,
    },
    videoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
      paddingVertical: spacing[2.5],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.outlineVariant,
    },
    videoThumb: {
      width: 56,
      height: 56,
      borderRadius: radii.lg,
      backgroundColor: colors.gray900,
      alignItems: 'center',
      justifyContent: 'center',
    },
    videoHint: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.outline,
    },
    fileText: { flex: 1, gap: spacing[0.5] },
    fileName: {
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.onSurface,
    },
    fileTranscript: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onSurfaceVariant,
    },

    sheetField: { marginTop: spacing[3] },
    sheetSpacer: { height: spacing[3] },
    sheetLabel: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      letterSpacing: typography.labelCaps.letterSpacing,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      marginBottom: spacing[1.5],
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

    completionPhotoRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing[3] },
    completionPhoto: {
      width: 96,
      height: 96,
      borderRadius: radii.lg,
      backgroundColor: colors.surfaceContainerLow,
    },
    completionVideo: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gray900 },
    completionRemove: {
      width: 26,
      height: 26,
      borderRadius: radii.full,
      backgroundColor: colors.error,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -spacing[3],
    },
    uploadHint: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onSurfaceVariant,
      marginBottom: spacing[3],
    },
  });
}
