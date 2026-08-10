import React, { useMemo, useState } from 'react';
import { LayoutAnimation, Platform, StyleSheet, Text, TextInput, UIManager, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown, Layout } from 'react-native-reanimated';
import { LIMITS, type MenuCategoryDto, type MenuItemDto } from '@menuboard/shared';
import { MenuItemImage } from '../MenuItemImage';
import { PressableScale } from '../PressableScale';
import { SearchInput } from '../SearchInput';
import { newId } from '../../utils/uuid';
import { menuItemName, menuItemUnit, type Language } from '../../i18n';
import { colors, radii, spacing, typography, fonts } from '../../theme/tokens';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental !== undefined
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * One line being composed. Keyed by `key` rather than by menu item id, because an ad-hoc
 * line has no menu item id and two of them must be able to coexist on the same order.
 */
export interface DraftLine {
  key: string;
  menuItemId: string | null;
  customItemName: string | null;
  name: string;
  unit: string;
  quantity: number;
  notes: string;
  mentionedUserIds: string[];
}

export function draftFromMenuItem(
  item: MenuItemDto,
  language: Language,
  quantity = 1,
): DraftLine {
  return {
    key: item.id,
    menuItemId: item.id,
    customItemName: null,
    name: menuItemName(item, language) || item.name,
    unit: menuItemUnit(item, language) || item.unit,
    quantity,
    notes: '',
    mentionedUserIds: [],
  };
}

export function draftFromCustomName(name: string, quantity = 1): DraftLine {
  const trimmed = name.trim().slice(0, LIMITS.CUSTOM_ITEM_NAME_MAX);
  return {
    key: newId(),
    menuItemId: null,
    customItemName: trimmed,
    name: trimmed,
    unit: 'NOS',
    quantity,
    notes: '',
    mentionedUserIds: [],
  };
}

interface Member {
  userId: string;
  userName?: string | null;
}

interface Props {
  menuItems: readonly MenuItemDto[];
  categories: readonly MenuCategoryDto[];
  /** Ordered; the editor preserves the order it is given. */
  lines: readonly DraftLine[];
  onChange: (next: DraftLine[]) => void;
  language?: Language;
  /** Omit to hide the per-line mention chips (the edit screen does not offer them). */
  members?: readonly Member[];
  /**
   * Quantity a newly added line starts at. Callers pass the order's pax, because a kitchen
   * almost always cooks one serving per guest — starting at 1 meant retyping the pax figure
   * on every single line. Only new lines are affected; a quantity already adjusted by hand is
   * never overwritten when pax changes.
   */
  defaultQuantity?: number;
}

/**
 * Composes the item list for an order.
 *
 * Three deliberate choices, all aimed at the same thing — fewer taps in a kitchen:
 *
 * 1. **Chosen lines sit at the top**, with `-`/`+` steppers. Adjusting a quantity never
 *    means scrolling back through the catalogue to find the row again.
 * 2. **The catalogue is collapsed by category** and only expands on demand, so a hundred
 *    dishes are not dumped on screen at once. Typing in the search box flattens it back to a
 *    plain result list, because a search result has no useful grouping.
 * 3. **The search box doubles as the ad-hoc entry.** When what was typed is not in the
 *    catalogue, the first row offered is "Add ... as a custom item" — one tap, no master-data
 *    registration, no Admin round trip. This is the single most common request during
 *    service and it must not cost a detour.
 *
 * Adding a line clears the query so the box is immediately ready for the next dish; that is
 * what makes repeated adds one tap plus typing rather than tap-clear-type.
 */
