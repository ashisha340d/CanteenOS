import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { PressableScale } from './PressableScale';
import { spacing, typography } from '../theme/tokens';
import { useThemeColors } from '../theme/useThemeColors';

/**
 * The bottom navigation — WhatsApp's own tab-bar treatment: a plain white bar, a hairline on
 * top, and the active destination picked out by colour alone (its own header green) rather
 * than a filled pill. Replaces the default tab bar so every icon/label pair can carry that
 * colour together, which the stock `tabBarActiveTintColor` option cannot express on its own.
 */

const ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  tasks: 'checklist',
  boards: 'dashboard',
  orders: 'receipt-long',
  users: 'group',
};

const LABELS: Record<string, string> = {
  tasks: 'Tasks',
  boards: 'Boards',
  orders: 'Orders',
  users: 'Users',
};

export function TabBar({
  state,
  navigation,
}: BottomTabBarProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing[3]) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const icon = ICONS[route.name] ?? 'circle';
        const label = LABELS[route.name] ?? route.name;

        const onPress = (): void => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <PressableScale
            key={route.key}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            style={styles.itemPress}
          >
            <View style={styles.item}>
              <MaterialIcons
                name={icon}
                size={24}
                color={focused ? colors.taskBar : colors.outline}
              />
              <Text style={[styles.label, focused && styles.labelActive]} numberOfLines={1}>
                {label}
              </Text>
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useThemeColors>['colors']) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.outlineVariant,
      paddingHorizontal: spacing.marginMobile,
      paddingTop: spacing[2],
    },
    itemPress: { flex: 1, alignItems: 'center' },
    item: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[1],
    },
    label: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      lineHeight: typography.labelCaps.lineHeight,
      letterSpacing: typography.labelCaps.letterSpacing,
      fontWeight: typography.labelCaps.weight,
      color: colors.outline,
      marginTop: spacing[1],
    },
    labelActive: { color: colors.taskBar, fontWeight: '700' },
  });
}
