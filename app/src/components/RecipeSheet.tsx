import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MenuItemDto, ScaledRecipeDto } from '@menuboard/shared';
import { scaleRecipe } from '@menuboard/shared';
import { recipeRepository } from '../db/repositories';
import { ThemedBottomSheet } from './BottomSheet';
import { LabelCaps } from './feed/FeedPrimitives';
import { menuItemName, t, tCount, type Language } from '../i18n';
import { colors, radii, spacing, typography, fonts } from '../theme/tokens';

/**
 * The long-press recipe, scaled to the order's guest count.
 *
 * Read from the local cache rather than the API: the person opening this is standing in a
 * kitchen, and the answer to "how much garam masala for 45?" cannot depend on a signal. The
 * arithmetic comes from `shared/src/recipes` — the same function the server runs — so the
 * offline answer and the online one are identical.
 *
 * The base quantity stays on screen next to the scaled one. A cook who knows the recipe by
 * heart needs to see that the multiplication was applied to the numbers they expect.
 */
export function RecipeSheet({
  menuItemId,
  menuItem,
  pax,
  language = 'en',
  onClose,
}: {
  menuItemId: string;
  menuItem: MenuItemDto | undefined;
  pax: number;
  language?: Language;
  onClose: () => void;
}): React.JSX.Element {
  const [recipe, setRecipe] = useState<ScaledRecipeDto | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await recipeRepository.findByMenuItem(menuItemId);
      if (cancelled) return;
      if (stored === null) {
        setState('missing');
        return;
      }
      const name = menuItem === undefined ? '' : menuItemName(menuItem, language);
      setRecipe(scaleRecipe(stored, pax, name));
      setState('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [menuItemId, menuItem, pax, language]);

  const title = menuItem === undefined ? t('viewRecipe', language) : menuItemName(menuItem, language);

  return (
    <ThemedBottomSheet isOpen onClose={onClose} snapPoints={['55%', '90%']}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.paxChip}>
          <Text style={styles.paxChipText}>{tCount('forPax', pax, language)}</Text>
        </View>
      </View>

      {state === 'loading' ? (
        <ActivityIndicator color={colors.primary} style={styles.spinner} />
      ) : null}

      {state === 'missing' ? (
        <Text style={styles.missing}>
          {language === 'hi'
            ? 'इस आइटम की रेसिपी अभी दर्ज नहीं है।'
            : 'No recipe has been recorded for this item yet.'}
        </Text>
      ) : null}

      {state === 'ready' && recipe !== null ? (
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.scaleNote}>
            <Text style={styles.scaleNoteText}>
              {language === 'hi'
                ? `मूल रेसिपी ${recipe.basePax} मेहमानों के लिए — नीचे ${recipe.scaledToPax} के लिए बढ़ाई गई`
                : `Recipe written for ${recipe.basePax} guests · scaled below to ${recipe.scaledToPax}`}
            </Text>
          </View>

          <LabelCaps>{t('ingredients', language)}</LabelCaps>
          <View style={styles.table}>
            {recipe.ingredients.map((ingredient, index) => {
              const displayName =
                language === 'hi' && ingredient.nameHi !== null && ingredient.nameHi !== ''
                  ? ingredient.nameHi
                  : ingredient.name;
              return (
                <View
                  key={`${ingredient.ingredientId}-${index}`}
                  style={[styles.row, index % 2 === 1 && styles.rowAlt]}
                >
                  <View style={styles.nameCell}>
                    <Text style={styles.name}>{displayName}</Text>
                    {ingredient.notes !== null ? (
                      <Text style={styles.notes}>{ingredient.notes}</Text>
                    ) : null}
                  </View>
                  <View style={styles.quantityCell}>
                    <Text style={styles.quantity}>
                      {formatQuantity(ingredient.quantity)} {ingredient.unit}
                    </Text>
                    <Text style={styles.baseQuantity}>
                      {formatQuantity(ingredient.baseQuantity)} / {recipe.basePax}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          {recipe.steps.length > 0 ? (
            <View style={styles.method}>
              <LabelCaps>{t('steps', language)}</LabelCaps>
              {recipe.steps
                .slice()
                .sort((a, b) => a.stepNo - b.stepNo)
                .map((step) => {
                  const text = language === 'hi' && step.textHi !== null && step.textHi !== ''
                    ? step.textHi
                    : step.textEn;
                  return (
                    <View key={step.id} style={styles.stepRow}>
                      <View style={styles.stepNumber}>
                        <Text style={styles.stepNumberText}>{step.stepNo}</Text>
                      </View>
                      <View style={styles.stepBody}>
                        <Text style={styles.methodText}>{text}</Text>
                        {step.durationMin !== null ? (
                          <Text style={styles.stepDuration}>
                            {language === 'hi'
                              ? `${step.durationMin} मिनट`
                              : `${step.durationMin} min`}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
            </View>
          ) : null}

          {(language === 'hi' ? recipe.methodHi : recipe.methodEn) !== null &&
            (language === 'hi' ? recipe.methodHi : recipe.methodEn)?.trim() !== '' ? (
            <View style={styles.method}>
              <LabelCaps>{t('method', language)}</LabelCaps>
              <Text style={styles.methodText}>
                {language === 'hi' ? recipe.methodHi : recipe.methodEn}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </ThemedBottomSheet>
  );
}

/** 6.75 stays 6.75; 45.000 reads as 45. Trailing zeros imply precision that isn't there. */
function formatQuantity(value: number): string {
  return String(Number(value.toFixed(3)));
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  title: {
    flex: 1,
    fontFamily: fonts.sansBold,
    fontSize: typography.headlineLg.size,
    fontWeight: typography.headlineLg.weight,
    color: colors.onSurface,
  },
  paxChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radii.sm,
    backgroundColor: colors.primaryFixed,
  },
  paxChipText: {
    fontFamily: fonts.sansBold,
    fontSize: typography.labelCaps.size,
    fontWeight: '700',
    color: colors.primary,
  },

  spinner: { marginVertical: spacing[8] },
  missing: {
    fontFamily: fonts.sans,
    fontSize: typography.bodyMd.size,
    color: colors.onSurfaceVariant,
    paddingVertical: spacing[6],
    textAlign: 'center',
  },

  scaleNote: {
    padding: spacing[3],
    borderRadius: radii.lg,
    backgroundColor: colors.dataPanel,
    marginBottom: spacing[4],
  },
  scaleNoteText: { fontFamily: fonts.sans, fontSize: typography.bodySm.size, color: colors.onSurfaceVariant },

  table: {
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: radii.lg,
    overflow: 'hidden',
    marginTop: spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  rowAlt: { backgroundColor: colors.surfaceContainerLow },
  nameCell: { flex: 1 },
  name: { fontFamily: fonts.sans, fontSize: typography.bodyMd.size, color: colors.onSurface },
  notes: { fontFamily: fonts.sans, fontSize: typography.bodySm.size, color: colors.outline, marginTop: spacing[0.5] },
  quantityCell: { alignItems: 'flex-end' },
  quantity: {
    fontFamily: fonts.mono,
    fontSize: typography.dataMono.size,
    fontWeight: '700',
    color: colors.onSurface,
    fontVariant: ['tabular-nums'],
  },
  baseQuantity: {
    fontFamily: fonts.sansBold,
    fontSize: typography.labelCaps.size,
    color: colors.outline,
    fontVariant: ['tabular-nums'],
    marginTop: spacing[0.5],
  },

  method: { marginTop: spacing[5] },
  methodText: {
    fontFamily: fonts.sans,
    fontSize: typography.bodyMd.size,
    lineHeight: typography.bodyMd.lineHeight,
    color: colors.onSurfaceVariant,
    marginTop: spacing[2],
  },

  stepRow: {
    flexDirection: 'row',
    gap: spacing[3],
    marginTop: spacing[3],
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: radii.full,
    backgroundColor: colors.primaryFixed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    fontFamily: fonts.sansBold,
    fontSize: typography.labelCaps.size,
    fontWeight: '700',
    color: colors.primary,
  },
  stepBody: { flex: 1 },
  stepDuration: {
    fontFamily: fonts.sansBold,
    fontSize: typography.labelCaps.size,
    color: colors.outline,
    marginTop: spacing[1],
  },
});
