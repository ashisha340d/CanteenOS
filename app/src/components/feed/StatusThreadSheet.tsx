import React from 'react';
import { View } from 'react-native';
import type { ThreadMessageDto } from '@menuboard/shared';
import { ThemedBottomSheet } from '../BottomSheet';
import { EmptyState } from '../EmptyState';
import { SystemLine } from './MessageBubble';
import { describeSystemEvent } from './systemEventText';
import type { Language } from '../../i18n';
import { spacing } from '../../theme/tokens';

/**
 * The order's status/acknowledgement history, pulled out from behind the pin.
 *
 * These rows used to sit inline in the feed — every acknowledgement and every status flip its
 * own pill — which buried the actual conversation under a wall of duplicate-looking bubbles.
 * They still matter as a record (the spec treats status history as append-only system
 * messages), so nothing is deleted; they just live in this one-tap thread instead.
 */
export function StatusThreadSheet({
  isOpen,
  onClose,
  title = 'Status thread',
  events,
  language = 'en',
}: {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  events: ThreadMessageDto[];
  language?: Language;
}): React.JSX.Element {
  return (
    <ThemedBottomSheet isOpen={isOpen} onClose={onClose} title={title} scrollable maxHeightRatio={0.6}>
      <View style={{ paddingTop: spacing[1] }}>
        {events.length === 0 ? (
          <EmptyState title="No status updates yet" />
        ) : (
          events.map((event) => (
            <SystemLine key={event.id} text={describeSystemEvent(event, language)} time={formatTime(event.createdAt)} />
          ))
        )}
      </View>
    </ThemedBottomSheet>
  );
}

function formatTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
