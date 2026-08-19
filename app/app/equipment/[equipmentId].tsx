import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type {
  EquipmentDto,
  EquipmentStatus,
  EquipmentSupplierLinkDto,
  MaintenanceActivityDto,
} from '@menuboard/shared';
import {
  CALL_OUTCOME_LABELS,
  Capability,
  CallOutcome,
  EQUIPMENT_STATUS_LABELS,
  EQUIPMENT_SUPPLIER_ROLE_LABELS,
  EquipmentStatus as Status,
  LIMITS,
  SUPPLIER_CONTACT_PREFERENCE,
} from '@menuboard/shared';
import { equipmentApi, equipmentErrorMessage } from '../../src/api/equipment';
import { useCapabilities } from '../../src/permissions/useCapabilities';
import { useSupplierContact } from '../../src/hooks/useSupplierContact';
import { ActionSheet, type ActionSheetItem } from '../../src/components/ActionSheet';
import { ThemedBottomSheet } from '../../src/components/BottomSheet';
import { EmptyState } from '../../src/components/EmptyState';
import { FormInput } from '../../src/components/FormInput';
import { LoadingScreen } from '../../src/components/LoadingScreen';
import { PressableScale } from '../../src/components/PressableScale';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { TopAppBar } from '../../src/components/TopAppBar';
import { EquipmentStatusChip, WarrantyChip } from '../../src/components/StatusChip';
import { ActivityTimeline } from '../../src/components/equipment/ActivityTimeline';
import { ChoiceChips, type Choice } from '../../src/components/equipment/ChoiceChips';
import { TicketRow } from '../../src/components/equipment/TicketRow';
import { formatDateDisplay } from '../../src/utils/date';
import { isUuid } from '../../src/utils/uuid';
import { radii, spacing, typography } from '../../src/theme/tokens';
import { useThemeColors } from '../../src/theme/useThemeColors';

/**
 * The equipment profile — the screen a scanned QR code lands on.
 *
 * `equipmentId` is whatever the link carried: a uuid from a list tap or a notification, or the
 * human asset id printed on the label (`menuboard://equipment/MTC-KIT-OVN-001`). A uuid is
 * fetched directly; anything else goes through `GET /equipment/resolve`, which also accepts a
 * raw QR payload and an NFC tag id.
 *
 * The action row is the point of the screen. Everything above it is context for deciding which
 * of the four buttons to press.
 */

const STATUS_CHOICES: readonly Choice<EquipmentStatus>[] = [
  { value: Status.OPERATIONAL, label: EQUIPMENT_STATUS_LABELS.OPERATIONAL },
  { value: Status.RUNNING, label: EQUIPMENT_STATUS_LABELS.RUNNING },
  { value: Status.IDLE, label: EQUIPMENT_STATUS_LABELS.IDLE },
  { value: Status.NEEDS_ATTENTION, label: EQUIPMENT_STATUS_LABELS.NEEDS_ATTENTION },
  { value: Status.PROBLEM, label: EQUIPMENT_STATUS_LABELS.PROBLEM },
  { value: Status.UNDER_MAINTENANCE, label: EQUIPMENT_STATUS_LABELS.UNDER_MAINTENANCE },
  { value: Status.OUT_OF_SERVICE, label: EQUIPMENT_STATUS_LABELS.OUT_OF_SERVICE },
  { value: Status.RETIRED, label: EQUIPMENT_STATUS_LABELS.RETIRED },
];

/** Maintenance supplier first: a broken oven is a service call, not a purchasing question. */
function preferredSupplier(
  links: readonly EquipmentSupplierLinkDto[],
): EquipmentSupplierLinkDto | null {
  for (const role of SUPPLIER_CONTACT_PREFERENCE) {
    const match = links.find((link) => link.role === role);
    if (match !== undefined) return match;
  }
  return links[0] ?? null;
}

