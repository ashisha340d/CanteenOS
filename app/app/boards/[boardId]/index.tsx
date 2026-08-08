import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type {
  AcknowledgementDto,
  AttachmentDto,
  BoardDto,
  BoardMemberDto,
  MenuItemDto,
  OrderDto,
  OrderItemDto,
  OrderStatus,
  ThreadMessageDto,
} from '@menuboard/shared';
import { Capability, UserRole, isOrderLocked } from '@menuboard/shared';
import {
  acknowledgementRepository,
  attachmentRepository,
  boardRepository,
  masterRepository,
  orderRepository,
  threadRepository,
} from '../../../src/db/repositories';
import { useAuthStore } from '../../../src/state/authStore';
import { useLanguage } from '../../../src/state/languageStore';
import { useBoardCapability } from '../../../src/permissions/useBoardCapability';
import { shoppingApi } from '../../../src/api';
import { OrderFeedCard } from '../../../src/components/feed/OrderFeedCard';
import { MessageBubble, SystemLine } from '../../../src/components/feed/MessageBubble';
import { DateSeparator } from '../../../src/components/feed/FeedPrimitives';
import { ComposeBar } from '../../../src/components/feed/ComposeBar';
import { OrderHistorySheet } from '../../../src/components/feed/OrderHistorySheet';
import { NewOrderFlash } from '../../../src/components/feed/NewOrderFlash';
import { FeedBackground } from '../../../src/components/feed/FeedBackground';
import { ActionSheet, type ActionSheetItem } from '../../../src/components/ActionSheet';
import { PickerSheet } from '../../../src/components/PickerSheet';
import { QuantitySheet } from '../../../src/components/feed/QuantitySheet';
import { describeSystemEvent } from '../../../src/components/feed/systemEventText';
import { RecipeSheet } from '../../../src/components/RecipeSheet';
import { EmptyState } from '../../../src/components/EmptyState';
import { PressableScale } from '../../../src/components/PressableScale';
import { useVoiceNoteRecorder } from '../../../src/hooks/useVoiceNoteRecorder';
import { useSyncedFocusLoad } from '../../../src/hooks/useSyncedFocusLoad';
import { useNewOrderAlertStore } from '../../../src/alerts/newOrderAlert';
import { pickBoardAttachment } from '../../../src/utils/attachmentPicker';
import { orderLineName, t } from '../../../src/i18n';
import { colors, spacing, typography, fonts } from '../../../src/theme/tokens';

/**
 * The board feed — the screen the product is actually about.
 *
 * One chronological stream carries everything that happened on this board: structured order
 * cards, the acknowledgements they collected, the messages and voice notes people posted
 * about them, and the system lines recording every quantity and pax edit. There is no
 * separate "chat" and no separate "order list"; an order is a structured message in the feed,
 * which is what makes this readable in a way a WhatsApp group never is.
 *
 * Messages that name an order live *inside* its card's block — the "div" — rather than as
 * their own row wherever they land chronologically. A reply added just now to an order
 * raised an hour ago appears right under that order, not at the bottom of the whole feed
 * behind everything else that happened in between.
 */

type FeedEntry =
  | { kind: 'DATE'; key: string; label: string }
  | {
    kind: 'ORDER';
    key: string;
    order: OrderDto;
    message: ThreadMessageDto;
    /** Every reply and order-scoped edit, in the order they arrived — the order's own div. */
    replies: ThreadMessageDto[];
  }
  | { kind: 'MESSAGE'; key: string; message: ThreadMessageDto; nested: boolean }
  | { kind: 'SYSTEM'; key: string; message: ThreadMessageDto };

interface FeedData {
  board: BoardDto | null;
  /** Board roster — the candidate list when assigning an order. */
  members: BoardMemberDto[];
  /** Whether the signed-in user is actually assigned to this board (or an admin who reaches
   * across board boundaries) — checked so a board is never rendered for someone with no
   * membership on it, however they got to the URL. */
  hasAccess: boolean;
  entries: FeedEntry[];
  itemsByOrder: Map<string, OrderItemDto[]>;
  acksByOrder: Map<string, AcknowledgementDto[]>;
  /** Status changes and acknowledgements, per order — collapsed behind the pin, not inline. */
  statusEventsByOrder: Map<string, ThreadMessageDto[]>;
  attachmentsByMessage: Map<string, AttachmentDto[]>;
  localUris: Record<string, string>;
  menuItems: Map<string, MenuItemDto>;
}

