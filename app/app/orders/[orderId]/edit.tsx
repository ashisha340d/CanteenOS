import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type {
  MenuCategoryDto,
  MenuItemDto,
  OrderDto,
  OrderItemDto,
  OrderPriority,
} from '@menuboard/shared';
import { UserRole } from '@menuboard/shared';
import { masterRepository, orderRepository } from '../../../src/db/repositories';
import { useAuthStore } from '../../../src/state/authStore';
import { useLanguage } from '../../../src/state/languageStore';
import { isPastDeadline } from '../../../src/hooks/useCountdown';
import { FormInput } from '../../../src/components/FormInput';
import { PrimaryButton } from '../../../src/components/PrimaryButton';
import { PressableScale } from '../../../src/components/PressableScale';
import { PickerSheet } from '../../../src/components/PickerSheet';
import { Card } from '../../../src/components/Card';
import { EmptyState } from '../../../src/components/EmptyState';
import { OrderItemsEditor, type DraftLine } from '../../../src/components/order/OrderItemsEditor';
import { DateTimeFields, isValidRequiredDateTime } from '../../../src/components/order/DateTimeFields';
import { menuItemName, menuItemUnit } from '../../../src/i18n';
import { colors, spacing, typography, fonts } from '../../../src/theme/tokens';

const PRIORITIES: OrderPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
const PRIORITY_LABEL: Record<OrderPriority, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export default function EditOrderScreen(): React.JSX.Element {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const router = useRouter();
  const language = useLanguage();
  const user = useAuthStore((s) => s.user);
  const canManageOverdue =
    user?.role === UserRole.SUPER_ADMIN ||
    user?.role === UserRole.ADMIN ||
    user?.role === UserRole.MANAGER;

  const [order, setOrder] = useState<OrderDto | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItemDto[]>([]);
  const [categories, setCategories] = useState<MenuCategoryDto[]>([]);
  const [venue, setVenue] = useState('');
  const [pax, setPax] = useState('');
  const [requiredDate, setRequiredDate] = useState('');
  const [requiredTime, setRequiredTime] = useState('');
  const [priority, setPriority] = useState<OrderPriority>('NORMAL');
  const [lines, setLines] = useState<DraftLine[]>([]);
  /** Cancelled lines, kept out of the editor but carried back into the save. */
  const [cancelledItems, setCancelledItems] = useState<OrderItemDto[]>([]);
  const [showPrioritySheet, setShowPrioritySheet] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orderId) return;
    const [o, items, allMenuItems, allCategories] = await Promise.all([
      orderRepository.findById(orderId),
      orderRepository.listItemsForOrder(orderId),
      masterRepository.listActiveMenuItems(),
      masterRepository.listActiveMenuCategories(),
    ]);
    if (!o) return;
    setOrder(o);
    setVenue(o.venue);
    setPax(String(o.pax));
    setRequiredDate(o.requiredDate);
    setRequiredTime(o.requiredTime);
    setPriority(o.priority);
    setMenuItems(allMenuItems);
    setCategories(allCategories);

    // A cancelled line is history, not something to re-edit: it belongs struck through on the
    // feed card, not as a live row in the editor. It is held aside rather than dropped —
    // `updateLocal` replaces the item set wholesale, so a line missing from the save is a line
    // deleted, and the order would lose the record of what was cancelled.
    setCancelledItems(items.filter((item) => item.cancelledAt !== null));

    // Keyed by the existing line id so a resave keeps each row's identity — the server
    // updates a surviving line in place rather than tombstoning and recreating it.
    const byId = new Map(allMenuItems.map((mi) => [mi.id, mi]));
    setLines(
      items
        .filter((item: OrderItemDto) => item.cancelledAt === null)
        .map((item: OrderItemDto): DraftLine => {
          const master = item.menuItemId === null ? undefined : byId.get(item.menuItemId);
          return {
            key: item.id,
            menuItemId: item.menuItemId,
            customItemName: item.customItemName,
            name:
              item.customItemName ??
              menuItemName(master, language) ??
              item.menuItemName ??
              'Item',
            unit: item.unit || menuItemUnit(master, language) || 'NOS',
            quantity: item.quantity,
            notes: item.notes ?? '',
            mentionedUserIds: item.mentionedUserIds,
          };
        }),
    );
  }, [orderId, language]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const isOver =
    order !== null &&
    !['DELIVERED', 'DONE', 'CANCELLED'].includes(order.status) &&
    isPastDeadline(order.requiredDate, order.requiredTime);
  const locked = isOver && !canManageOverdue;

  const onSave = async (): Promise<void> => {
    if (!order || locked) return;
    if (!venue.trim()) {
      setError('Venue is required.');
      return;
    }
    // Same rules the composer enforces — an edit must not be able to produce an order the
    // create flow would have refused.
    const paxCount = Number(pax);
    if (pax.trim() === '' || !Number.isFinite(paxCount) || paxCount <= 0 || !Number.isInteger(paxCount)) {
      setError('Pax must be a whole number above zero.');
      return;
    }
    if (!isValidRequiredDateTime(requiredDate, requiredTime)) {
      setError('Pick a date and time in the future.');
      return;
    }
    if (lines.length === 0) {
      setError('At least one item is required.');
      return;
    }
    if (lines.some((line) => !(line.quantity > 0))) {
      setError('Every item needs a quantity above zero.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await orderRepository.updateLocal(order.id, {
        venue: venue.trim(),
        pax: Number(pax) || 0,
        requiredDate,
        requiredTime,
        priority,
        expectedRevision: order.revision,
        items: [
          ...lines.map((line, index) => ({
            id: line.key,
            menuItemId: line.menuItemId,
            customItemName: line.customItemName,
            quantity: line.quantity,
            unit: line.unit,
            notes: line.notes.trim() || null,
            mentionedUserIds: line.mentionedUserIds,
            sortOrder: index,
          })),
          // Re-appended untouched; `updateLocal` reads their cancellation back off the
          // existing rows, so they land struck through exactly as they were.
          ...cancelledItems.map((item, index) => ({
            id: item.id,
            menuItemId: item.menuItemId,
            customItemName: item.customItemName,
            quantity: item.quantity,
            unit: item.unit,
            notes: item.notes,
            mentionedUserIds: item.mentionedUserIds,
            sortOrder: lines.length + index,
          })),
        ],
      });
      // Back to the conversation the order lives in, not to its detail sheet. The board feed
      // is where the edit is actually visible — the card redraws with the new figures and the
      // system line recording the change appears in its history.
      router.replace({ pathname: '/boards/[boardId]', params: { boardId: order.boardId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!order) return <EmptyState title="Loading order…" />;
  if (locked) {
    return (
      <EmptyState
        title="Order is over"
        subtitle="Its required time has passed. Only a Super Admin, Admin or Manager can edit it now."
      />
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          headerRight: () => (
            <PressableScale onPress={onSave} disabled={submitting} hitSlop={8}>
              <Text style={[styles.headerSave, submitting && styles.headerSaveDisabled]}>Save</Text>
            </PressableScale>
          ),
        }}
      />
      <Animated.View entering={FadeInUp.duration(400).springify()}>
        <Card style={styles.card}>
          <FormInput label="Venue" value={venue} onChangeText={setVenue} />
          <FormInput label="Pax" value={pax} onChangeText={setPax} keyboardType="numeric" />
          <DateTimeFields
            date={requiredDate}
            time={requiredTime}
            onChangeDate={setRequiredDate}
            onChangeTime={setRequiredTime}
          />

          <Text style={styles.fieldLabel}>Priority</Text>
          <PressableScale onPress={() => setShowPrioritySheet(true)}>
            <Card style={styles.selectorCard}>
              <Text style={styles.selectorLabel}>Priority</Text>
              <Text style={styles.selectorValue}>{PRIORITY_LABEL[priority]}</Text>
              <Ionicons name="chevron-down" size={18} color={colors.gray400} style={styles.selectorChevron} />
            </Card>
          </PressableScale>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.fieldLabel}>Items</Text>
          <OrderItemsEditor
            menuItems={menuItems}
            categories={categories}
            lines={lines}
            onChange={setLines}
            language={language}
          />
        </Card>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.submitWrap}>
          <PrimaryButton label="Save changes" onPress={onSave} loading={submitting} />
        </View>
      </Animated.View>

      <PickerSheet
        isOpen={showPrioritySheet}
        onClose={() => setShowPrioritySheet(false)}
        title="Priority"
        options={PRIORITIES.map((p) => ({ id: p, label: PRIORITY_LABEL[p] }))}
        selectedId={priority}
        onSelect={(o) => setPriority(o.id as OrderPriority)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing[4], paddingBottom: spacing[12] },
  card: { marginBottom: spacing[4] },
  fieldLabel: {
    fontFamily: fonts.sansBold,
    fontSize: typography.caption.size,
    fontWeight: typography.caption.weight,
    color: colors.textMuted,
    marginBottom: spacing[2],
    textTransform: 'uppercase',
  },
  selectorCard: { marginBottom: spacing[2], paddingVertical: spacing[4] },
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
  error: { color: colors.danger500, marginTop: spacing[3], fontWeight: '600' },
  submitWrap: { marginTop: spacing[6] },
  headerSave: {
    fontFamily: fonts.sansBold,
    fontSize: typography.body.size,
    fontWeight: '700',
    color: colors.primary,
    marginRight: spacing[3],
  },
  headerSaveDisabled: { color: colors.gray400 },
});