export function OrderItemsEditor({
  menuItems,
  categories,
  lines,
  onChange,
  language = 'en',
  members,
  defaultQuantity = 1,
}: Props): React.JSX.Element {
  const newLineQuantity = defaultQuantity > 0 ? defaultQuantity : 1;
  const [query, setQuery] = useState('');
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
  const [expandedLineKey, setExpandedLineKey] = useState<string | null>(null);

  const chosenMenuItemIds = useMemo(
    () => new Set(lines.map((line) => line.menuItemId).filter((id): id is string => id !== null)),
    [lines],
  );

  const trimmedQuery = query.trim();

  const searchResults = useMemo(() => {
    if (trimmedQuery === '') return [];
    const q = trimmedQuery.toLowerCase();
    return menuItems
      .filter((item) => {
        const en = item.name.toLowerCase();
        const hi = (item.nameHi ?? '').toLowerCase();
        return en.includes(q) || hi.includes(q);
      })
      .slice(0, 30);
  }, [menuItems, trimmedQuery]);

  /** Only offer the ad-hoc row when nothing in the catalogue is an exact name match. */
  const canAddCustom =
    trimmedQuery !== '' &&
    !menuItems.some((item) => item.name.toLowerCase() === trimmedQuery.toLowerCase()) &&
    !lines.some((line) => line.name.toLowerCase() === trimmedQuery.toLowerCase());

  const itemsByCategory = useMemo(() => {
    const map = new Map<string, MenuItemDto[]>();
    for (const item of menuItems) {
      const list = map.get(item.categoryId) ?? [];
      list.push(item);
      map.set(item.categoryId, list);
    }
    return map;
  }, [menuItems]);

  const animate = (): void => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  };

  const addLine = (line: DraftLine): void => {
    animate();
    onChange([...lines, line]);
    setQuery('');
  };

  const addMenuItem = (item: MenuItemDto): void => {
    const existing = lines.find((line) => line.menuItemId === item.id);
    if (existing !== undefined) {
      // Tapping an already-chosen dish bumps its quantity rather than doing nothing, which
      // is what "add two more of that" looks like as a gesture.
      setQuantity(existing.key, existing.quantity + 1);
      setQuery('');
      return;
    }
    addLine(draftFromMenuItem(item, language, newLineQuantity));
  };

  const removeLine = (key: string): void => {
    animate();
    onChange(lines.filter((line) => line.key !== key));
  };

  const patchLine = (key: string, patch: Partial<DraftLine>): void => {
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const setQuantity = (key: string, quantity: number): void => {
    if (quantity <= 0) {
      removeLine(key);
      return;
    }
    patchLine(key, { quantity: Math.min(quantity, LIMITS.QUANTITY_MAX) });
  };

  const toggleMention = (key: string, userId: string): void => {
    const line = lines.find((l) => l.key === key);
    if (line === undefined) return;
    const has = line.mentionedUserIds.includes(userId);
    patchLine(key, {
      mentionedUserIds: has
        ? line.mentionedUserIds.filter((id) => id !== userId)
        : [...line.mentionedUserIds, userId],
    });
  };

  const atLineLimit = lines.length >= LIMITS.ORDER_ITEMS_PER_ORDER_MAX;

  return (
    <View>
      {/* ------------------------------------------------ chosen lines */}
      {lines.length > 0 ? (
        <View style={styles.chosenBlock}>
          {lines.map((line) => {
            const expanded = expandedLineKey === line.key;
            return (
              <Animated.View
                key={line.key}
                entering={FadeInDown.duration(180)}
                layout={Layout.springify().damping(18)}
                style={styles.chosenRow}
              >
                <View style={styles.chosenTop}>
                  <PressableScale
                    style={styles.chosenNameWrap}
                    onPress={() => {
                      animate();
                      setExpandedLineKey(expanded ? null : line.key);
                    }}
                  >
                    <Text style={styles.chosenName} numberOfLines={1}>
                      {line.name}
                    </Text>
                    <View style={styles.chosenMetaRow}>
                      {line.menuItemId === null ? (
                        <View style={styles.customTag}>
                          <Text style={styles.customTagText}>CUSTOM</Text>
                        </View>
                      ) : null}
                      <Text style={styles.chosenUnit}>{line.unit}</Text>
                      {line.notes.trim() !== '' ? (
                        <Ionicons name="document-text-outline" size={13} color={colors.textMuted} />
                      ) : null}
                      {line.mentionedUserIds.length > 0 ? (
                        <Text style={styles.chosenUnit}>@{line.mentionedUserIds.length}</Text>
                      ) : null}
                    </View>
                  </PressableScale>

                  <View style={styles.stepper}>
                    <PressableScale
                      style={styles.stepperButton}
                      onPress={() => setQuantity(line.key, line.quantity - 1)}
                      hitSlop={8}
                    >
                      <Ionicons
                        name={line.quantity <= 1 ? 'trash-outline' : 'remove'}
                        size={16}
                        color={line.quantity <= 1 ? colors.danger500 : colors.primary600}
                      />
                    </PressableScale>
                    <TextInput
                      style={styles.stepperValue}
                      value={String(line.quantity)}
                      keyboardType="numeric"
                      selectTextOnFocus
                      onChangeText={(text) => {
                        const parsed = Number(text.replace(/[^0-9.]/g, ''));
                        patchLine(line.key, {
                          quantity: Number.isFinite(parsed) ? parsed : 0,
                        });
                      }}
                    />
                    <PressableScale
                      style={styles.stepperButton}
                      onPress={() => setQuantity(line.key, line.quantity + 1)}
                      hitSlop={8}
                    >
                      <Ionicons name="add" size={16} color={colors.primary600} />
                    </PressableScale>
                  </View>
                </View>

                {expanded ? (
                  <Animated.View entering={FadeIn.duration(150)} style={styles.chosenDetails}>
                    <TextInput
                      style={styles.notesInput}
                      value={line.notes}
                      onChangeText={(text) => patchLine(line.key, { notes: text })}
                      placeholder="Notes (optional)"
                      placeholderTextColor={colors.gray400}
                      maxLength={LIMITS.ORDER_ITEM_NOTES_MAX}
                    />
                    {members !== undefined && members.length > 0 ? (
                      <View style={styles.chipsRow}>
                        {members.map((member) => {
                          const on = line.mentionedUserIds.includes(member.userId);
                          return (
                            <PressableScale
                              key={member.userId}
                              onPress={() => toggleMention(line.key, member.userId)}
                            >
                              <View style={[styles.chip, on && styles.chipOn]}>
                                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                                  @{member.userName ?? member.userId.slice(0, 6)}
                                </Text>
                              </View>
                            </PressableScale>
                          );
                        })}
                      </View>
                    ) : null}
                  </Animated.View>
                ) : null}
              </Animated.View>
            );
          })}
        </View>
      ) : null}

      {/* ------------------------------------------------------ search */}
      <SearchInput
        placeholder="Search or type a new item…"
        value={query}
        onChangeText={setQuery}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (atLineLimit) return;
          const exact = searchResults[0];
          if (canAddCustom) addLine(draftFromCustomName(trimmedQuery, newLineQuantity));
          else if (exact !== undefined) addMenuItem(exact);
        }}
        containerStyle={styles.search}
      />

      {atLineLimit ? (
        <Text style={styles.limitNote}>
          This order already has the maximum of {LIMITS.ORDER_ITEMS_PER_ORDER_MAX} lines.
        </Text>
      ) : null}

      {/* --------------------------------------------- results / browse */}
      {!atLineLimit && trimmedQuery !== '' ? (
        <View>
          {canAddCustom ? (
            <PressableScale onPress={() => addLine(draftFromCustomName(trimmedQuery, newLineQuantity))}>
              <View style={styles.customRow}>
                <Ionicons name="add-circle" size={20} color={colors.primary600} />
                <Text style={styles.customRowText} numberOfLines={1}>
                  Add “{trimmedQuery}” as a custom item
                </Text>
              </View>
            </PressableScale>
          ) : null}

          {searchResults.map((item) => (
            <CatalogueRow
              key={item.id}
              item={item}
              language={language}
              chosen={chosenMenuItemIds.has(item.id)}
              onPress={() => addMenuItem(item)}
            />
          ))}

          {searchResults.length === 0 && !canAddCustom ? (
            <Text style={styles.emptyNote}>Already on this order.</Text>
          ) : null}
        </View>
      ) : null}

      {!atLineLimit && trimmedQuery === '' ? (
        <View>
          {categories.map((category) => {
            const items = itemsByCategory.get(category.id) ?? [];
            if (items.length === 0) return null;
            const open = expandedCategoryId === category.id;
            return (
              <View key={category.id}>
                <PressableScale
                  onPress={() => {
                    animate();
                    setExpandedCategoryId(open ? null : category.id);
                  }}
                >
                  <View style={styles.categoryRow}>
                    <Text style={styles.categoryName}>
                      {language === 'hi' ? (category.nameHi ?? category.name) : category.name}
                    </Text>
                    <Text style={styles.categoryCount}>{items.length}</Text>
                    <Ionicons
                      name={open ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colors.gray400}
                    />
                  </View>
                </PressableScale>
                {open
                  ? items.map((item) => (
                    <CatalogueRow
                      key={item.id}
                      item={item}
                      language={language}
                      chosen={chosenMenuItemIds.has(item.id)}
                      onPress={() => addMenuItem(item)}
                    />
                  ))
                  : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function CatalogueRow({
  item,
  language,
  chosen,
  onPress,
}: {
  item: MenuItemDto;
  language: Language;
  chosen: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <PressableScale onPress={onPress}>
      <View style={[styles.catalogueRow, chosen && styles.catalogueRowChosen]}>
        <MenuItemImage item={item} size={36} style={styles.catalogueImage} />
        <Text style={styles.catalogueName} numberOfLines={1}>
          {menuItemName(item, language) || item.name}
        </Text>
        <Text style={styles.catalogueUnit}>{menuItemUnit(item, language) || item.unit}</Text>
        <Ionicons
          name={chosen ? 'checkmark-circle' : 'add-circle-outline'}
          size={20}
          color={chosen ? colors.success500 : colors.primary600}
        />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chosenBlock: {
    backgroundColor: colors.dataPanel,
    borderWidth: 1,
    borderColor: colors.dataPanelBorder,
    borderRadius: radii.xl,
    padding: spacing[2],
    marginBottom: spacing[3],
  },
  chosenRow: {
    backgroundColor: colors.white,
    borderRadius: radii.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginBottom: spacing[1.5],
  },
  chosenTop: { flexDirection: 'row', alignItems: 'center' },
  chosenNameWrap: { flex: 1, marginRight: spacing[2] },
  chosenName: {
    fontFamily: fonts.sansSemibold,
    fontSize: typography.body.size,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  chosenMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    marginTop: spacing[0.5],
  },
  chosenUnit: {
    fontFamily: fonts.mono,
    fontSize: typography.bodySm.size,
    color: colors.textMuted,
  },
  customTag: {
    paddingHorizontal: spacing[1.5],
    paddingVertical: 1,
    borderRadius: radii.sm,
    backgroundColor: colors.warning50,
  },
  customTagText: {
    fontFamily: fonts.sansBold,
    fontSize: typography.footnote.size,
    letterSpacing: typography.footnote.letterSpacing,
    color: colors.warning700,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.gray100,
    borderRadius: radii.full,
    padding: spacing[0.5],
  },
  stepperButton: {
    width: 30,
    height: 30,
    borderRadius: radii.full,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    minWidth: 40,
    textAlign: 'center',
    fontFamily: fonts.mono,
    fontSize: typography.dataMono.size,
    color: colors.textPrimary,
    padding: 0,
  },
  chosenDetails: { marginTop: spacing[2], gap: spacing[2] },
  notesInput: {
    fontFamily: fonts.sans,
    fontSize: typography.bodySm.size,
    color: colors.textPrimary,
    backgroundColor: colors.gray100,
    borderRadius: radii.md,
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[2],
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1.5] },
  chip: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radii.full,
    backgroundColor: colors.gray100,
  },
  chipOn: { backgroundColor: colors.primary600 },
  chipText: {
    fontFamily: fonts.sansMedium,
    fontSize: typography.bodySm.size,
    color: colors.textSecondary,
  },
  chipTextOn: { color: colors.white },
  search: { marginBottom: spacing[2] },
  limitNote: {
    fontFamily: fonts.sans,
    fontSize: typography.bodySm.size,
    color: colors.warning700,
    marginBottom: spacing[2],
  },
  emptyNote: {
    fontFamily: fonts.sans,
    fontSize: typography.bodySm.size,
    color: colors.textMuted,
    paddingVertical: spacing[3],
    textAlign: 'center',
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: radii.lg,
    backgroundColor: colors.primary50,
    borderWidth: 1,
    borderColor: colors.primary100,
    marginBottom: spacing[1.5],
  },
  customRowText: {
    flex: 1,
    fontFamily: fonts.sansSemibold,
    fontSize: typography.body.size,
    fontWeight: '600',
    color: colors.primary700,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
  },
  categoryName: {
    flex: 1,
    fontFamily: fonts.sansSemibold,
    fontSize: typography.body.size,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  categoryCount: {
    fontFamily: fonts.mono,
    fontSize: typography.bodySm.size,
    color: colors.textMuted,
  },
  catalogueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
  },
  catalogueRowChosen: { backgroundColor: colors.gray75 },
  catalogueImage: { marginRight: spacing[0.5] },
  catalogueName: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: typography.body.size,
    color: colors.textPrimary,
  },
  catalogueUnit: {
    fontFamily: fonts.mono,
    fontSize: typography.bodySm.size,
    color: colors.textMuted,
  },
});