const EMPTY: FeedData = {
  board: null,
  members: [],
  hasAccess: true,
  entries: [],
  itemsByOrder: new Map(),
  acksByOrder: new Map(),
  statusEventsByOrder: new Map(),
  attachmentsByMessage: new Map(),
  localUris: {},
  menuItems: new Map(),
};

/**
 * System events never appear in the feed as their own row.
 *
 * They used to: "New order …", "Menu changed", "Order updated", one pill after another, so a
 * single busy order buried the actual conversation under its own paperwork. Every one of them
 * is still kept — they are the edit history the specification requires — but they are
 * collected onto the order and read as a dated story through the history button on its card.
 *
 * `ORDER_CREATED` is the one exception: it is not paperwork, it *is* the order card.
 */
function isHistoryEvent(message: ThreadMessageDto): boolean {
  return (
    message.messageType === 'SYSTEM' &&
    message.systemEvent !== null &&
    message.systemEvent !== 'ORDER_CREATED'
  );
}

export default function BoardFeedScreen(): React.JSX.Element {
  const { boardId } = useLocalSearchParams<{ boardId: string }>();
  const router = useRouter();
  const language = useLanguage();
  const user = useAuthStore((s) => s.user);
  const isSyncing = useAuthStore((s) => s.isSyncing);
  const refreshLocalData = useAuthStore((s) => s.refreshLocalData);

  const canCreateOrder = useBoardCapability(boardId, Capability.ORDER_CREATE);
  const canPost = useBoardCapability(boardId, Capability.THREAD_POST);
  const canAcknowledge = useBoardCapability(boardId, Capability.ORDER_ACKNOWLEDGE);
  const canViewRecipe = useBoardCapability(boardId, Capability.RECIPE_READ);
  const canChangeStatus = useBoardCapability(boardId, Capability.ORDER_STATUS_UPDATE);
  const canEditQuantity = useBoardCapability(boardId, Capability.ORDER_QUANTITY_EDIT);
  const canGenerateShopping = useBoardCapability(boardId, Capability.SHOPPING_LIST_GENERATE);
  const canAssign = useBoardCapability(boardId, Capability.ORDER_ASSIGN);

  const [data, setData] = useState<FeedData>(EMPTY);
  const [recipeFor, setRecipeFor] = useState<{ item: OrderItemDto; pax: number } | null>(null);
  const [historyOrderId, setHistoryOrderId] = useState<string | null>(null);
  /** Which order's chevron menu is open. */
  const [menuOrder, setMenuOrder] = useState<OrderDto | null>(null);
  /** Which line's menu is open, and the order it belongs to. */
  const [itemMenu, setItemMenu] = useState<{ item: OrderItemDto; order: OrderDto } | null>(null);
  const [editQtyFor, setEditQtyFor] = useState<{ item: OrderItemDto; order: OrderDto } | null>(null);
  const [assignFor, setAssignFor] = useState<OrderDto | null>(null);
  /** The message being replied to; drives the compose bar's quoted header. */
  const [replyTo, setReplyTo] = useState<ThreadMessageDto | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList<FeedEntry>>(null);
  /** Which board's feed has already had its one-time jump to the newest entry — keyed by
   * board id, not a bare flag, so switching boards scrolls to the bottom again instead of
   * silently reusing the previous board's "already scrolled" state. */
  const autoScrolledBoardId = useRef<string | null>(null);
  const recorder = useVoiceNoteRecorder();

  const load = useCallback(async () => {
    if (!boardId || !user) return;
    const [board, messages, orders, membership, members] = await Promise.all([
      boardRepository.findById(boardId),
      threadRepository.listForBoard(boardId),
      orderRepository.listForBoard(boardId),
      boardRepository.findMembership(boardId, user.id),
      boardRepository.listMembers(boardId),
    ]);

    // A board is only ever shown to someone assigned to it — an Admin/Super Admin reaches
    // across board boundaries by role (BOARD_READ_ALL), everyone else needs an active
    // board_members row, however they arrived at this URL.
    const isAdmin = user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;
    const hasAccess = isAdmin || membership !== null;
    if (!hasAccess) {
      setData({ ...EMPTY, board, hasAccess: false });
      return;
    }

    const ordersById = new Map(orders.map((order) => [order.id, order]));
    const orderIds = orders.map((order) => order.id);
    const messageIds = messages.map((message) => message.id);

    const [itemsByOrder, acksByOrder, attachmentsByMessage] = await Promise.all([
      orderRepository.listItemsForOrders(orderIds),
      acknowledgementRepository.listForOrders(orderIds),
      attachmentRepository.listForOwners('THREAD_MESSAGE', messageIds),
    ]);

    const menuItemIds = new Set<string>();
    for (const items of itemsByOrder.values()) {
      for (const item of items) {
        if (item.menuItemId !== null) menuItemIds.add(item.menuItemId);
      }
    }
    const menuItems = await masterRepository.mapMenuItemsByIds([...menuItemIds]);

    // Resolve media up front so a scroll past a photo doesn't stutter while it downloads.
    const localUris: Record<string, string> = {};
    await Promise.all(
      [...attachmentsByMessage.values()].flat().map(async (attachment) => {
        const path = await attachmentRepository.resolveLocalPath(attachment);
        if (path !== null) localUris[attachment.id] = path;
      }),
    );

    const { entries, statusEventsByOrder } = buildEntries(messages, ordersById, language);

    setData({
      board,
      members,
      hasAccess: true,
      entries,
      itemsByOrder,
      acksByOrder,
      statusEventsByOrder,
      attachmentsByMessage,
      localUris,
      menuItems,
    });
  }, [boardId, language, user]);

  useSyncedFocusLoad(load);

  const flashOrderIds = useNewOrderAlertStore((s) => s.flashOrderIds);
  const clearFlash = useNewOrderAlertStore((s) => s.clearFlash);

  // A new order just landed on this board from another device: bring it into view. The flash
  // itself is per-card (NewOrderFlash below); this only makes sure the card is on screen.
  useEffect(() => {
    if (flashOrderIds.length === 0) return;
    const hasNewOrder = data.entries.some(
      (entry) => entry.kind === 'ORDER' && flashOrderIds.includes(entry.order.id),
    );
    if (hasNewOrder) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 120);
    }
  }, [data.entries, flashOrderIds]);

  const myAcks = useMemo(() => {
    const map = new Map<string, AcknowledgementDto>();
    if (!user) return map;
    for (const [orderId, acks] of data.acksByOrder) {
      const mine = acks.find((ack) => ack.userId === user.id);
      if (mine !== undefined) map.set(orderId, mine);
    }
    return map;
  }, [data.acksByOrder, user]);

  const acknowledge = async (orderId: string): Promise<void> => {
    if (!user) return;
    await acknowledgementRepository.acknowledgeLocal(orderId, user.id);
    await load();
  };

  const changeStatus = async (orderId: string, next: OrderStatus): Promise<void> => {
    if (!user) return;
    try {
      await orderRepository.updateStatusLocal(orderId, next, user.id);
      await load();
    } catch (error) {
      Alert.alert('Could not update', error instanceof Error ? error.message : 'Try again.');
    }
  };

  const assign = async (order: OrderDto, userId: string | null): Promise<void> => {
    if (!user) return;
    const member = data.members.find((m) => m.userId === userId);
    try {
      await orderRepository.assignLocal(order.id, userId, user.id, member?.userName ?? null);
      await load();
    } catch (error) {
      Alert.alert('Could not assign', error instanceof Error ? error.message : 'Try again.');
    }
  };

  /**
   * Shopping list generation is the one action here that is not local-first: the server
   * explodes each line into its recipe and scales it, and the device has no such engine. So
   * this reports failure plainly instead of queueing something it cannot compute.
   */
  const makeShoppingList = async (order: OrderDto): Promise<void> => {
    if (!boardId || busy) return;
    setBusy(true);
    try {
      const list = await shoppingApi.generate(boardId, { orderIds: [order.id] });
      await refreshLocalData();
      await load();
      Alert.alert('Shopping list ready', `${list.title ?? 'List'} was generated for this order.`);
    } catch (error) {
      Alert.alert(
        'Could not generate the list',
        error instanceof Error
          ? `${error.message}\n\nThis needs a connection — it is calculated on the server.`
          : 'This needs a connection — it is calculated on the server.',
      );
    } finally {
      setBusy(false);
    }
  };

  const editQuantity = async (
    order: OrderDto,
    item: OrderItemDto,
    quantity: number,
  ): Promise<void> => {
    const items = data.itemsByOrder.get(order.id) ?? [];
    try {
      await orderRepository.updateLocal(order.id, {
        expectedRevision: order.revision,
        items: items.map((line) => ({
          id: line.id,
          menuItemId: line.menuItemId,
          customItemName: line.customItemName,
          quantity: line.id === item.id ? quantity : line.quantity,
          unit: line.unit,
          notes: line.notes,
          mentionedUserIds: line.mentionedUserIds,
          sortOrder: line.sortOrder,
        })),
      });
      await load();
    } catch (error) {
      Alert.alert('Could not save', error instanceof Error ? error.message : 'Try again.');
    }
  };

  const sendMessage = async (text: string): Promise<void> => {
    if (!user || !boardId) return;
    // A reply carries both its parent *and* that parent's order, so it lands inside the same
    // order div rather than at the bottom of the feed as an unrelated post.
    await threadRepository.postLocal(boardId, user.id, {
      body: text,
      ...(replyTo !== null
        ? { parentMessageId: replyTo.id, orderId: replyTo.orderId }
        : {}),
    });
    setReplyTo(null);
    await load();
    scrollToEnd();
  };

  const sendVoiceNote = async (): Promise<void> => {
    if (!user || !boardId) return;
    const take = await recorder.stop();
    if (take === null) return;

    const message = await threadRepository.postLocal(boardId, user.id, { body: null });
    await attachmentRepository.captureLocal({
      ownerType: 'THREAD_MESSAGE',
      ownerId: message.id,
      kind: 'VOICE_NOTE',
      fileName: `voice-${Date.now()}.m4a`,
      mimeType: 'audio/m4a',
      localPath: take.uri,
      sizeBytes: take.sizeBytes,
      durationMs: take.durationMs,
      uploadedBy: user.id,
    });
    await load();
    scrollToEnd();
  };

  const attach = async (): Promise<void> => {
    if (!user || !boardId) return;
    const picked = await pickBoardAttachment();
    if (picked === null) return;

    const message = await threadRepository.postLocal(boardId, user.id, { body: null });
    await attachmentRepository.captureLocal({
      ownerType: 'THREAD_MESSAGE',
      ownerId: message.id,
      kind: picked.kind,
      fileName: picked.fileName,
      mimeType: picked.mimeType,
      localPath: picked.uri,
      sizeBytes: picked.sizeBytes,
      durationMs: null,
      width: picked.width,
      height: picked.height,
      uploadedBy: user.id,
    });
    await load();
    scrollToEnd();
  };

  const unsend = (message: ThreadMessageDto): void => {
    if (!user || message.authorId !== user.id) return;
    Alert.alert('Unsend message', 'This removes it for everyone on the board.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unsend',
        style: 'destructive',
        onPress: async () => {
          await threadRepository.deleteLocal(message.id);
          await load();
        },
      },
    ]);
  };

  const scrollToEnd = (): void => {
    // Deferred: the row for the message just posted has not been laid out yet.
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
  };

  if (data.board !== null && !data.hasAccess) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: data.board.name }} />
        <EmptyState
          title="No access"
          subtitle="You are not assigned to this board. Ask a board manager to add you."
        />
      </View>
    );
  }

  const menuItems = buildOrderMenu();

  return (
    <FeedBackground>
      <Stack.Screen
        options={{
          title: data.board?.name ?? 'Board',
        }}
      />

      <FlatList
        ref={listRef}
        data={data.entries}
        keyExtractor={(entry) => entry.key}
        contentContainerStyle={styles.list}
        // Jump to the newest entry once per board, when the feed first has content. This used
        // to fire on *every* content-size change, which snapped the view back to the bottom
        // the moment anything re-laid out — making it impossible to scroll up and read
        // history. Keying the guard by board id (rather than a bare flag) means switching
        // boards jumps to the bottom again instead of silently reusing the previous board's
        // "already scrolled" state.
        onContentSizeChange={() => {
          if (autoScrolledBoardId.current !== boardId && data.entries.length > 0) {
            autoScrolledBoardId.current = boardId ?? null;
            listRef.current?.scrollToEnd({ animated: false });
          }
        }}
        refreshControl={
          <RefreshControl
            refreshing={isSyncing}
            onRefresh={async () => {
              await refreshLocalData();
              await load();
            }}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <EmptyState
            title={t('noOrders', language)}
            subtitle={
              canCreateOrder
                ? 'Raise the first order and it appears here for everyone.'
                : 'Orders and messages posted to this board appear here.'
            }
          />
        }
        renderItem={({ item: entry }) => {
          switch (entry.kind) {
            case 'DATE':
              return <DateSeparator label={entry.label} />;

            case 'ORDER': {
              const order = entry.order;
              return (
                <NewOrderFlash
                  active={flashOrderIds.includes(order.id)}
                  onDone={() => clearFlash(order.id)}
                >
                  <OrderFeedCard
                    order={order}
                    items={data.itemsByOrder.get(order.id) ?? []}
                    menuItems={data.menuItems}
                    acknowledgements={data.acksByOrder.get(order.id) ?? []}
                    myAcknowledgement={myAcks.get(order.id)}
                    authorName={entry.message.authorName ?? 'Member'}
                    time={formatTime(entry.message.createdAt)}
                    language={language}
                    accentColor={data.board?.color ?? null}
                    assigneeName={
                      data.members.find((m) => m.userId === order.assignedTo)?.userName ?? null
                    }
                    // You don't acknowledge your own order — there is no one else to signal to.
                    canAcknowledge={canAcknowledge && order.createdBy !== user?.id}
                    canChangeStatus={canChangeStatus}
                    historyEvents={data.statusEventsByOrder.get(order.id) ?? []}
                    onAcknowledge={() => void acknowledge(order.id)}
                    onChangeStatus={(next) => void changeStatus(order.id, next)}
                    onOpenMenu={() => setMenuOrder(order)}
                    onOpenHistory={() => setHistoryOrderId(order.id)}
                    onPressItem={(item) => setItemMenu({ item, order })}
                    onPress={() =>
                      router.push({ pathname: '/orders/[orderId]', params: { orderId: order.id } })
                    }
                  >
                    {/* The order's own div: every reply and voice note lives right here, under
                      its order, regardless of what else happened on the board in between.
                      A reply to a reply is indented once more, directly beneath the message it
                      answers — the thread stays inside the div rather than being flung to the
                      bottom of the feed the way a chat app would. */}
                    {threadOf(entry.replies).map(({ message, depth }) =>
                      message.messageType === 'SYSTEM' ? (
                        <SystemLine
                          key={message.id}
                          text={describeSystemEvent(message, language)}
                          time={formatTime(message.createdAt)}
                        />
                      ) : (
                        <MessageBubble
                          key={message.id}
                          message={message}
                          attachments={data.attachmentsByMessage.get(message.id) ?? []}
                          localUris={data.localUris}
                          time={formatTime(message.createdAt)}
                          isMine={message.authorId === user?.id}
                          nested
                          depth={depth}
                          replyingToName={
                            message.parentMessageId === null
                              ? undefined
                              : entry.replies.find((r) => r.id === message.parentMessageId)
                                ?.authorName ?? undefined
                          }
                          onLongPress={
                            message.authorId === user?.id ? () => unsend(message) : undefined
                          }
                        />
                      ),
                    )}
                  </OrderFeedCard>
                </NewOrderFlash>
              );
            }

            case 'MESSAGE':
              return (
                <MessageBubble
                  message={entry.message}
                  attachments={data.attachmentsByMessage.get(entry.message.id) ?? []}
                  localUris={data.localUris}
                  time={formatTime(entry.message.createdAt)}
                  isMine={entry.message.authorId === user?.id}
                  nested={entry.nested}
                  onLongPress={
                    entry.message.authorId === user?.id ? () => unsend(entry.message) : undefined
                  }
                />
              );

            case 'SYSTEM':
              return (
                <SystemLine
                  text={describeSystemEvent(entry.message, language)}
                  time={formatTime(entry.message.createdAt)}
                />
              );
          }
        }}
      />

      {
        replyTo !== null ? (
          <View style={styles.replyBanner}>
            <View style={styles.replyBar} />
            <View style={styles.replyBody}>
              <Text style={styles.replyName} numberOfLines={1}>
                Replying to {replyTo.authorName ?? 'Member'}
              </Text>
              <Text style={styles.replyText} numberOfLines={1}>
                {replyTo.body ?? 'Attachment'}
              </Text>
            </View>
            <PressableScale onPress={() => setReplyTo(null)} hitSlop={8}>
              <Ionicons name="close" size={18} color={colors.onSurfaceVariant} />
            </PressableScale>
          </View>
        ) : null
      }

      <ComposeBar
        language={language}
        canPost={canPost}
        canCreateOrder={canCreateOrder}
        isRecording={recorder.isRecording}
        recordingMs={recorder.durationMs}
        recordingLevel={recorder.level}
        onSend={(text) => void sendMessage(text)}
        onNewOrder={() =>
          router.push({ pathname: '/boards/[boardId]/create-order', params: { boardId } })
        }
        onStartRecording={() => void recorder.start()}
        onStopRecording={() => void sendVoiceNote()}
        onCancelRecording={() => void recorder.cancel()}
        onAttach={() => void attach()}
      />

      {/* An ad-hoc line has no catalogue entry and therefore no recipe, so the sheet simply
          does not open for one. */}
      {
        recipeFor !== null && recipeFor.item.menuItemId !== null ? (
          <RecipeSheet
            menuItemId={recipeFor.item.menuItemId}
            menuItem={data.menuItems.get(recipeFor.item.menuItemId)}
            pax={recipeFor.pax}
            language={language}
            onClose={() => setRecipeFor(null)}
          />
        ) : null
      }

      <OrderHistorySheet
        isOpen={historyOrderId !== null}
        onClose={() => setHistoryOrderId(null)}
        orderNumber={
          historyOrderId === null
            ? null
            : data.entries.find(
              (e) => e.kind === 'ORDER' && e.order.id === historyOrderId,
            )?.kind === 'ORDER'
              ? (data.entries.find(
                (e) => e.kind === 'ORDER' && e.order.id === historyOrderId,
              ) as Extract<FeedEntry, { kind: 'ORDER' }>).order.orderNumber
              : null
        }
        events={historyOrderId !== null ? data.statusEventsByOrder.get(historyOrderId) ?? [] : []}
        language={language}
      />

      <ActionSheet
        isOpen={menuOrder !== null}
        onClose={() => setMenuOrder(null)}
        title={menuOrder?.orderNumber}
        items={menuItems}
      />

      <ActionSheet
        isOpen={itemMenu !== null}
        onClose={() => setItemMenu(null)}
        title={
          itemMenu === null
            ? undefined
            : orderLineName(itemMenu.item, data.menuItems, language, 'Item')
        }
        items={buildItemMenu()}
      />

      <PickerSheet
        isOpen={assignFor !== null}
        onClose={() => setAssignFor(null)}
        title="Assign to"
        searchable
        options={[
          { id: UNASSIGNED, label: 'Nobody (unassign)' },
          ...data.members.map((member) => ({
            id: member.userId,
            label: member.userName ?? member.userId.slice(0, 8),
            subtitle: member.boardRole,
          })),
        ]}
        selectedId={assignFor?.assignedTo ?? UNASSIGNED}
        onSelect={(option) => {
          const order = assignFor;
          if (order === null) return;
          void assign(order, option.id === UNASSIGNED ? null : option.id);
        }}
      />

      <QuantitySheet
        isOpen={editQtyFor !== null}
        onClose={() => setEditQtyFor(null)}
        itemName={
          editQtyFor === null
            ? ''
            : orderLineName(editQtyFor.item, data.menuItems, language, 'Item')
        }
        unit={editQtyFor?.item.unit ?? 'NOS'}
        quantity={editQtyFor?.item.quantity ?? 0}
        onSave={(next) => {
          const target = editQtyFor;
          if (target === null) return;
          void editQuantity(target.order, target.item, next);
        }}
      />

      {
        !canPost && !canCreateOrder ? (
          <View style={styles.readOnlyStrip}>
            <Ionicons name="eye-outline" size={14} color={colors.onSurfaceVariant} />
            <Text style={styles.readOnlyText}>
              {language === 'hi' ? 'केवल देखने की अनुमति' : 'View only'}
            </Text>
          </View>
        ) : null
      }
    </FeedBackground >
  );

  /**
   * The chevron menu.
   *
   * Entries the signed-in user may not use are left out rather than greyed out — a menu of
   * disabled rows trains people to stop opening it. `disabled` is used only where the action
   * is theirs but unavailable right now, and then it says why.
   */
  function buildOrderMenu(): ActionSheetItem[] {
    const order = menuOrder;
    if (order === null) return [];
    const items = data.itemsByOrder.get(order.id) ?? [];
    const catalogued = items.filter((item) => item.menuItemId !== null && item.cancelledAt === null);
    const built: ActionSheetItem[] = [];

    if (canViewRecipe && catalogued.length > 0) {
      built.push({
        id: 'recipe',
        label: 'View recipe',
        icon: 'book-outline',
        onPress: () => {
          const first = catalogued[0];
          // With one catalogued line there is nothing to choose; with several, the line menu
          // is the right place to pick, so this drops the user there rather than guessing.
          if (catalogued.length === 1 && first !== undefined) {
            setRecipeFor({ item: first, pax: order.pax });
          } else if (first !== undefined) {
            setItemMenu({ item: first, order });
          }
        },
      });
    }

    if (canGenerateShopping) {
      built.push({
        id: 'shopping',
        label: 'Make shopping list',
        icon: 'cart-outline',
        subtitle: 'Calculated on the server — needs a connection',
        disabled: busy,
        onPress: () => void makeShoppingList(order),
      });
    }

    if (canAssign) {
      built.push({
        id: 'assign',
        label: order.assignedTo === null ? 'Assign to user' : 'Reassign',
        icon: 'person-add-outline',
        onPress: () => setAssignFor(order),
      });
    }

    if (canPost) {
      const created = data.entries.find(
        (entry) => entry.kind === 'ORDER' && entry.order.id === order.id,
      );
      built.push({
        id: 'reply',
        label: 'Reply',
        icon: 'arrow-undo-outline',
        onPress: () => {
          if (created !== undefined && created.kind === 'ORDER') setReplyTo(created.message);
        },
      });
    }

    return built;
  }

  function buildItemMenu(): ActionSheetItem[] {
    const context = itemMenu;
    if (context === null) return [];
    const { item, order } = context;
    const built: ActionSheetItem[] = [];

    // An ad-hoc line was typed on the spot and has no catalogue entry, so there is no recipe
    // to show. The row is omitted rather than shown broken.
    if (canViewRecipe && item.menuItemId !== null) {
      built.push({
        id: 'recipe',
        label: 'View recipe',
        icon: 'book-outline',
        onPress: () => setRecipeFor({ item, pax: order.pax }),
      });
    }

    if (canEditQuantity && item.cancelledAt === null && !isOrderLocked(order)) {
      built.push({
        id: 'qty',
        label: 'Edit quantity',
        icon: 'calculator-outline',
        onPress: () => setEditQtyFor({ item, order }),
      });
    }

    return built;
  }
}

