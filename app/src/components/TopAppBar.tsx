import React, { useMemo } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from './PressableScale';
import { radii, spacing, typography } from '../theme/tokens';
import { useThemeColors } from '../theme/useThemeColors';

/**
 * The single top bar for every screen — WhatsApp's own green, app-wide, per the "make it look
 * like WhatsApp everywhere" brief. Every WhatsApp tab (Chats, Status, Calls) wears the same
 * solid green header regardless of what it shows underneath, which is the effect this is
 * copying: one unmistakable band of colour at the top of every screen in the app, not just
 * the board feed.
 *
 * Two shapes exist in the designs and both live here rather than in two components, because
 * the difference is only which slots are filled:
 *
 *  - a *destination* bar — brand mark on the left, title, actions on the right
 *    (`my_boards_multi_board_home`, `archive_activity_item_summaries`)
 *  - a *transactional* bar — back arrow, centred title, spacer (`add_user_form`)
 *
 * Height is fixed at 64px with the status-bar inset added on top, so the bar never sits under
 * the clock on a notched device.
 */

export interface TopAppBarAction {
  icon: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  /** Renders a small count bubble, e.g. unread notifications. Hidden at 0. */
  badgeCount?: number;
}

interface TopAppBarProps {
  title: string;
  /** Brand glyph shown before the title. Ignored when `onBack` is set. */
  leadingIcon?: keyof typeof MaterialIcons.glyphMap;
  /** Presence switches the bar to its transactional shape: back arrow + centred title. */
  onBack?: () => void;
  actions?: TopAppBarAction[];
}

export function TopAppBar({
  title,
  leadingIcon,
  onBack,
  actions = [],
}: TopAppBarProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const transactional = onBack !== undefined;

  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.taskBarDark} />
      <View style={styles.row}>
        {transactional ? (
          <PressableScale onPress={onBack} accessibilityLabel="Go back" accessibilityRole="button">
            <View style={styles.iconButton}>
              <MaterialIcons name="arrow-back" size={24} color={colors.onTaskBar} />
            </View>
          </PressableScale>
        ) : null}

        <View style={[styles.titleWrap, transactional && styles.titleWrapCentered]}>
          {!transactional && leadingIcon !== undefined ? (
            <MaterialIcons
              name={leadingIcon}
              size={24}
              color={colors.onTaskBar}
              style={styles.leadingIcon}
            />
          ) : null}
          <Text
            style={[styles.title, transactional && styles.titleCentered]}
            numberOfLines={1}
          >
            {title}
          </Text>
        </View>

        {/* Keeps the centred title honest: without a matching right-hand box the title
            drifts left by the width of the back button. */}
        {transactional && actions.length === 0 ? <View style={styles.iconButton} /> : null}

        {actions.length > 0 ? (
          <View style={styles.actions}>
            {actions.map((action) => (
              <PressableScale
                key={action.icon}
                onPress={action.onPress}
                accessibilityLabel={action.accessibilityLabel}
                accessibilityRole="button"
              >
                <View style={styles.iconButton}>
                  <MaterialIcons name={action.icon} size={24} color={colors.onTaskBar} />
                  {action.badgeCount !== undefined && action.badgeCount > 0 ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText} numberOfLines={1}>
                        {action.badgeCount > 99 ? '99+' : action.badgeCount}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </PressableScale>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useThemeColors>['colors']) {
  return StyleSheet.create({
    bar: {
      backgroundColor: colors.taskBar,
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.15,
      shadowRadius: 2,
    },
    row: {
      height: 64,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.marginMobile,
    },
    titleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
    titleWrapCentered: { justifyContent: 'center' },
    leadingIcon: { marginRight: spacing[2] },
    title: {
      fontFamily: typography.headlineMd.fontFamily,
      fontSize: typography.headlineMd.size,
      lineHeight: typography.headlineMd.lineHeight,
      fontWeight: typography.headlineMd.weight,
      color: colors.onTaskBar,
      letterSpacing: -0.2,
      flexShrink: 1,
    },
    titleCentered: { textAlign: 'center' },
    actions: { flexDirection: 'row', alignItems: 'center' },
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: radii.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badge: {
      position: 'absolute',
      top: 2,
      right: 2,
      minWidth: 18,
      height: 18,
      paddingHorizontal: spacing[1],
      borderRadius: radii.full,
      backgroundColor: colors.error,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: 10,
      lineHeight: 14,
      color: colors.onError,
    },
  });
}
