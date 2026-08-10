import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AttachmentDto, ThreadMessageDto } from '@menuboard/shared';
import { PressableScale } from '../PressableScale';
import { VoiceNotePlayer } from './VoiceNotePlayer';
import { wa, waSenderColor } from '../../theme/whatsapp';

/**
 * A WhatsApp chat bubble.
 *
 * Outgoing bubbles are the pale green `#D9FDD3` and sit right; incoming are white and sit left
 * with the sender's name in their own stable colour, the way a group chat identifies who spoke.
 * The timestamp and delivery ticks float in the bottom-right corner *inside* the bubble, with
 * the text reserving room for them so a short last line does not collide with the clock.
 *
 * The tail is drawn only on the first bubble of a run from the same person — consecutive
 * messages tuck in beneath with square corners, exactly as WhatsApp groups them.
 */

export type DeliveryState = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ';

export function MessageBubble({
  message,
  attachments,
  localUris,
  time,
  isMine,
  showTail = true,
  showAuthor = true,
  delivery = 'READ',
  depth = 0,
  replyingToName,
  replyingToBody,
  onLongPress,
}: {
  message: ThreadMessageDto;
  attachments: AttachmentDto[];
  localUris: Record<string, string>;
  time: string;
  isMine: boolean;
  /** False when this bubble continues a run from the same sender. */
  showTail?: boolean;
  /** False for incoming bubbles continuing a run — the name is printed once per run. */
  showAuthor?: boolean;
  delivery?: DeliveryState;
  depth?: number;
  replyingToName?: string;
  replyingToBody?: string;
  onLongPress?: () => void;
}): React.JSX.Element {
  const images = attachments.filter((a) => a.kind === 'IMAGE');
  const voices = attachments.filter((a) => a.kind === 'VOICE_NOTE');
  const documents = attachments.filter((a) => a.kind === 'DOCUMENT');

  const authorName = message.authorName ?? 'Member';
  const senderColor = waSenderColor(authorName);
  const hasMedia = images.length > 0 || voices.length > 0;

  return (
    <View
      style={[
        styles.row,
        isMine ? styles.rowMine : styles.rowTheirs,
        depth > 0 && { marginLeft: 16 + depth * 14 },
        !showTail && styles.rowStacked,
      ]}
    >
      {showTail ? (
        <View
          style={[
            styles.tail,
            isMine
              ? { right: -6, borderLeftWidth: 8, borderLeftColor: wa.bubbleOut }
              : { left: -6, borderRightWidth: 8, borderRightColor: wa.bubbleIn },
          ]}
        />
      ) : null}

      <PressableScale onLongPress={onLongPress} disabled={onLongPress === undefined}>
        <View
          style={[
            styles.bubble,
            isMine ? styles.bubbleMine : styles.bubbleTheirs,
            showTail && (isMine ? styles.bubbleMineTail : styles.bubbleTheirsTail),
            hasMedia && styles.bubbleMedia,
          ]}
        >
          {!isMine && showAuthor ? (
            <Text style={[styles.author, { color: senderColor }]} numberOfLines={1}>
              {authorName}
            </Text>
          ) : null}

          {replyingToName !== undefined ? (
            <View style={styles.quote}>
              <View style={[styles.quoteBar, { backgroundColor: waSenderColor(replyingToName) }]} />
              <View style={styles.quoteBody}>
                <Text
                  style={[styles.quoteName, { color: waSenderColor(replyingToName) }]}
                  numberOfLines={1}
                >
                  {replyingToName}
                </Text>
                <Text style={styles.quoteText} numberOfLines={1}>
                  {replyingToBody ?? 'Attachment'}
                </Text>
              </View>
            </View>
          ) : null}

          {images.length > 0 ? (
            <View style={styles.imageGrid}>
              {images.map((attachment) => (
                <Image
                  key={attachment.id}
                  source={{ uri: localUris[attachment.id] ?? attachment.storagePath }}
                  style={[styles.image, images.length === 1 && styles.imageSolo]}
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
              <Ionicons name="document-text" size={22} color="#5E5E5E" />
              <Text style={styles.documentName} numberOfLines={1}>
                {attachment.fileName}
              </Text>
            </View>
          ))}

          {message.body ? (
            /* The trailing spacer reserves the metadata's width on the last line, so the clock
               never overlaps the final word — WhatsApp's own trick. */
            <Text style={styles.body}>
              {message.body}
              <Text style={styles.metaSpacer}>{isMine ? '\u2004\u2004\u2004\u2004\u2004\u2004\u2004\u2004\u2004\u2004' : '\u2004\u2004\u2004\u2004\u2004\u2004'}</Text>
            </Text>
          ) : null}

          <View style={[styles.meta, !message.body && styles.metaStandalone]}>
            <Text style={styles.time}>{time}</Text>
            {isMine ? <DeliveryTicks state={delivery} /> : null}
          </View>
        </View>
      </PressableScale>
    </View>
  );
}

/** The clock / single tick / double tick / blue double tick progression. */
function DeliveryTicks({ state }: { state: DeliveryState }): React.JSX.Element {
  if (state === 'PENDING') {
    return <Ionicons name="time-outline" size={14} color={wa.tickSent} style={styles.tick} />;
  }
  if (state === 'SENT') {
    return <Ionicons name="checkmark" size={15} color={wa.tickSent} style={styles.tick} />;
  }
  return (
    <Ionicons
      name="checkmark-done"
      size={16}
      color={state === 'READ' ? wa.tickRead : wa.tickSent}
      style={styles.tick}
    />
  );
}

/** A centred grey notice — "Messages are end-to-end encrypted", a member joining, a status change. */
export function SystemLine({ text, time }: { text: string; time?: string }): React.JSX.Element {
  return (
    <View style={styles.systemRow}>
      <View style={styles.systemPill}>
        <Text style={styles.systemText}>
          {text}
          {time !== undefined && time !== '' ? ` · ${time}` : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { maxWidth: '82%', marginBottom: 8, position: 'relative' },
  rowMine: { alignSelf: 'flex-end', marginRight: 8 },
  rowTheirs: { alignSelf: 'flex-start', marginLeft: 8 },
  /* Bubbles continuing a run sit tighter together and pull in from the tail gutter. */
  rowStacked: { marginBottom: 2, marginTop: 0 },

  /* A single triangle in the bubble's own fill, flush with its top corner. */
  tail: {
    position: 'absolute',
    top: 0,
    width: 0,
    height: 0,
    borderTopWidth: 0,
    borderBottomWidth: 10,
    borderBottomColor: 'transparent',
    zIndex: 1,
  },

  bubble: {
    borderRadius: 7.5,
    paddingHorizontal: 9,
    paddingTop: 6,
    paddingBottom: 6,
    minWidth: 84,
    elevation: 1,
    shadowColor: '#0B141A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.13,
    shadowRadius: 0.5,
  },
  bubbleMine: { backgroundColor: wa.bubbleOut },
  bubbleTheirs: { backgroundColor: wa.bubbleIn },
  bubbleMineTail: { borderTopRightRadius: 0 },
  bubbleTheirsTail: { borderTopLeftRadius: 0 },
  bubbleMedia: { padding: 3, paddingBottom: 5 },

  author: {
    fontSize: 13.2,
    fontWeight: '600',
    marginBottom: 2,
    paddingHorizontal: 3,
  },

  body: {
    fontSize: 15.2,
    lineHeight: 20,
    color: wa.bubbleText,
    paddingHorizontal: 3,
  },
  /* Invisible run of four-per-em spaces sized to the timestamp block. */
  metaSpacer: { fontSize: 15.2, color: 'transparent' },

  meta: {
    position: 'absolute',
    right: 9,
    bottom: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  /* Media-only bubbles have no text line to float over, so the clock gets a scrim instead. */
  metaStandalone: {
    right: 8,
    bottom: 8,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(11,20,26,0.35)',
  },
  time: { fontSize: 11, color: wa.bubbleMeta, letterSpacing: 0.1 },
  tick: { marginBottom: -1 },

  quote: {
    flexDirection: 'row',
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: wa.replyBg,
    marginBottom: 4,
    marginHorizontal: 1,
  },
  quoteBar: { width: 4, alignSelf: 'stretch' },
  quoteBody: { flex: 1, paddingVertical: 4, paddingHorizontal: 7 },
  quoteName: { fontSize: 13, fontWeight: '600' },
  quoteText: { fontSize: 13, color: wa.quotedText, marginTop: 1 },

  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  image: { width: 108, height: 108, borderRadius: 5, backgroundColor: '#D9D9D9' },
  imageSolo: { width: 232, height: 232, borderRadius: 5 },

  voiceWrap: { paddingHorizontal: 2, paddingVertical: 2, minWidth: 214 },

  document: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 9,
    marginBottom: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(11,20,26,0.05)',
  },
  documentName: { flex: 1, fontSize: 13.5, color: wa.bubbleText },

  systemRow: { alignItems: 'center', marginVertical: 6, paddingHorizontal: 24 },
  systemPill: {
    backgroundColor: wa.systemPillBg,
    borderRadius: 7.5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    elevation: 1,
    shadowColor: '#0B141A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.13,
    shadowRadius: 0.5,
  },
  systemText: {
    fontSize: 12.5,
    lineHeight: 17,
    color: wa.systemPillText,
    textAlign: 'center',
  },
});
