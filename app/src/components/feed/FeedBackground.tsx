import React from 'react';
import { ImageBackground, StyleSheet } from 'react-native';
import { wa } from '../../theme/whatsapp';

/**
 * The board feed's wallpaper — WhatsApp's tiled doodle paper.
 *
 * The artwork lives at `assets/feed-pattern.png` and is tiled with `resizeMode="repeat"`, so
 * replacing that one file re-skins the whole feed with no code change. `backgroundColor` is the
 * tile's own paper tone, so the moment before the image decodes does not flash a different
 * colour.
 */
export function FeedBackground({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <ImageBackground
      source={require('../../../assets/feed-pattern.png')}
      resizeMode="repeat"
      style={styles.background}
    >
      {children}
    </ImageBackground>
  );
}

export const FEED_PAPER = wa.wallpaper;

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: wa.wallpaper },
});
