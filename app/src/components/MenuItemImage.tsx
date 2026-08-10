import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { MenuItemDto } from '@menuboard/shared';
import { mediaApi } from '../api/media';
import { colors, radii } from '../theme/tokens';

/**
 * The dish's photograph. The device stores only the media asset's id (a signed download link
 * expires long before the next sync would refresh it), so the link is minted on first render
 * and cached by `mediaApi`. With no photo — or with no signal to fetch one — the tile falls
 * back to a neutral placeholder rather than collapsing the layout.
 */
export function MenuItemImage({
  item,
  size = 40,
  style,
}: {
  item: MenuItemDto;
  size?: number;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(item.imagePath);
  const mediaId = item.primaryMediaId;

  useEffect(() => {
    if (mediaId === null) return;
    let active = true;
    mediaApi
      .getSignedUrl(mediaId)
      .then((resolved) => {
        if (active) setUrl(resolved);
      })
      .catch(() => {
        // Offline or the asset is gone: the placeholder is the correct end state.
      });
    return () => {
      active = false;
    };
  }, [mediaId]);

  return (
    <View style={[styles.tile, { width: size, height: size }, style]}>
      {url === null ? (
        <Ionicons name="image-outline" size={size * 0.45} color={colors.outlineVariant} />
      ) : (
        <Image source={{ uri: url }} style={styles.image} resizeMode="cover" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radii.md,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
});