/** Sentinel option id for "assign to nobody", which is a real choice, not an absence. */
const UNASSIGNED = '__unassigned__';

/**
 * Orders an order's replies so a reply-to-a-reply sits directly beneath the message it
 * answers, one indent deeper — rather than at the end of the list in arrival order, the way a
 * flat chat log would show it.
 *
 * Depth is capped at 2: past that the indent eats the bubble on a phone, and a kitchen thread
 * does not need a tree.
 */
function threadOf(
  replies: readonly ThreadMessageDto[],
): { message: ThreadMessageDto; depth: number }[] {
  const childrenOf = new Map<string, ThreadMessageDto[]>();
  const roots: ThreadMessageDto[] = [];
  const ids = new Set(replies.map((reply) => reply.id));

  for (const reply of replies) {
    // A reply whose parent is not in this div (deleted, or on another order) is shown at the
    // top level rather than dropped — losing a message would be worse than losing its indent.
    if (reply.parentMessageId !== null && ids.has(reply.parentMessageId)) {
      const siblings = childrenOf.get(reply.parentMessageId);
      if (siblings === undefined) childrenOf.set(reply.parentMessageId, [reply]);
      else siblings.push(reply);
    } else {
      roots.push(reply);
    }
  }

  const output: { message: ThreadMessageDto; depth: number }[] = [];
  const walk = (message: ThreadMessageDto, depth: number): void => {
    output.push({ message, depth });
    for (const child of childrenOf.get(message.id) ?? []) walk(child, Math.min(depth + 1, 2));
  };
  for (const root of roots) walk(root, 0);
  return output;
}

