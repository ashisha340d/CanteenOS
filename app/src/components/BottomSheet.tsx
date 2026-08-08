import React, { useCallback, useRef } from 'react';
import { Dimensions, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetBackdropProps,
  type BottomSheetProps,
} from '@gorhom/bottom-sheet';
import { MaterialIcons } from '@expo/vector-icons';
import { PressableScale } from './PressableScale';
import { colors, radii, spacing, typography, fonts } from '../theme/tokens';

interface Props extends Partial<BottomSheetProps> {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /**
   * Fixed stops. Omit this — the sheet measures its own content by default, which is almost
   * always what you want. Only pass it when a sheet must open at a specific height.
   */
  snapPoints?: string[];
  /** Wraps content in a scroll view. Needed when content can exceed `maxHeightRatio`. */
  scrollable?: boolean;
  /** Cap on the auto-measured height, as a fraction of the screen. */
  maxHeightRatio?: number;
  contentStyle?: ViewStyle;
}

/**
 * The single bottom-sheet shell: handle, title, close button, backdrop, pan-to-dismiss.
 *
 * **Sizes itself to its content.** It previously opened at a fixed `50%` first snap point,
 * which cut off anything taller and forced the user to drag the sheet up before they could
 * see — let alone tap — the last option. `enableDynamicSizing` measures the content and opens
 * at exactly that height, capped at `maxHeightRatio` of the screen so a long list still leaves
 * the backdrop reachable.
 *
 * There is also an explicit close button. Pan-to-dismiss and backdrop-tap both still work, but
 * neither is discoverable, and on a wide screen the backdrop can be off to the side.
 *
 * **Nothing is rendered while closed.** A `BottomSheet` held at `index={-1}` stays mounted and
 * keeps a full-screen container in the tree. A screen that declares two sheets — the create-order
 * form declares one for activity and one for priority — therefore stacked an invisible closed
 * container over the open one, and it ate every tap aimed at the sheet underneath: the close
 * button and the backdrop both looked dead. Returning `null` when closed means only the sheet
 * actually in use exists, so its own controls receive their taps.
 *
 * The trade is the exit animation: unmounting is immediate. Entry still animates, because
 * `animateOnMount` opens from `-1` to `0`. A sheet that closes instantly but reliably beats one
 * that slides out prettily and sometimes refuses to.
 */
export function ThemedBottomSheet({
  isOpen,
  onClose,
  title,
  children,
  snapPoints,
  scrollable = false,
  maxHeightRatio = 0.85,
  contentStyle,
  ...rest
}: Props): React.JSX.Element | null {
  const sheetRef = useRef<BottomSheet>(null);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.4}
        pressBehavior="close"
      />
    ),
    [],
  );

  // Always rendered, even without a title: the close button is the point.
  const header = (
    <View style={styles.header}>
      {title !== undefined ? (
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      ) : (
        <View style={styles.titleSpacer} />
      )}
      <PressableScale onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
        <View style={styles.closeButton}>
          <MaterialIcons name="close" size={20} color={colors.onSurfaceVariant} />
        </View>
      </PressableScale>
    </View>
  );

  const Container = scrollable ? BottomSheetScrollView : BottomSheetView;

  if (!isOpen) return null;

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      // Only constrain the height when the caller insists; otherwise measure the content.
      {...(snapPoints ? { snapPoints } : { enableDynamicSizing: true })}
      maxDynamicContentSize={Dimensions.get('window').height * maxHeightRatio}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handle}
      {...rest}
    >
      <Container style={scrollable ? undefined : [styles.content, contentStyle]}>
        {scrollable ? (
          <View style={[styles.content, contentStyle]}>
            {header}
            {children}
          </View>
        ) : (
          <>
            {header}
            {children}
          </>
        )}
      </Container>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
  },
  handle: { backgroundColor: colors.outlineVariant, width: 40, height: 5, borderRadius: radii.full },
  content: {
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[8],
    paddingTop: spacing[1],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  titleSpacer: { flex: 1 },
  title: {
    flex: 1,
    fontFamily: fonts.sansBold,
    fontSize: typography.title2.size,
    lineHeight: typography.title2.lineHeight,
    fontWeight: typography.title2.weight,
    color: colors.onSurface,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
