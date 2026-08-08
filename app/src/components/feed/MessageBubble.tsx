import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AttachmentDto, ThreadMessageDto } from '@menuboard/shared';
import { PressableScale } from '../PressableScale';
import { AuthorLine, authorTint } from './FeedPrimitives';
import { VoiceNotePlayer } from './VoiceNotePlayer';
import { colors, radii, spacing, typography, fonts } from '../../theme/tokens';

/**
 * A person's message on the feed.
 *
 * Two shapes, distinguished by whether the message hangs off an order: a general board post
 * sits at full width, while a reply about an order is indented under it with a connector
 * line, so the discussion stays attached to the thing it is about.
 */
export function MessageBubble({
  message,
  attachments,
  localUris,
  time,
  isMine,
  nested = false,
  depth = 0,
  replyingToName,
  onLongPress,
}: {
  message: ThreadMessageDto;
  attachments: AttachmentDto[];
  localUris: Record<string, string>;
  time: string;
  isMine: boolean;
  /** Rendered as a reply under an order card rather than a standalone post. */
  nested?: boolean;
  /** Extra indent for a reply-to-a-reply. Capped by the caller. */
  depth?: number;
  /** Shows the quoted "in reply to" strip inside the bubble. */
  replyingToName?: string;
  onLongPress?: () => void;
}): React.JSX.Element {
  const images = attachments.filter((a) => a.kind === 'IMAGE');
  const voices = attachments.filter((a) => a.kind === 'VOICE_NOTE');
  const documents = attachments.filter((a) => a.kind === 'DOCUMENT');
  const tint = authorTint(message.authorName ?? 'Member');
  const fill = isMine ? colors.bubbleMine : tint.bg;
  const edge = isMine ? colors.bubbleMineBorder : tint.border;

  return (
    <View
      style={[
        styles.wrapper,
        nested && styles.wrapperNested,
        depth > 0 && { marginLeft: spacing[6] + depth * spacing[5] },
        isMine && styles.wrapperMine,
      ]}
    >
      <AuthorLine
        name={isMine ? 'You' : message.authorName ?? 'Member'}
        avatarName={message.authorName ?? 'Member'}
        time={time}
        align={isMine ? 'right' : 'left'}
      />

      <PressableScale onLongPress={onLongPress} disabled={onLongPress === undefined}>
        <View style={[styles.bubbleWrap, isMine && styles.bubbleWrapMine]}>
          {/* The tail: two stacked triangles (border colour behind, fill colour on top,
              offset by a pixel) so it reads as a bordered speech-bubble point back to the
              sender's avatar, the way the bubble itself has a border. */}
          {!isMine ? (
            <>
              <View style={[styles.bubbleTailBorder, { borderRightColor: edge }]} />
              <View style={[styles.bubbleTailFill, { borderRightColor: fill }]} />
            </>
          ) : null}
          <View style={[styles.bubble, { backgroundColor: fill, borderColor: edge }]}>
            {replyingToName !== undefined ? (
              <View style={styles.quote}>
                <View style={styles.quoteBar} />
                <Text style={styles.quoteName} numberOfLines={1}>
                  {replyingToName}
                </Text>
              </View>
            ) : null}

            {message.body ? <Text style={styles.body}>{message.body}</Text> : null}

            {images.length > 0 ? (
              <View style={styles.imageRow}>
                {images.map((attachment) => (
                  <Image
                    key={attachment.id}
                    source={{ uri: localUris[attachment.id] ?? attachment.storagePath }}
                    style={styles.image}
                  />
                ))}
              </View>
            ) : null}

            {voices.map((attachment) => (
              <View key={attachment.id} style={styles.voiceWrap}>
                <VoiceNotePlayer
                  attachmentId={attachment.id}
                  uri={localUris[attachment.id]}
                  durationMs={attachment.durationMs}
                  compact
                />
              </View>
            ))}

            {documents.map((attachment) => (
              <View key={attachment.id} style={styles.document}>
                <Ionicons name="document-text-outline" size={16} color={colors.primary} />
                <Text style={styles.documentName} numberOfLines={1}>
                  {attachment.fileName}
                </Text>
              </View>
            ))}

          </View>
        </View>
      </PressableScale>
    </View>
  );
}

/** A SYSTEM row that is not an order card — a status change, a member joining. */
export function SystemLine({ text, time }: { text: string; time: string }): React.JSX.Element {
  return (
    <View style={styles.systemLine}>
      <Text style={styles.systemText}>
        {text} · {time}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: spacing[3], maxWidth: '92%' },
  wrapperNested: { marginLeft: 0 },
  wrapperMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },

  // Room on the left for the tail to sit outside the bubble's own bounds.
  bubbleWrap: { position: 'relative', marginLeft: 6, alignSelf: 'flex-start' },
  bubbleWrapMine: { marginLeft: 0, alignSelf: 'flex-end' },
  bubble: {
    borderWidth: 1,
    borderRadius: radii['2xl'],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  // Two stacked triangles pointing left/back at the sender's avatar — border colour behind,
  // fill colour on top and offset by a pixel, so the point reads as bordered like the bubble
  // it is attached to, the way a WhatsApp bubble's tail does.
  bubbleTailBorder: {
    position: 'absolute',
    bottom: 4,
    left: -7,
    width: 0,
    height: 0,
    borderTopWidth: 9,
    borderTopColor: 'transparent',
    borderBottomWidth: 0,
    borderBottomColor: 'transparent',
    borderRightWidth: 10,
  },
  bubbleTailFill: {
    position: 'absolute',
    bottom: 5,
    left: -5,
    width: 0,
    height: 0,
    borderTopWidth: 8,
    borderTopColor: 'transparent',
    borderBottomWidth: 0,
    borderBottomColor: 'transparent',
    borderRightWidth: 9,
  },

  body: {
    fontFamily: fonts.sans,
    fontSize: typography.bodyMd.size,
    lineHeight: typography.bodyMd.lineHeight,
    color: colors.onSurface,
  },

  quote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
    paddingVertical: spacing[1],
    paddingRight: spacing[2],
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceContainer,
    overflow: 'hidden',
  },
  quoteBar: { width: 3, alignSelf: 'stretch', backgroundColor: colors.primary },
  quoteName: {
    flex: 1,
    fontFamily: fonts.sansSemibold,
    fontSize: typography.bodySm.size,
    fontWeight: '600',
    color: colors.primary,
  },

  imageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2] },
  image: { width: 96, height: 96, borderRadius: radii.lg, backgroundColor: colors.surfaceVariant },

  voiceWrap: { marginTop: spacing[2] },

  document: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[2],
    padding: spacing[2],
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceContainer,
  },
  documentName: { flex: 1, fontFamily: fonts.sans, fontSize: typography.bodySm.size, color: colors.onSurfaceVariant },

  systemLine: { alignItems: 'flex-start', marginBottom: spacing[3], paddingLeft: spacing[1] },
  systemText: {
    fontFamily: fonts.sans,
    fontSize: typography.bodySm.size,
    color: colors.onSurfaceVariant,
    backgroundColor: colors.dataPanel,
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1],
    borderRadius: radii.full,
    overflow: 'hidden',
  },
});
