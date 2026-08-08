import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Audio as ExpoAudio, type AVPlaybackStatus } from 'expo-av';
import { Capability, OrderStatus as OrderStatusEnum, UserRole, canTransitionOrderStatus, isOrderLocked } from '@menuboard/shared';
import type {
  AcknowledgementDto,
  AttachmentDto,
  BoardMemberDto,
  MenuItemDto,
  OrderDto,
  OrderItemDto,
  OrderStatus,
  ThreadMessageDto,
} from '@menuboard/shared';
import {
  acknowledgementRepository,
  attachmentRepository,
  boardRepository,
  masterRepository,
  orderRepository,
  threadRepository,
} from '../../../src/db/repositories';
import { useAuthStore } from '../../../src/state/authStore';
import { useSyncStatusStore } from '../../../src/state/syncStatusStore';
import { useBoardCapability } from '../../../src/permissions/useBoardCapability';
import { useSyncedFocusLoad } from '../../../src/hooks/useSyncedFocusLoad';
import { StatusBadge } from '../../../src/components/StatusBadge';
import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { PressableScale } from '../../../src/components/PressableScale';
import { ThemedBottomSheet } from '../../../src/components/BottomSheet';
import { EmptyState } from '../../../src/components/EmptyState';
import { Card } from '../../../src/components/Card';
import { AvatarStack } from '../../../src/components/AvatarStack';
import { StatusThreadSheet } from '../../../src/components/feed/StatusThreadSheet';
import { describeSystemEvent } from '../../../src/components/feed/systemEventText';
import { useLanguage } from '../../../src/state/languageStore';
import { LabelCaps } from '../../../src/components/feed/FeedPrimitives';
import { isPastDeadline } from '../../../src/hooks/useCountdown';
import { formatDateDisplay, formatDateTimeDisplay } from '../../../src/utils/date';
import { colors, radii, spacing, typography, fonts } from '../../../src/theme/tokens';

/** Status changes and acknowledgements move into the pinned status thread instead of
 * interrupting the Activity list one pill at a time — see StatusThreadSheet. */
const STATUS_THREAD_EVENTS = new Set<string>(['ORDER_STATUS_CHANGED', 'ORDER_ACKNOWLEDGED']);

