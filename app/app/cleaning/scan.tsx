import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { LIMITS } from '@menuboard/shared';
import { cleaningApi, cleaningErrorMessage } from '../../src/api/cleaning';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { TopAppBar } from '../../src/components/TopAppBar';
import { radii, spacing, typography } from '../../src/theme/tokens';
import { useThemeColors } from '../../src/theme/useThemeColors';
import type { ColorPalette } from '../../src/theme/tokens';

/**
 * Finding the thing in front of you by its label.
 *
 * The same shape as the equipment scanner, and for the same reason: a cleaner standing at a
 * machine should reach its cleaning record without knowing what the register calls it or which
 * area it is filed under. Typed entry is offered on equal footing, because a label peels off
 * and a camera permission gets refused.
 */
export default function CleaningScanScreen(): React.JSX.Element {
  const router = useRouter();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [permission, requestPermission] = useCameraPermissions();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);

  async function resolve(value: string): Promise<void> {
    const trimmed = value.trim();
    if (trimmed === '') return;
    setBusy(true);
    setError(null);
    try {
      const asset = await cleaningApi.resolveAsset(trimmed);
      router.replace({
        pathname: '/cleaning/report',
        params: { cleanableAssetId: asset.id },
      });
    } catch (caught) {
      setError(cleaningErrorMessage(caught, `Nothing is registered under "${trimmed}".`));
      setScanned(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <TopAppBar title="Find it by its label" onBack={() => router.back()} />

      <View style={styles.body}>
        {permission?.granted === true ? (
          <View style={styles.cameraWrap}>
            <CameraView
              style={styles.camera}
              barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'ean13'] }}
              onBarcodeScanned={({ data }) => {
                if (scanned || busy) return;
                setScanned(true);
                void resolve(data);
              }}
            />
            <Text style={styles.hint}>Point the camera at the label on the equipment.</Text>
          </View>
        ) : (
          <View style={styles.permissionBox}>
            <MaterialIcons name="photo-camera" size={32} color={colors.onSurfaceVariant} />
            <Text style={styles.hint}>
              {permission === null
                ? 'Checking the camera…'
                : 'Allow the camera to scan a label, or type the code below.'}
            </Text>
            {permission !== null && !permission.granted ? (
              <PrimaryButton
                variant="secondary"
                label="Allow the camera"
                onPress={() => void requestPermission()}
              />
            ) : null}
          </View>
        )}

        <Text style={styles.label}>Or type the code</Text>
        <TextInput
          style={styles.input}
          placeholder="KIT-FOODCONT-0001"
          placeholderTextColor={colors.onSurfaceVariant}
          autoCapitalize="characters"
          autoCorrect={false}
          value={code}
          onChangeText={setCode}
          maxLength={LIMITS.CLEANABLE_ASSET_CODE_MAX}
          onSubmitEditing={() => void resolve(code)}
        />

        {error !== null ? (
          <View style={styles.errorBar}>
            <MaterialIcons name="error-outline" size={18} color={colors.onErrorContainer} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {busy ? <ActivityIndicator color={colors.primary} /> : null}

        <PrimaryButton
          label="Find it"
          disabled={busy || code.trim() === ''}
          onPress={() => void resolve(code)}
        />
        <PrimaryButton
          variant="ghost"
          label="Report without a label"
          onPress={() => router.replace('/cleaning/report')}
        />
      </View>
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { flex: 1, padding: spacing[3], gap: spacing[2] },
    cameraWrap: { gap: spacing[2] },
    camera: { height: 260, borderRadius: radii.xl, overflow: 'hidden' },
    permissionBox: {
      alignItems: 'center',
      gap: spacing[2],
      padding: spacing[6],
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainerLowest,
    },
    label: {
      fontFamily: typography.headlineMd.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.onSurface,
      marginTop: spacing[2],
    },
    hint: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.onSurfaceVariant,
      textAlign: 'center',
    },
    input: {
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      borderRadius: radii.lg,
      padding: spacing[3],
      fontFamily: typography.dataMono.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.onSurface,
      backgroundColor: colors.surfaceContainerLowest,
    },
    errorBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      padding: spacing[3],
      borderRadius: radii.lg,
      backgroundColor: colors.errorContainer,
    },
    errorText: {
      flex: 1,
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.onErrorContainer,
    },
  });
}
