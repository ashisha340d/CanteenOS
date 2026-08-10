import React from 'react';
import { Platform, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { PressableScale } from '../PressableScale';
import { TypingDots } from './TypingIndicator';
import { wa, waAvatarColor } from '../../theme/whatsapp';

/**
 * The WhatsApp group header: back arrow and avatar fused into one tap target, the group name
 * with its member list beneath, then call and overflow actions.
 *
 * The subtitle is the one moving part — it swaps to "<name> is typing…" while anyone else on
 * the board is composing, exactly as the real thing does.
 */
export function ChatHeader({
  title,
  subtitle,
  typingNames,
  onBack,
  onOpenProfile,
  onSearch,
  onMenu,
}: {
  title: string;
  subtitle: string;
  /** Names of everyone currently typing. Empty means show the member list. */
  typingNames: string[];
  onBack: () => void;
  onOpenProfile?: () => void;
  onSearch?: () => void;
  onMenu?: () => void;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const isTyping = typingNames.length > 0;

  return (
    <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === 'android' ? 4 : 0) }]}>
      <StatusBar barStyle="light-content" backgroundColor={wa.headerBgDark} />

      <PressableScale onPress={onBack} hitSlop={8} style={styles.back}>
        <Ionicons name="arrow-back" size={24} color={wa.headerIcon} />
      </PressableScale>

      <PressableScale onPress={onOpenProfile ?? onBack} style={styles.identity}>
        <View style={[styles.avatar, { backgroundColor: waAvatarColor(title) }]}>
          <Ionicons name="people" size={22} color="#FFFFFF" />
        </View>

        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>

          {isTyping ? (
            <Animated.View
              key="typing"
              entering={FadeIn.duration(150)}
              exiting={FadeOut.duration(150)}
              style={styles.typingRow}
            >
              <Text style={styles.typing} numberOfLines={1}>
                {typingLabel(typingNames)}
              </Text>
              <TypingDots color={wa.headerSubtext} size={4} />
            </Animated.View>
          ) : (
            <Animated.Text
              key="members"
              entering={FadeIn.duration(150)}
              style={styles.subtitle}
              numberOfLines={1}
            >
              {subtitle}
            </Animated.Text>
          )}
        </View>
      </PressableScale>

      <View style={styles.actions}>
        <PressableScale onPress={onSearch} hitSlop={8} style={styles.action}>
          <Ionicons name="search" size={21} color={wa.headerIcon} />
        </PressableScale>
        <PressableScale onPress={onMenu} hitSlop={8} style={styles.action}>
          <Ionicons name="ellipsis-vertical" size={20} color={wa.headerIcon} />
        </PressableScale>
      </View>
    </View>
  );
}

function typingLabel(names: string[]): string {
  const first = names[0] ?? 'Someone';
  if (names.length === 1) return `${first} is typing`;
  if (names.length === 2) return `${first} and ${names[1]} are typing`;
  return `${first} and ${names.length - 1} others are typing`;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: wa.headerBg,
    paddingBottom: 8,
    paddingHorizontal: 4,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },
  back: { paddingHorizontal: 6, paddingVertical: 6 },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  titles: { flex: 1, justifyContent: 'center' },
  title: {
    color: wa.headerText,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  subtitle: { color: wa.headerSubtext, fontSize: 13, marginTop: 1 },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  typing: { color: wa.headerSubtext, fontSize: 13 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  action: { paddingHorizontal: 9, paddingVertical: 8 },
});