/**
 * Interleaves messages with day separators and decides which shape each row takes.
 *
 * An `ORDER_CREATED` row becomes the structured card, but only when its order has synced
 * down — otherwise it falls back to a system line rather than rendering an empty card.
 *
 * Status changes and acknowledgements are not turned into feed rows at all: they are order
 * history, not conversation, so they are pulled into `statusEventsByOrder` for the pin/thread
 * on that order's card instead of interrupting the feed one pill at a time.
 *
 * Everything else that names an order — a reply, a voice note, an item edit — joins that
 * order's `replies` array instead of becoming its own top-level row. That is the "div": the
 * order card is a single feed entry that owns the whole conversation about it, so a reply
 * posted today to an order raised last week still renders directly under that order, not at
 * the bottom of the feed behind whatever else happened on the board since.
 */
function buildEntries(
  messages: readonly ThreadMessageDto[],
  ordersById: Map<string, OrderDto>,
  language: string,
): { entries: FeedEntry[]; statusEventsByOrder: Map<string, ThreadMessageDto[]> } {
  const entries: FeedEntry[] = [];
  const statusEventsByOrder = new Map<string, ThreadMessageDto[]>();
  const orderEntryByOrderId = new Map<string, Extract<FeedEntry, { kind: 'ORDER' }>>();
  let lastDay = '';

  for (const message of messages) {
    // All order paperwork collapses into that order's history sheet — never the feed itself.
    if (isHistoryEvent(message) && message.orderId !== null) {
      const existing = statusEventsByOrder.get(message.orderId);
      if (existing !== undefined) existing.push(message);
      else statusEventsByOrder.set(message.orderId, [message]);
      continue;
    }

    // Anything else that names an order it has already seen joins that order's div directly.
    if (message.orderId !== null) {
      const orderEntry = orderEntryByOrderId.get(message.orderId);
      if (orderEntry !== undefined) {
        // The card's own footer already says "New order …", so a second ORDER_CREATED row
        // inside the div would repeat it.
        if (message.systemEvent !== 'ORDER_CREATED') orderEntry.replies.push(message);
        continue;
      }
    }

    const day = message.createdAt.slice(0, 10);
    if (day !== lastDay) {
      entries.push({ kind: 'DATE', key: `date-${day}`, label: dayLabel(day, language) });
      lastDay = day;
    }

    if (message.messageType === 'SYSTEM') {
      const order =
        message.systemEvent === 'ORDER_CREATED' && message.orderId !== null
          ? ordersById.get(message.orderId)
          : undefined;
      if (order !== undefined) {
        const entry: Extract<FeedEntry, { kind: 'ORDER' }> = {
          kind: 'ORDER',
          key: message.id,
          order,
          message,
          replies: [],
        };
        entries.push(entry);
        orderEntryByOrderId.set(order.id, entry);
        // ORDER_CREATED renders as the card rather than as a history row, but the story still
        // has to start somewhere — so it is *also* seeded as the first entry in the timeline.
        statusEventsByOrder.set(order.id, [
          message,
          ...(statusEventsByOrder.get(order.id) ?? []),
        ]);
      } else {
        entries.push({ kind: 'SYSTEM', key: message.id, message });
      }
      continue;
    }

    entries.push({ kind: 'MESSAGE', key: message.id, message, nested: message.orderId !== null });
  }

  return { entries, statusEventsByOrder };
}