function dueLabel(equipment: EquipmentDto): string {
  if (equipment.nextMaintenanceAt === null) return 'No service scheduled';
  const days = equipment.maintenanceDaysUntilDue;
  const date = formatDateDisplay(equipment.nextMaintenanceAt);
  if (days === null) return `Next service ${date}`;
  if (days < 0) return `Service overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
  if (days === 0) return `Service due today`;
  return `Next service ${date} · in ${days} day${days === 1 ? '' : 's'}`;
}

export default function EquipmentProfileScreen(): React.JSX.Element {
  const { equipmentId } = useLocalSearchParams<{ equipmentId: string }>();
  const router = useRouter();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { has } = useCapabilities();
  const contact = useSupplierContact();

  const canReport = has(Capability.EQUIPMENT_REPORT_PROBLEM);
  const canEdit = has(Capability.EQUIPMENT_EDIT);
  const canContact = has(Capability.SUPPLIER_CONTACT);
  const canSeeSuppliers = has(Capability.SUPPLIER_VIEW);

  const [equipment, setEquipment] = useState<EquipmentDto | null>(null);
  const [activities, setActivities] = useState<MaintenanceActivityDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statusSheetOpen, setStatusSheetOpen] = useState(false);
  const [nextStatus, setNextStatus] = useState<EquipmentStatus | null>(null);
  const [statusNote, setStatusNote] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [supplierSheet, setSupplierSheet] = useState<'call' | 'whatsapp' | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (equipmentId === undefined || equipmentId === '') return;
    setError(null);
    try {
      const found = isUuid(equipmentId)
        ? await equipmentApi.getById(equipmentId)
        : await equipmentApi.resolve(equipmentId);
      setEquipment(found);
      setActivities(await equipmentApi.activity(found.id));
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'That equipment could not be loaded.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [equipmentId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const suppliers = useMemo(() => equipment?.suppliers ?? [], [equipment]);

  const contactSupplier = useCallback(
    async (mode: 'call' | 'whatsapp', link: EquipmentSupplierLinkDto | null): Promise<void> => {
      if (equipment === null) return;
      if (mode === 'call') {
        const phone = link?.phone ?? null;
        if (phone === null) return;
        await contact.call({
          equipmentId: equipment.id,
          supplierId: link?.supplierId ?? null,
          phoneNumber: phone,
        });
        return;
      }
      await contact.whatsapp({
        equipmentId: equipment.id,
        supplierId: link?.supplierId ?? null,
      });
    },
    [contact, equipment],
  );

  const startContact = useCallback(
    (mode: 'call' | 'whatsapp'): void => {
      const usable =
        mode === 'call' ? suppliers.filter((link) => link.phone !== null) : suppliers;
      if (usable.length > 1) {
        setSupplierSheet(mode);
        return;
      }
      void contactSupplier(mode, usable[0] ?? preferredSupplier(suppliers));
    },
    [contactSupplier, suppliers],
  );

  const submitStatus = useCallback(async (): Promise<void> => {
    if (equipment === null || nextStatus === null) return;
    setSavingStatus(true);
    try {
      const updated = await equipmentApi.changeStatus(equipment.id, {
        status: nextStatus,
        note: statusNote.trim() === '' ? null : statusNote.trim(),
      });
      setEquipment(updated);
      setActivities(await equipmentApi.activity(updated.id));
      setStatusSheetOpen(false);
      setNextStatus(null);
      setStatusNote('');
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'The status was not changed.'));
    } finally {
      setSavingStatus(false);
    }
  }, [equipment, nextStatus, statusNote]);

  if (loading && equipment === null) {
    return <LoadingScreen label="Loading equipment…" />;
  }

  if (equipment === null) {
    return (
      <View style={styles.screen}>
        <TopAppBar title="Equipment" onBack={() => router.back()} />
        <EmptyState
          title="Not found"
          subtitle={error ?? 'No asset matches that id on this server.'}
        />
        <View style={styles.notFoundActions}>
          <PrimaryButton label="Try again" variant="secondary" onPress={() => void load()} />
        </View>
      </View>
    );
  }

  const callable = suppliers.some((link) => link.phone !== null);
  const messageable = suppliers.length > 0;

  const supplierItems: ActionSheetItem[] = suppliers
    .filter((link) => (supplierSheet === 'call' ? link.phone !== null : true))
    .map((link) => ({
      id: link.id,
      label: link.supplierName,
      icon: supplierSheet === 'call' ? ('call-outline' as const) : ('logo-whatsapp' as const),
      subtitle: `${EQUIPMENT_SUPPLIER_ROLE_LABELS[link.role]}${link.contactPerson === null ? '' : ` · ${link.contactPerson}`
        }`,
      onPress: () => {
        const mode = supplierSheet;
        if (mode !== null) void contactSupplier(mode, link);
      },
    }));

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

  return (
    <View style={styles.screen}>
      <TopAppBar title={equipment.assetId} onBack={() => router.back()} />

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
        {equipment.imageUrl !== null ? (
          <Image source={{ uri: equipment.imageUrl }} style={styles.hero} />
        ) : (
          <View style={[styles.hero, styles.heroFallback]}>
            <MaterialIcons
              name="precision-manufacturing"
              size={48}
              color={colors.onSurfaceVariant}
            />
          </View>
        )}

        <View style={styles.headerBlock}>
          <Text style={styles.name}>{equipment.name}</Text>
          <Text style={styles.assetId}>{equipment.assetId}</Text>
          <View style={styles.chipRow}>
            <EquipmentStatusChip status={equipment.status} />
            <WarrantyChip status={equipment.warrantyStatus} />
          </View>
          {equipment.statusNote !== null && equipment.statusNote !== '' ? (
            <Text style={styles.statusNote}>{equipment.statusNote}</Text>
          ) : null}
        </View>

        {error !== null ? (
          <View style={styles.errorBar}>
            <MaterialIcons name="error-outline" size={18} color={colors.onErrorContainer} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        {contact.error !== null ? (
          <PressableScale onPress={contact.clearError} accessibilityRole="button">
            <View style={styles.errorBar}>
              <MaterialIcons name="error-outline" size={18} color={colors.onErrorContainer} />
              <Text style={styles.errorText}>{contact.error}</Text>
            </View>
          </PressableScale>
        ) : null}

        <View style={styles.actionRow}>
          {canReport ? (
            <ActionButton
              icon="report-problem"
              label="Report problem"
              tone="danger"
              onPress={() =>
                router.push({
                  pathname: '/equipment/report',
                  params: { equipmentId: equipment.id },
                })
              }
            />
          ) : null}
          {canContact && callable ? (
            <ActionButton
              icon="call"
              label="Call supplier"
              busy={contact.busy}
              onPress={() => startContact('call')}
            />
          ) : null}
          {canContact && messageable ? (
            <ActionButton
              icon="chat"
              label="WhatsApp"
              busy={contact.busy}
              onPress={() => startContact('whatsapp')}
            />
          ) : null}
          {canEdit ? (
            <ActionButton
              icon="swap-horiz"
              label="Change status"
              onPress={() => {
                setNextStatus(equipment.status);
                setStatusNote('');
                setStatusSheetOpen(true);
              }}
            />
          ) : null}
        </View>

        <Section title="Where it is">
          <DetailRow icon="place" label="Location" value={equipment.locationPath ?? 'Unassigned'} />
          <DetailRow
            icon="label"
            label="Category"
            value={equipment.categoryName ?? 'Uncategorised'}
          />
          <DetailRow
            icon="build"
            label="Make"
            value={[equipment.brand, equipment.model].filter(Boolean).join(' ') || '—'}
          />
          {equipment.serialNumber !== null ? (
            <DetailRow icon="description" label="Serial" value={equipment.serialNumber} mono />
          ) : null}
        </Section>

        <Section title="Service & warranty">
          <DetailRow icon="event" label="Maintenance" value={dueLabel(equipment)} />
          <DetailRow
            icon="verified-user"
            label="Warranty"
            value={
              equipment.warrantyExpiry === null
                ? 'No warranty on file'
                : `Expires ${formatDateDisplay(equipment.warrantyExpiry)}${equipment.warrantyDaysRemaining === null
                  ? ''
                  : ` · ${equipment.warrantyDaysRemaining} day${equipment.warrantyDaysRemaining === 1 ? '' : 's'
                  } left`
                }`
            }
          />
          {equipment.lastMaintenanceAt !== null ? (
            <DetailRow
              icon="history"
              label="Last serviced"
              value={formatDateDisplay(equipment.lastMaintenanceAt)}
            />
          ) : null}
        </Section>

        {canSeeSuppliers && suppliers.length > 0 ? (
          <Section title="Suppliers">
            {suppliers.map((link) => (
              <DetailRow
                key={link.id}
                icon="local-shipping"
                label={EQUIPMENT_SUPPLIER_ROLE_LABELS[link.role]}
                value={[link.supplierName, link.contactPerson, link.phone]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </Section>
        ) : null}

        <Section title={`Open problems (${equipment.openTickets?.length ?? 0})`}>
          {(equipment.openTickets ?? []).length === 0 ? (
            <Text style={styles.emptyLine}>Nothing open against this asset.</Text>
          ) : (
            (equipment.openTickets ?? []).map((ticket) => (
              <TicketRow
                key={ticket.id}
                ticket={ticket}
                onPress={() =>
                  router.push({
                    pathname: '/equipment/tickets/[ticketId]',
                    params: { ticketId: ticket.id },
                  })
                }
              />
            ))
          )}
        </Section>

        <Section title="History">
          {activities.length === 0 ? (
            <Text style={styles.emptyLine}>Nothing has happened to this asset yet.</Text>
          ) : (
            <ActivityTimeline activities={activities} />
          )}
        </Section>
      </ScrollView>

      <ThemedBottomSheet
        isOpen={statusSheetOpen}
        onClose={() => setStatusSheetOpen(false)}
        title="Change status"
        scrollable
      >
        <ChoiceChips
          choices={STATUS_CHOICES}
          selected={nextStatus}
          onSelect={(value) => setNextStatus(value)}
        />
        <View style={styles.sheetNote}>
          <FormInput
            label="Why (optional)"
            value={statusNote}
            onChangeText={setStatusNote}
            placeholder="Anyone reading the timeline later will see this"
            maxLength={LIMITS.EQUIPMENT_STATUS_NOTE_MAX}
            multiline
          />
        </View>
        <PrimaryButton
          label="Save status"
          loading={savingStatus}
          disabled={nextStatus === null}
          onPress={() => void submitStatus()}
        />
      </ThemedBottomSheet>

      <ActionSheet
        isOpen={supplierSheet !== null}
        onClose={() => setSupplierSheet(null)}
        title={supplierSheet === 'call' ? 'Call which supplier?' : 'Message which supplier?'}
        items={supplierItems}
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

function ActionButton({
  icon,
  label,
  onPress,
  tone = 'default',
  busy = false,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
  busy?: boolean;
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const tint = tone === 'danger' ? colors.error : colors.taskBar;

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
          <ActivityIndicator color={tint} />
        ) : (
          <MaterialIcons name={icon} size={24} color={tint} />
        )}
        <Text style={[styles.actionLabel, { color: tint }]} numberOfLines={2}>
          {label}
        </Text>
      </View>
    </PressableScale>
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

function DetailRow({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  value: string;
  mono?: boolean;
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.detailRow}>
      <MaterialIcons name={icon} size={18} color={colors.outline} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, mono && styles.detailValueMono]}>{value}</Text>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useThemeColors>['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { paddingBottom: spacing[12] },
    notFoundActions: { paddingHorizontal: spacing[8] },

    hero: { width: '100%', height: 220, backgroundColor: colors.surfaceContainerLow },
    heroFallback: { alignItems: 'center', justifyContent: 'center' },

    headerBlock: {
      paddingHorizontal: spacing.marginMobile,
      paddingTop: spacing[4],
      gap: spacing[1],
    },
    name: {
      fontFamily: typography.headlineLg.fontFamily,
      fontSize: typography.headlineLg.size,
      lineHeight: typography.headlineLg.lineHeight,
      color: colors.onSurface,
    },
    assetId: {
      fontFamily: typography.dataMono.fontFamily,
      fontSize: typography.dataMono.size,
      letterSpacing: typography.dataMono.letterSpacing,
      color: colors.onSurfaceVariant,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing[2],
      marginTop: spacing[2],
    },
    statusNote: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onSurfaceVariant,
      marginTop: spacing[1],
    },

    errorBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      marginHorizontal: spacing.marginMobile,
      marginTop: spacing[3],
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2.5],
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
      paddingTop: spacing[4],
    },
    actionPress: { flex: 1 },
    actionTile: {
      minHeight: 76,
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
      textAlign: 'center',
    },

    section: {
      paddingHorizontal: spacing.marginMobile,
      paddingTop: spacing[6],
    },
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
    detailValueMono: {
      fontFamily: typography.dataMono.fontFamily,
      letterSpacing: typography.dataMono.letterSpacing,
    },
    emptyLine: {
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.outline,
    },
    sheetNote: { marginTop: spacing[4] },
  });
}
