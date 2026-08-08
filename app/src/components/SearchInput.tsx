import React from 'react';
import { StyleSheet, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing, typography, fonts } from '../theme/tokens';

interface Props extends TextInputProps {
  containerStyle?: ViewStyle;
}

export function SearchInput({ containerStyle, ...props }: Props): React.JSX.Element {
  return (
    <View style={[styles.container, containerStyle]}>
      <Ionicons name="search" size={18} color={colors.gray400} style={styles.icon} />
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.gray400}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.gray200,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  icon: { marginRight: spacing[2] },
  input: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: typography.body.size,
    color: colors.textPrimary,
    padding: 0,
    lineHeight: typography.body.lineHeight,
  },
});
