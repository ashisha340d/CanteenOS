import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { PressableScale } from './PressableScale';
import { colors, radii, spacing, typography } from '../theme/tokens';

/**
 * The bottom navigation from the Stitch mockups.
 *
 * Replaces the default tab bar because the active state is a filled emerald *pill* wrapping
 * icon and label together, which the stock `tabBarActiveTintColor` cannot express — it only
 * tints. Every mockup shows this treatment, so it is the navigation, not a flourish.
 */

const ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  boards: 'dashboard',
  orders: 'receipt-long',
  users: 'group',
  archive: 'inventory-2',
};

const LABELS: Record<string, string> = {
  boards: 'Boards',
  orders: 'Orders',
  users: 'Users',
  archive: 'Archive',
};

export function TabBar({
  state,
  navigation,
}: BottomTabBarProps): React.JSX.Element {
  const insets = useSafeAreaInsets();

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
            <View style={[styles.item, focused && styles.itemActive]}>
              <MaterialIcons
                name={icon}
                size={24}
                color={focused ? colors.onSecondaryContainer : colors.onSurfaceVariant}
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

const styles = StyleSheet.create({
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
    borderRadius: radii.full,
  },
  itemActive: { backgroundColor: colors.secondaryContainer },
  label: {
    fontFamily: typography.labelCaps.fontFamily,
    fontSize: typography.labelCaps.size,
    lineHeight: typography.labelCaps.lineHeight,
    letterSpacing: typography.labelCaps.letterSpacing,
    fontWeight: typography.labelCaps.weight,
    color: colors.onSurfaceVariant,
    marginTop: spacing[1],
  },
  labelActive: { color: colors.onSecondaryContainer },
});