function dayLabel(isoDay: string, language: string): string {
  const parsed = new Date(`${isoDay}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDay;

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const delta = Math.round((startOfToday.getTime() - parsed.getTime()) / 86_400_000);

  if (delta === 0) return language === 'hi' ? 'आज' : 'Today';
  if (delta === 1) return language === 'hi' ? 'कल' : 'Yesterday';
  return parsed.toLocaleDateString(language === 'hi' ? 'hi-IN' : undefined, {
    day: '2-digit',
    month: 'short',
    year: delta > 300 ? 'numeric' : undefined,
  });
}

function formatTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const styles = StyleSheet.create({
  // A tinted "wallpaper" behind the feed, distinct from the white message/order cards sitting
  // on top of it — otherwise a white card on a near-white page has no edge to read against.
  container: { flex: 1, backgroundColor: colors.surfaceContainer },
  list: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing[3],
    paddingBottom: spacing[4],
    flexGrow: 1,
  },
  readOnlyStrip: {
    position: 'absolute',
    top: spacing[2],
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: 999,
    backgroundColor: colors.surfaceContainerHigh,
  },
  readOnlyText: { fontFamily: fonts.sans, fontSize: typography.bodySm.size, color: colors.onSurfaceVariant },

  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing[2],
    backgroundColor: colors.surfaceContainerLowest,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
  },
  replyBar: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.primary },
  replyBody: { flex: 1 },
  replyName: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.bodySm.size,
    fontWeight: '600',
    color: colors.primary,
  },
  replyText: { fontFamily: fonts.sans, fontSize: typography.bodySm.size, color: colors.outline },
});