export default function OrderDetailScreen(): React.JSX.Element {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const language = useLanguage();

  const [order, setOrder] = useState<OrderDto | null>(null);
  const [items, setItems] = useState<OrderItemDto[]>([]);
  const [menuItemsById, setMenuItemsById] = useState<Record<string, MenuItemDto>>({});
  const [attachments, setAttachments] = useState<AttachmentDto[]>([]);
  const [localUris, setLocalUris] = useState<Record<string, string>>({});
  const [acks, setAcks] = useState<AcknowledgementDto[]>([]);
  const [members, setMembers] = useState<BoardMemberDto[]>([]);
  const [messages, setMessages] = useState<ThreadMessageDto[]>([]);
  const [composeText, setComposeText] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusSheetOpen, setStatusSheetOpen] = useState(false);
  const [statusThreadOpen, setStatusThreadOpen] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  const canUpdate = useBoardCapability(order?.boardId, Capability.ORDER_UPDATE);
  const canChangeStatus = useBoardCapability(order?.boardId, Capability.ORDER_STATUS_UPDATE);
  const canAcknowledge = useBoardCapability(order?.boardId, Capability.ORDER_ACKNOWLEDGE);
  const canPost = useBoardCapability(order?.boardId, Capability.THREAD_POST);

  // Once an order's required time has passed without delivery, it is closed for everyone but
  // Super Admin, Admin and Manager — the roles trusted to correct a missed order after the fact.
  const canManageOverdue =
    user?.role === UserRole.SUPER_ADMIN ||
    user?.role === UserRole.ADMIN ||
    user?.role === UserRole.MANAGER;
  const isOver =
    order !== null &&
    !['DELIVERED', 'DONE', 'CANCELLED'].includes(order.status) &&
    isPastDeadline(order.requiredDate, order.requiredTime);
  const canEditNow = canUpdate && (!isOver || canManageOverdue);

  const load = useCallback(async () => {
    if (!orderId) return;
    const o = await orderRepository.findById(orderId);
    setOrder(o);
    if (!o) return;
    const [orderItems, atts, ackList, mems, thread] = await Promise.all([
      orderRepository.listItemsForOrder(orderId),
      attachmentRepository.listForOwner('ORDER', orderId),
      acknowledgementRepository.listForOrder(orderId),
      boardRepository.listMembers(o.boardId),
      threadRepository.listForOrder(orderId),
    ]);
    setItems(orderItems);
    setAttachments(atts);
    setAcks(ackList);
    setMembers(mems);
    setMessages(thread);

    // Ad-hoc lines carry their own name and have no catalogue row to look up.
    const menuItems = await Promise.all(
      orderItems
        .map((i) => i.menuItemId)
        .filter((id): id is string => id !== null)
        .map((id) => masterRepository.findMenuItemById(id)),
    );
    const byId: Record<string, MenuItemDto> = {};
    menuItems.forEach((mi) => {
      if (mi) byId[mi.id] = mi;
    });
    setMenuItemsById(byId);

    const uris: Record<string, string> = {};
    for (const a of atts) {
      const path = await attachmentRepository.resolveLocalPath(a);
      if (path) uris[a.id] = path;
    }
    setLocalUris(uris);
  }, [orderId]);

  useSyncedFocusLoad(load);

  const lastSyncAt = useSyncStatusStore((s) => s.lastSyncAt);
  useEffect(() => {
    if (lastSyncAt) load();
  }, [lastSyncAt, load]);

  const pendingUserIds = useMemo(() => {
    const acknowledgedIds = new Set(acks.map((a) => a.userId));
    return members.filter((m) => !acknowledgedIds.has(m.userId));
  }, [members, acks]);

  const myAck = useMemo(() => acks.find((a) => a.userId === user?.id), [acks, user]);
  // You don't acknowledge your own order — there is no one else to signal to.
  const isOwnOrder = order?.createdBy === user?.id;

  // Status changes and acknowledgements no longer interrupt the Activity list one pill at a
  // time; they collect into the pinned status thread instead (see StatusThreadSheet).
  const statusEvents = useMemo(
    () =>
      messages.filter(
        (m) => m.messageType === 'SYSTEM' && m.systemEvent !== null && STATUS_THREAD_EVENTS.has(m.systemEvent),
      ),
    [messages],
  );
  const activityMessages = useMemo(
    () =>
      messages.filter(
        (m) => !(m.messageType === 'SYSTEM' && m.systemEvent !== null && STATUS_THREAD_EVENTS.has(m.systemEvent)),
      ),
    [messages],
  );

  // Derived from the shared state machine rather than a local list, so the sheet can never
  // offer a move the server would reject. A billed order offers nothing: it is frozen.
  const availableTransitions = useMemo<OrderStatus[]>(() => {
    if (order === null || isOrderLocked(order) || (isOver && !canManageOverdue)) return [];
    return Object.values(OrderStatusEnum).filter(
      (candidate) => candidate !== order.status && canTransitionOrderStatus(order.status, candidate),
    );
  }, [order, isOver, canManageOverdue]);

  const onChangeStatus = async (status: OrderStatus): Promise<void> => {
    if (!order || !user) return;
    setBusy(true);
    try {
      await orderRepository.updateStatusLocal(order.id, status, user.id);
      setStatusSheetOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const onAcknowledge = async (): Promise<void> => {
    if (!order || !user) return;
    setBusy(true);
    try {
      await acknowledgementRepository.acknowledgeLocal(order.id, user.id);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const onWithdrawAck = async (): Promise<void> => {
    if (!order || !user) return;
    setBusy(true);
    try {
      await acknowledgementRepository.withdrawLocal(order.id, user.id);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const onPostMessage = async (): Promise<void> => {
    if (!order || !user || !composeText.trim()) return;
    setBusy(true);
    try {
      // board first, order second — a reply from here still belongs to the board's one feed.
      await threadRepository.postLocal(order.boardId, user.id, {
        orderId: order.id,
        body: composeText.trim(),
      });
      setComposeText('');
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!order) return <EmptyState title="Loading order…" />;

  const imageAttachments = attachments.filter((a) => a.kind === 'IMAGE');
  const voiceAttachments = attachments.filter((a) => a.kind === 'VOICE_NOTE');

  return (
    <View style={styles.container}>
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        data={activityMessages}
        keyExtractor={(m) => m.id}
        ListHeaderComponent={
          <View>
            <Card style={styles.headerCard}>
              <View style={styles.headerTop}>
                <StatusBadge
                  order={order}
                  size="md"
                  overrideLabel={isOver ? { label: 'Over', bg: colors.dangerBg, fg: colors.danger } : undefined}
                />
                <View style={styles.headerTopRight}>
                  {statusEvents.length > 0 ? (
                    <PressableScale
                      onPress={() => setStatusThreadOpen(true)}
                      accessibilityRole="button"
                      accessibilityLabel="View status history"
                    >
                      <View style={styles.pinButton}>
                        <Ionicons name="pin-outline" size={14} color={colors.gray500} />
                        <Text style={styles.pinCount}>{statusEvents.length}</Text>
                      </View>
                    </PressableScale>
                  ) : null}
                  {order.syncSeq === 0 ? <Text style={styles.pendingBadge}>Pending sync</Text> : null}
                </View>
              </View>
              <Text style={styles.orderNumber}>{order.orderNumber}</Text>
              <Text style={styles.venue}>{order.venue}</Text>
              <View style={styles.metaRow}>
                <MetaPill icon="calendar-outline" label={`${formatDateDisplay(order.requiredDate)} · ${order.requiredTime}`} />
                <MetaPill icon="people-outline" label={`Pax ${order.pax}`} />
                <MetaPill icon="flag-outline" label={order.priority} />
              </View>
              <View style={styles.actionRow}>
                {canChangeStatus && availableTransitions.length > 0 ? (
                  <PrimaryButton label="Change status" variant="secondary" onPress={() => setStatusSheetOpen(true)} />
                ) : null}
                {canEditNow && !isOrderLocked(order) && order.status !== 'CANCELLED' ? (
                  <PrimaryButton
                    label="Edit"
                    variant="ghost"
                    onPress={() => router.push({ pathname: '/orders/[orderId]/edit', params: { orderId: order.id } })}
                  />
                ) : null}
              </View>
            </Card>

            {imageAttachments.length > 0 || voiceAttachments.length > 0 ? (
              <Section title="Attachments">
                <View style={styles.imageGrid}>
                  {imageAttachments.map((a) => (
                    <PressableScale
                      key={a.id}
                      onPress={() => setExpandedImage(a.id)}
                      accessibilityRole="button"
                      accessibilityLabel="View attached photo"
                    >
                      <Image source={{ uri: localUris[a.id] ?? a.storagePath }} style={styles.gridThumb} />
                    </PressableScale>
                  ))}
                </View>
                {voiceAttachments.map((a) => (
                  <VoiceNoteRow key={a.id} attachment={a} uri={localUris[a.id]} />
                ))}
              </Section>
            ) : null}

            <View style={styles.menuPanel}>
              <LabelCaps style={styles.menuPanelTitle}>Menu Requirements</LabelCaps>
              {items.map((item, index) => {
                const name =
                  item.customItemName ??
                  (item.menuItemId === null ? null : menuItemsById[item.menuItemId]?.name) ??
                  item.menuItemName ??
                  'Item';
                return (
                  <View
                    key={item.id}
                    style={[styles.menuLine, index === items.length - 1 && styles.menuLineLast]}
                  >
                    <View style={styles.menuLineRow}>
                      <Text style={styles.menuName} numberOfLines={2}>
                        {index + 1}. {name}
                      </Text>
                      <Text style={styles.menuQty}>{item.quantity}</Text>
                      <Text style={styles.menuUnit}>{item.unit}</Text>
                    </View>
                    {item.notes ? <Text style={styles.itemNotes}>{item.notes}</Text> : null}
                    {item.mentionedUserIds.length > 0 ? (
                      <View style={styles.mentionRow}>
                        {item.mentionedUserIds.map((uid) => (
                          <MentionChip key={uid} userId={uid} members={members} />
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>

            <Section title="Acknowledgements">
              <View style={styles.ackHeader}>
                <AvatarStack names={acks.map((a) => a.userName ?? 'Member')} max={5} size="md" />
                <Text style={styles.ackCount}>
                  {acks.length}/{members.length}
                </Text>
              </View>
              {pendingUserIds.length > 0 ? (
                <Text style={styles.pendingAckLine}>
                  Pending: {pendingUserIds.map((m) => m.userName ?? m.userId).join(', ')}
                </Text>
              ) : null}
              {canAcknowledge && !isOwnOrder && !isOver ? (
                myAck ? (
                  <PrimaryButton label="Withdraw acknowledgement" variant="secondary" onPress={onWithdrawAck} loading={busy} />
                ) : (
                  <PrimaryButton label="Acknowledge" onPress={onAcknowledge} loading={busy} />
                )
              ) : null}
            </Section>

            {canPost ? (
              <View style={styles.composeBox}>
                <TextInput
                  style={styles.composeInput}
                  placeholder="Write a message…"
                  placeholderTextColor={colors.gray400}
                  value={composeText}
                  onChangeText={setComposeText}
                  multiline
                />
                <PressableScale
                  onPress={onPostMessage}
                  disabled={!composeText.trim() || busy}
                  accessibilityRole="button"
                  accessibilityLabel="Send message"
                >
                  <View style={[styles.sendButton, (!composeText.trim() || busy) && styles.sendButtonDisabled]}>
                    <Ionicons name="send" size={18} color={colors.white} />
                  </View>
                </PressableScale>
              </View>
            ) : null}

            <Text style={styles.sectionTitle}>Activity</Text>
          </View>
        }
        renderItem={({ item, index }) =>
          item.messageType === 'SYSTEM' ? (
            <SystemMessage message={item} />
          ) : (
            <Animated.View entering={FadeInUp.delay(index * 30).duration(250)}>
              <UserMessage message={item} members={members} />
            </Animated.View>
          )
        }
        ListEmptyComponent={<EmptyState title="No activity yet" />}
      />
      <StatusSheet
        isOpen={statusSheetOpen}
        onClose={() => setStatusSheetOpen(false)}
        transitions={availableTransitions}
        onSelect={onChangeStatus}
      />
      <ThemedBottomSheet
        isOpen={expandedImage !== null}
        onClose={() => setExpandedImage(null)}
        title="Attachment"
        snapPoints={['60%', '90%']}
      >
        {expandedImage ? (
          <Image
            source={{ uri: localUris[expandedImage] ?? attachments.find((a) => a.id === expandedImage)?.storagePath }}
            style={styles.expandedImage}
            resizeMode="contain"
          />
        ) : null}
      </ThemedBottomSheet>
      <StatusThreadSheet
        isOpen={statusThreadOpen}
        onClose={() => setStatusThreadOpen(false)}
        events={statusEvents}
        language={language}
      />
    </View>
  );
}

function StatusSheet({ isOpen, onClose, transitions, onSelect }: { isOpen: boolean; onClose: () => void; transitions: readonly OrderStatus[]; onSelect: (status: OrderStatus) => void }): React.JSX.Element {
  const labels: Record<string, string> = {
    PENDING: 'Mark pending',
    ACKNOWLEDGED: 'Mark acknowledged',
    WORK_IN_PROGRESS: 'Mark in progress',
    COMPLETED: 'Mark completed',
    CANCELLED: 'Mark cancelled',
  };
  return (
    <ThemedBottomSheet isOpen={isOpen} onClose={onClose} title="Change status" snapPoints={['35%', '50%']}>
      <View>
        {transitions.map((status) => (
          <PressableScale key={status} onPress={() => onSelect(status)}>
            <View style={styles.statusOption}>
              <Text style={styles.statusOptionText}>{labels[status] ?? status}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.gray400} />
            </View>
          </PressableScale>
        ))}
      </View>
    </ThemedBottomSheet>
  );
}

function MetaPill({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }): React.JSX.Element {
  return (
    <View style={styles.metaPill}>
      <Ionicons name={icon} size={13} color={colors.gray500} />
      <Text style={styles.metaText}>{label}</Text>
    </View>
  );
}

function MentionChip({ userId, members }: { userId: string; members: BoardMemberDto[] }): React.JSX.Element {
  const name = members.find((m) => m.userId === userId)?.userName ?? userId.slice(0, 4);
  return (
    <View style={styles.mentionChip}>
      <Text style={styles.mentionChipText}>@{name}</Text>
    </View>
  );
}

function VoiceNoteRow({
  attachment,
  uri,
}: {
  attachment: AttachmentDto;
  uri?: string;
}): React.JSX.Element {
  const [sound, setSound] = useState<ExpoAudio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(attachment.durationMs ?? 0);

  useEffect(() => {
    if (!uri) return undefined;
    let active = true;
    let loaded: ExpoAudio.Sound | null = null;

    const load = async (): Promise<void> => {
      try {
        await ExpoAudio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
        });
        const { sound: s, status } = await ExpoAudio.Sound.createAsync(
          { uri },
          { progressUpdateIntervalMillis: 250 },
          (status: AVPlaybackStatus) => {
            if (!active) return;
            if (status.isLoaded) {
              setPosition(status.positionMillis);
              setDuration(status.durationMillis ?? attachment.durationMs ?? 0);
              if (status.didJustFinish) {
                setIsPlaying(false);
                s.setPositionAsync(0).catch(() => { });
              }
            }
          },
        );
        if (active) {
          loaded = s;
          setSound(s);
          if (status.isLoaded) {
            setDuration(status.durationMillis ?? attachment.durationMs ?? 0);
          }
        } else {
          s.unloadAsync().catch(() => { });
        }
      } catch {
        // Leave the play button disabled if the file could not be loaded.
      }
    };

    void load();

    return () => {
      active = false;
      loaded?.unloadAsync().catch(() => { });
    };
  }, [uri, attachment.durationMs]);

  const onToggle = async (): Promise<void> => {
    if (!sound) return;
    if (isPlaying) {
      await sound.pauseAsync();
      setIsPlaying(false);
    } else {
      await sound.playAsync();
      setIsPlaying(true);
    }
  };

  const bars = [12, 20, 14, 28, 18, 24, 16, 22, 14, 18, 10, 16, 20, 14, 18];
  const seconds = Math.max(0, Math.round(duration / 1000));
  const formatted = `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
  const canPlay = !!uri && !!sound;

  return (
    <View style={styles.voiceRow}>
      <PressableScale
        onPress={onToggle}
        disabled={!canPlay}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'Pause voice note' : 'Play voice note'}
      >
        <View style={[styles.playButton, !canPlay && { backgroundColor: colors.gray300 }]}>
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={18} color={colors.white} />
        </View>
      </PressableScale>
      <View style={styles.waveform}>
        {bars.map((h, i) => {
          const played = duration > 0 && position / duration > i / bars.length;
          return (
            <View
              key={i}
              style={[styles.waveBar, { height: h, backgroundColor: played ? colors.primary600 : colors.primary200 }]}
            />
          );
        })}
      </View>
      <Text style={styles.voiceDuration}>{formatted}</Text>
    </View>
  );
}

function SystemMessage({ message }: { message: ThreadMessageDto }): React.JSX.Element {
  return (
    <View style={styles.systemRow}>
      <View style={styles.systemDot} />
      <Text style={styles.systemText}>{describeSystemEvent(message)}</Text>
      <Text style={styles.systemTime}>{formatDateTimeDisplay(message.createdAt)}</Text>
    </View>
  );
}

function UserMessage({ message, members }: { message: ThreadMessageDto; members: BoardMemberDto[] }): React.JSX.Element {
  const mentions = message.mentionedUserIds;
  return (
    <Card style={styles.messageCard}>
      <View style={styles.messageHeader}>
        <View style={styles.avatarBubble}>
          <Text style={styles.avatarInitial}>{initial(message.authorName ?? 'M')}</Text>
        </View>
        <View>
          <Text style={styles.messageAuthor}>{message.authorName ?? 'Member'}</Text>
          <Text style={styles.messageTime}>{formatDateTimeDisplay(message.createdAt)}</Text>
        </View>
      </View>
      <Text style={styles.messageBody}>{message.body}</Text>
      {mentions.length > 0 ? (
        <View style={styles.mentionRow}>
          {mentions.map((uid) => (
            <MentionChip key={uid} userId={uid} members={members} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Card style={styles.section}>
      <Text style={styles.sectionHeader}>{title}</Text>
      {children}
    </Card>
  );
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

const styles = StyleSheet.create({
  // Tinted wallpaper behind the Activity feed, distinct from the white message bubbles and
  // section cards sitting on top of it.
  container: { flex: 1, backgroundColor: colors.surfaceContainer },
  content: { padding: spacing[4], paddingBottom: spacing[12] },
  headerCard: { marginBottom: spacing[4] },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[3] },
  headerTopRight: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  pendingBadge: { fontFamily: fonts.sansBold, fontSize: typography.caption.size, color: colors.warning700, fontWeight: '700' },
  pinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radii.full,
    backgroundColor: colors.gray75,
  },
  pinCount: { fontFamily: fonts.sansBold, fontSize: typography.caption.size, fontWeight: '700', color: colors.gray500 },
  orderNumber: {
    fontFamily: fonts.sansBold,
    fontSize: typography.caption.size,
    fontWeight: typography.caption.weight,
    color: colors.gray500,
    marginBottom: spacing[1],
    letterSpacing: typography.caption.letterSpacing,
  },
  venue: { fontFamily: fonts.sansBold, fontSize: typography.title1.size, fontWeight: typography.title1.weight, color: colors.textPrimary, marginBottom: spacing[3] },
  metaRow: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[4] },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.gray75,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radii.full,
    gap: spacing[1],
  },
  metaText: { fontFamily: fonts.sansSemibold, fontSize: typography.caption.size, color: colors.textSecondary, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[2] },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[3] },
  gridThumb: { width: 88, height: 88, borderRadius: radii.md, backgroundColor: colors.gray200 },
  voiceRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.gray75, borderRadius: radii.md, padding: spacing[2], marginBottom: spacing[2] },
  playButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary600, alignItems: 'center', justifyContent: 'center' },
  waveform: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: spacing[3], height: 30 },
  waveBar: { width: 4, borderRadius: 2 },
  voiceDuration: { fontFamily: fonts.sansBold, fontSize: typography.caption.size, color: colors.textSecondary, fontWeight: '700' },
  section: { marginBottom: spacing[4] },
  sectionHeader: { fontFamily: fonts.sansBold, fontSize: typography.caption.size, fontWeight: typography.caption.weight, color: colors.textMuted, marginBottom: spacing[3], textTransform: 'uppercase' },
  sectionTitle: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.title3.size,
    fontWeight: typography.title3.weight,
    color: colors.textPrimary,
    marginTop: spacing[2],
    marginBottom: spacing[3],
  },
  menuPanel: {
    backgroundColor: colors.dataPanel,
    borderWidth: 1,
    borderColor: colors.dataPanelBorder,
    borderRadius: radii.lg,
    padding: spacing[3],
    marginBottom: spacing[4],
  },
  menuPanelTitle: { color: colors.primaryContainer, marginBottom: spacing[2] },
  menuLine: {
    paddingBottom: spacing[1.5],
    marginBottom: spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: colors.dataPanelBorder,
  },
  menuLineLast: { borderBottomWidth: 0, marginBottom: 0, paddingBottom: 0 },
  menuLineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  menuName: {
    flex: 1,
    fontFamily: fonts.mono,
    fontSize: typography.dataMono.size,
    lineHeight: typography.dataMono.lineHeight,
    fontWeight: typography.dataMono.weight,
    color: colors.onSurface,
  },
  menuQty: {
    width: 44,
    textAlign: 'right',
    fontFamily: fonts.mono,
    fontSize: typography.dataMono.size,
    lineHeight: typography.dataMono.lineHeight,
    fontWeight: '700',
    color: colors.onSurface,
    fontVariant: ['tabular-nums'],
  },
  menuUnit: {
    width: 42,
    fontFamily: fonts.mono,
    fontSize: typography.dataMono.size,
    lineHeight: typography.dataMono.lineHeight,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
  },
  itemNotes: { fontFamily: fonts.sansMedium, fontSize: typography.callout.size, color: colors.textSecondary, marginTop: spacing[1] },
  mentionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1.5], marginTop: spacing[2] },
  mentionChip: { backgroundColor: colors.primary100, paddingHorizontal: spacing[2], paddingVertical: spacing[1], borderRadius: radii.full },
  mentionChipText: { fontFamily: fonts.sansBold, fontSize: typography.caption.size, fontWeight: '700', color: colors.primary700 },
  ackHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing[3] },
  ackCount: { marginLeft: spacing[2], fontFamily: fonts.sansBold, fontSize: typography.body.size, fontWeight: '700', color: colors.textSecondary },
  pendingAckLine: { fontFamily: fonts.sansMedium, fontSize: typography.callout.size, color: colors.warning700, marginBottom: spacing[3] },
  composeBox: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[2], marginBottom: spacing[4] },
  composeInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radii.xl,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    maxHeight: 120,
    backgroundColor: colors.white,
    fontFamily: fonts.sans,
    fontSize: typography.body.size,
    color: colors.textPrimary,
  },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary600, alignItems: 'center', justifyContent: 'center' },
  sendButtonDisabled: { backgroundColor: colors.gray300 },
  systemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[2] },
  systemDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.gray400, marginRight: spacing[2] },
  systemText: { fontFamily: fonts.sansMedium, fontSize: typography.callout.size, color: colors.textMuted, fontStyle: 'italic' },
  systemTime: { fontFamily: fonts.sansBold, fontSize: typography.caption.size, color: colors.gray400, marginLeft: 'auto' },
  messageCard: { marginBottom: spacing[3] },
  messageHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing[2] },
  avatarBubble: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary100,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[2],
  },
  avatarInitial: { fontFamily: fonts.sansBold, fontSize: typography.caption.size, fontWeight: '800', color: colors.primary700 },
  messageAuthor: { fontFamily: fonts.sansBold, fontSize: typography.callout.size, fontWeight: '700', color: colors.textPrimary },
  messageTime: { fontFamily: fonts.sansBold, fontSize: typography.caption.size, color: colors.gray400 },
  messageBody: { fontFamily: fonts.sans, fontSize: typography.body.size, color: colors.textSecondary, lineHeight: typography.body.lineHeight },
  expandedImage: { width: '100%', height: '100%', borderRadius: radii.md },
  statusOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
  },
  statusOptionText: { fontFamily: fonts.sansBold, fontSize: typography.body.size, fontWeight: '700', color: colors.textPrimary },
});
