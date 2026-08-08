import React from 'react';
import { ImageBackground, StyleSheet, View } from 'react-native';
import { colors } from '../../theme/tokens';

/**
 * The board feed's wallpaper.
 *
 * A tiled doodle pattern rather than a flat fill, for the same reason a messaging app uses
 * one: the cards are white, and white-on-near-white gives them no edge to read against. The
 * pattern is deliberately low-contrast — it has to sit *behind* the content, not compete with
 * an order card for attention.
 *
 * The artwork lives at `assets/feed-pattern.png` and is tiled with `resizeMode="repeat"`, so
 * replacing that one file re-skins the whole feed with no code change. The image ships with a
 * generated stand-in (see `scripts/make-feed-pattern.mjs`); swap it for the real artwork at
 * the same path.
 *
 * `backgroundColor` is set to the pattern's own paper tone as well, so the moment before the
 * image decodes does not flash a different colour.
 */
export function FeedBackground({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <ImageBackground
      source={require('../../../assets/feed-pattern.png')}
      resizeMode="repeat"
      style={styles.background}
    >
      <View style={styles.fill}>{children}</View>
    </ImageBackground>
  );
}

/** The paper tone of the tile, exported so a screen can match it outside the feed. */
export const FEED_PAPER = '#f3f0e9';

const styles = StyleSheet.create({
  background: { flex: 1, backgroundColor: FEED_PAPER },
  // A whisper of the app's surface tint over the pattern, so the doodles recede further
  // behind the cards without having to be redrawn any fainter.
  fill: { flex: 1, backgroundColor: `${colors.surfaceContainer}40` },
});
