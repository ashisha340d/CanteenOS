import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { ThemedBottomSheet } from './BottomSheet';
import { SearchInput } from './SearchInput';
import { PressableScale } from './PressableScale';
import { colors, radii, spacing, typography, fonts } from '../theme/tokens';

interface Option {
  id: string;
  label: string;
  subtitle?: string;
}

interface Props<T extends Option> {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  options: T[];
  selectedId?: string | null;
  onSelect: (option: T) => void;
  searchable?: boolean;
  searchKeys?: (keyof T)[];
  snapPoints?: string[];
}

/**
 * Replaces native `<select>` / `<Picker>` with a searchable, bottom-sheet picker —
 * used for activity type, priority, menu items, stations, and any lookup list.
 */
export function PickerSheet<T extends Option>({
  isOpen,
  onClose,
  title,
  options,
  selectedId,
  onSelect,
  searchable,
  searchKeys,
  snapPoints,
}: Props<T>): React.JSX.Element {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) =>
      (searchKeys ?? ['label', 'subtitle']).some((key) => {
        const value = o[key];
        return typeof value === 'string' && value.toLowerCase().includes(q);
      }),
    );
  }, [options, query, searchable, searchKeys]);

  // One close path, so the query can never survive into the next open — a stale filter made a
  // reopened picker look empty, which read as "selecting did nothing".
  const close = (): void => {
    setQuery('');
    onClose();
  };

  return (
    <ThemedBottomSheet
      isOpen={isOpen}
      onClose={close}
      title={title}
      scrollable
      {...(snapPoints ? { snapPoints } : {})}
    >
      {searchable ? (
        <View style={styles.searchWrap}>
          <SearchInput
            placeholder={`Search ${title.toLowerCase()}…`}
            value={query}
            onChangeText={setQuery}
          />
        </View>
      ) : null}
      {filtered.length === 0 ? (
        <Text style={styles.empty}>No matches</Text>
      ) : null}
      <View>
        {filtered.map((option, index) => {
          const selected = option.id === selectedId;
          return (
            <PressableScale
              key={option.id}
              onPress={() => {
                onSelect(option);
                close();
              }}
            >
              <Animated.View
                entering={FadeInUp.delay(index * 30).duration(250)}
                style={[styles.row, selected && styles.rowSelected]}
              >
                <View style={styles.rowText}>
                  <Text style={[styles.label, selected && styles.labelSelected]}>{option.label}</Text>
                  {option.subtitle ? <Text style={styles.subtitle}>{option.subtitle}</Text> : null}
                </View>
                {selected ? (
                  <Ionicons name="checkmark-circle" size={22} color={colors.primary600} />
                ) : (
                  <View style={styles.radio} />
                )}
              </Animated.View>
            </PressableScale>
          );
        })}
      </View>
    </ThemedBottomSheet>
  );
}

const styles = StyleSheet.create({
  searchWrap: { marginBottom: spacing[3] },
  empty: {
    fontFamily: fonts.sans,
    fontSize: typography.body.size,
    color: colors.textMuted,
    paddingVertical: spacing[4],
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: radii.md,
    backgroundColor: colors.white,
    marginBottom: spacing[2],
  },
  rowSelected: { backgroundColor: colors.primary50 },
  rowText: { flex: 1, marginRight: spacing[3] },
  label: { fontFamily: fonts.sansSemibold, fontSize: typography.body.size, fontWeight: '600', color: colors.textPrimary },
  labelSelected: { color: colors.primary700 },
  subtitle: { fontFamily: fonts.sansMedium, fontSize: typography.callout.size, color: colors.textMuted, marginTop: spacing[0.5] },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radii.full,
    borderWidth: 2,
    borderColor: colors.gray300,
  },
});
