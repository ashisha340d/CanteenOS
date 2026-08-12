import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, spacing } from '../theme/tokens';

export interface CanteenTab {
  key: string;
  label: string;
}

/**
 * The Canteen OS app bar: brand, actions, and underlined tabs beneath.
 *
 * Separate from `TopAppBar` rather than an option on it — that bar is the indigo utility
 * chrome used by the order screens, this one is the teal messaging-app chrome the task
 * screens are modelled on. Merging them would give one component two personalities and a
 * pile of conditionals.
 */
export function CanteenTopBar({
  title,
  tabs,
  activeTab,
  onTabPress,
  onSearch,
  onMenu,
}: {
  title: string;
  tabs?: CanteenTab[];
  activeTab?: string;
  onTabPress?: (key: string) => void;
  onSearch?: () => void;
  onMenu?: () => void;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingTop: insets.top + spacing[2] }]}>
      <View style={styles.headline}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.actions}>
          {onSearch !== undefined ? (
            <Pressable
              onPress={onSearch}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Search"
              style={styles.action}
            >
              <MaterialIcons name="search" size={24} color={colors.onTaskBar} />
            </Pressable>
          ) : null}
          {onMenu !== undefined ? (
            <Pressable
              onPress={onMenu}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="More options"
              style={styles.action}
            >
              <MaterialIcons name="more-vert" size={24} color={colors.onTaskBar} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {tabs !== undefined ? (
        <View style={styles.tabs}>
          {tabs.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <Pressable
                key={tab.key}
                onPress={() => onTabPress?.(tab.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={styles.tab}
              >
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
                  {tab.label}
                </Text>
                <View style={[styles.indicator, active && styles.indicatorActive]} />
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.taskBar },
  headline: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[2],
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.sansBold,
    fontSize: 20,
    lineHeight: 26,
    color: colors.onTaskBar,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing[5] },
  action: { padding: spacing[0.5] },
  tabs: { flexDirection: 'row', alignItems: 'stretch' },
  tab: { flex: 1, alignItems: 'center' },
  tabLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.3,
    color: colors.taskTabInactive,
    paddingBottom: spacing[2.5],
  },
  tabLabelActive: { color: colors.onTaskBar },
  indicator: { height: 3, alignSelf: 'stretch', backgroundColor: 'transparent' },
  indicatorActive: { backgroundColor: colors.onTaskBar },
});
