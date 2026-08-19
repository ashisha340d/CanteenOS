import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { EquipmentDto } from '@menuboard/shared';
import { PressableScale } from '../PressableScale';
import { EquipmentStatusChip } from '../StatusChip';
import { radii, spacing, typography } from '../../theme/tokens';
import { useThemeColors } from '../../theme/useThemeColors';

/**
 * One asset in a list: photograph, name, asset id, where it stands, its status, and a badge
 * counting the problems open against it.
 *
 * The photograph leads because that is how people identify a machine — nobody recognises
 * MTC-KIT-OVN-001 but everybody recognises the oven by the back door. The asset id sits under
 * the name in the monospaced data face so a column of them lines up and can be read against a
 * printed label.
 */
export function EquipmentRow({
  equipment,
  onPress,
}: {
  equipment: EquipmentDto;
  onPress: () => void;
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const problems = equipment.openTicketCount;

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${equipment.name}, ${equipment.assetId}`}
    >
      <View style={styles.card}>
        {equipment.imageUrl !== null ? (
          <Image source={{ uri: equipment.imageUrl }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoFallback]}>
            <MaterialIcons
              name="precision-manufacturing"
              size={24}
              color={colors.onSurfaceVariant}
            />
          </View>
        )}

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={styles.name} numberOfLines={1}>
              {equipment.name}
            </Text>
            {problems > 0 ? (
              <View
                style={[
                  styles.problemBadge,
                  equipment.criticalTicketCount > 0 && styles.problemBadgeCritical,
                ]}
              >
                <MaterialIcons name="report-problem" size={11} color={colors.onError} />
                <Text style={styles.problemCount}>{problems}</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.assetId} numberOfLines={1}>
            {equipment.assetId}
          </Text>

          {equipment.locationPath !== undefined && equipment.locationPath !== '' ? (
            <Text style={styles.location} numberOfLines={1}>
              {equipment.locationPath}
            </Text>
          ) : null}

          <View style={styles.chipRow}>
            <EquipmentStatusChip status={equipment.status} />
            {equipment.isMaintenanceOverdue ? (
              <Text style={styles.overdue} numberOfLines={1}>
                Service overdue
              </Text>
            ) : null}
          </View>
        </View>

        <MaterialIcons name="chevron-right" size={22} color={colors.outline} />
      </View>
    </PressableScale>
  );
}

function createStyles(colors: ReturnType<typeof useThemeColors>['colors']) {
  return StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
      backgroundColor: colors.surfaceContainerLowest,
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      padding: spacing[3],
      marginBottom: spacing[3],
    },
    photo: {
      width: 56,
      height: 56,
      borderRadius: radii.lg,
      backgroundColor: colors.surfaceContainerLow,
    },
    photoFallback: { alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, gap: spacing[0.5] },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
    name: {
      flex: 1,
      fontFamily: typography.headlineMd.fontFamily,
      fontSize: typography.headlineMd.size,
      lineHeight: typography.headlineMd.lineHeight,
      color: colors.onSurface,
    },
    problemBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[0.5],
      paddingHorizontal: spacing[1.5],
      paddingVertical: spacing[0.5],
      borderRadius: radii.full,
      backgroundColor: colors.warning500,
    },
    problemBadgeCritical: { backgroundColor: colors.error },
    problemCount: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      color: colors.onError,
    },
    assetId: {
      fontFamily: typography.dataMono.fontFamily,
      fontSize: typography.dataMono.size,
      lineHeight: typography.dataMono.lineHeight,
      letterSpacing: typography.dataMono.letterSpacing,
      color: colors.onSurfaceVariant,
    },
    location: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.outline,
    },
    chipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      marginTop: spacing[1],
    },
    overdue: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      letterSpacing: typography.labelCaps.letterSpacing,
      color: colors.error,
    },
  });
}
