import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import { Capability, LIMITS } from '@menuboard/shared';
import { equipmentApi, equipmentErrorMessage } from '../../src/api/equipment';
import { useCapabilities } from '../../src/permissions/useCapabilities';
import { EmptyState } from '../../src/components/EmptyState';
import { FormInput } from '../../src/components/FormInput';
import { PressableScale } from '../../src/components/PressableScale';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { TopAppBar } from '../../src/components/TopAppBar';
import { layout, radii, spacing, typography } from '../../src/theme/tokens';
import { useThemeColors } from '../../src/theme/useThemeColors';

/**
 * Finding an asset by its printed identity — scanned with the camera, or typed when it cannot be.
 *
 * A MenuBoard label encodes `menuboard://equipment/<ASSET-ID>`, but the code is never parsed
 * here: `GET /equipment/resolve` matches the deep link, the bare asset id and an NFC tag id
 * alike, so whatever came off the label goes to the server exactly as scanned. One place decides
 * what an identifier means, and it is the one holding the data.
 *
 * Manual entry is not a fallback bolted on for failures — it stays on the screen underneath the
 * viewfinder at all times. A greasy label, a dead camera permission or a machine in a dark
 * cupboard must never end with the reporter stuck, so every path off this screen stays open.
 */

/** Guards against the same label firing the callback dozens of times a second. */
type ScanState = 'IDLE' | 'RESOLVING' | 'DONE';

export default function ScanScreen(): React.JSX.Element {
  const router = useRouter();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { has } = useCapabilities();

  // The server allows either on `/equipment/resolve`: a monitor browsing the estate and a
  // reporter who may only ever see the machine in front of them both arrive by scanning.
  const canScan = has(Capability.EQUIPMENT_REPORT_PROBLEM) || has(Capability.EQUIPMENT_VIEW);

  const [permission, requestPermission] = useCameraPermissions();
  const [cameraFailed, setCameraFailed] = useState(false);
  const [torch, setTorch] = useState(false);

  const [scanState, setScanState] = useState<ScanState>('IDLE');
  const [scanned, setScanned] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  /** Read synchronously inside the barcode callback, which fires faster than state settles. */
  const lockRef = useRef(false);

  const [code, setCode] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const open = useCallback(
    (equipmentId: string): void => {
      router.replace({ pathname: '/equipment/[equipmentId]', params: { equipmentId } });
    },
    [router],
  );

  const resolveScan = useCallback(
    async (value: string): Promise<void> => {
      setScanState('RESOLVING');
      setScanError(null);
      try {
        const found = await equipmentApi.resolve(value);
        setScanState('DONE');
        open(found.id);
      } catch (caught) {
        setScanState('DONE');
        setScanError(
          equipmentErrorMessage(caught, `Nothing on this server matches the code on that label.`),
        );
      }
    },
    [open],
  );

  const onBarcodeScanned = useCallback(
    (result: BarcodeScanningResult): void => {
      if (lockRef.current) return;
      lockRef.current = true;
      const value = result.data.trim();
      setScanned(value);
      void resolveScan(value);
    },
    [resolveScan],
  );

  const scanAgain = useCallback((): void => {
    lockRef.current = false;
    setScanned(null);
    setScanError(null);
    setScanState('IDLE');
  }, []);

  const findManually = useCallback(async (): Promise<void> => {
    const trimmed = code.trim();
    if (trimmed === '') return;
    setManualBusy(true);
    setManualError(null);
    try {
      const found = await equipmentApi.resolve(trimmed);
      open(found.id);
    } catch (caught) {
      setManualError(equipmentErrorMessage(caught, `Nothing on this server matches "${trimmed}".`));
    } finally {
      setManualBusy(false);
    }
  }, [code, open]);

  if (!canScan) {
    return (
      <View style={styles.screen}>
        <TopAppBar title="Find equipment" onBack={() => router.back()} />
        <EmptyState
          title="Not available"
          subtitle="Your account cannot look equipment up. Ask a manager to check the machine for you."
        />
      </View>
    );
  }

  const cameraUsable = permission?.granted === true && !cameraFailed;

  return (
    <View style={styles.screen}>
      <TopAppBar title="Find equipment" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {cameraUsable ? (
          <View style={styles.viewfinder}>
            <CameraView
              style={styles.camera}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              // Detaching the handler is what actually stops the scanner: the native module keeps
              // reading frames, and a QR code held in view re-fires until it is taken away.
              {...(scanState === 'IDLE' ? { onBarcodeScanned } : {})}
              onMountError={() => setCameraFailed(true)}
            />

            <View style={styles.reticle} pointerEvents="none" />

            <PressableScale
              onPress={() => setTorch((current) => !current)}
              accessibilityRole="button"
              accessibilityLabel={torch ? 'Turn the light off' : 'Turn the light on'}
              style={styles.torchPress}
            >
              <View style={styles.torchButton}>
                <MaterialIcons
                  name={torch ? 'flashlight-off' : 'flashlight-on'}
                  size={20}
                  color={colors.white}
                />
              </View>
            </PressableScale>

            {scanState === 'RESOLVING' ? (
              <View style={styles.scanOverlay} pointerEvents="none">
                <ActivityIndicator color={colors.white} />
                <Text style={styles.scanOverlayText}>Looking that up…</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.cameraOffBlock}>
            <View style={styles.icon}>
              <MaterialIcons name="qr-code-scanner" size={40} color={colors.taskBar} />
            </View>
            {permission === null ? (
              <Text style={styles.cameraOffText}>Checking whether the camera is available…</Text>
            ) : cameraFailed ? (
              <Text style={styles.cameraOffText}>
                This device&apos;s camera could not be started, so there is nothing to scan with.
                Type the asset id below instead — it reaches the same place.
              </Text>
            ) : permission.canAskAgain ? (
              <>
                <Text style={styles.cameraOffText}>
                  Point the camera at the QR label on the machine and it opens straight away.
                </Text>
                <PrimaryButton
                  label="Use the camera"
                  onPress={() => void requestPermission()}
                />
              </>
            ) : (
              <Text style={styles.cameraOffText}>
                Camera access is switched off for MenuBoard, so scanning is unavailable until it is
                granted in Android&apos;s app settings. Type the asset id below in the meantime.
              </Text>
            )}
          </View>
        )}

        {scanned !== null ? (
          <View style={styles.scannedRow}>
            <MaterialIcons name="qr-code" size={18} color={colors.onSurfaceVariant} />
            <Text style={styles.scannedText} numberOfLines={1}>
              {scanned}
            </Text>
          </View>
        ) : null}

        {scanError !== null ? (
          <>
            <View style={styles.errorBar}>
              <MaterialIcons name="error-outline" size={18} color={colors.onErrorContainer} />
              <Text style={styles.errorText}>{scanError}</Text>
            </View>
            <PrimaryButton label="Scan another label" variant="secondary" onPress={scanAgain} />
          </>
        ) : null}

        <View style={styles.divider} />

        <Text style={styles.manualTitle}>Or type the asset id</Text>
        <Text style={styles.manualBody}>
          Read it off the label — it looks like MTC-KIT-OVN-001. A QR payload pasted from another
          app or an NFC tag id works here too.
        </Text>

        <FormInput
          label=""
          value={code}
          onChangeText={setCode}
          placeholder="MTC-KIT-OVN-001"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => void findManually()}
          maxLength={LIMITS.EQUIPMENT_QR_CODE_MAX}
          error={manualError}
        />

        <PrimaryButton
          label="Open equipment"
          variant={cameraUsable ? 'secondary' : 'primary'}
          loading={manualBusy}
          disabled={code.trim() === ''}
          onPress={() => void findManually()}
        />
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useThemeColors>['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.marginMobile, paddingBottom: spacing[12] },

    viewfinder: {
      width: '100%',
      aspectRatio: 1,
      maxHeight: layout.screenH * 0.42,
      alignSelf: 'center',
      borderRadius: radii['2xl'],
      overflow: 'hidden',
      backgroundColor: colors.gray900,
      marginBottom: spacing[4],
    },
    camera: { flex: 1 },
    reticle: {
      position: 'absolute',
      top: spacing[8],
      left: spacing[8],
      right: spacing[8],
      bottom: spacing[8],
      borderWidth: 2,
      borderColor: colors.white,
      borderRadius: radii.xl,
    },
    torchPress: { position: 'absolute', top: spacing[3], right: spacing[3] },
    torchButton: {
      width: 40,
      height: 40,
      borderRadius: radii.full,
      backgroundColor: colors.scrim,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scanOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing[2],
      backgroundColor: colors.scrim,
    },
    scanOverlayText: {
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      lineHeight: typography.bodyMd.lineHeight,
      color: colors.white,
    },

    cameraOffBlock: { paddingTop: spacing[6], paddingBottom: spacing[2] },
    icon: {
      alignSelf: 'center',
      width: 88,
      height: 88,
      borderRadius: radii.full,
      backgroundColor: colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing[5],
    },
    cameraOffText: {
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      lineHeight: typography.bodyMd.lineHeight,
      color: colors.onSurfaceVariant,
      textAlign: 'center',
      marginBottom: spacing[4],
    },

    scannedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      padding: spacing[3],
      borderRadius: radii.lg,
      backgroundColor: colors.surfaceContainerLow,
      marginBottom: spacing[3],
    },
    scannedText: {
      flex: 1,
      fontFamily: typography.dataMono.fontFamily,
      fontSize: typography.dataMono.size,
      letterSpacing: typography.dataMono.letterSpacing,
      color: colors.onSurfaceVariant,
    },
    errorBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      padding: spacing[3],
      borderRadius: radii.lg,
      backgroundColor: colors.errorContainer,
      marginBottom: spacing[3],
    },
    errorText: {
      flex: 1,
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onErrorContainer,
    },

    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.outlineVariant,
      marginVertical: spacing[5],
    },
    manualTitle: {
      fontFamily: typography.headlineMd.fontFamily,
      fontSize: typography.headlineMd.size,
      lineHeight: typography.headlineMd.lineHeight,
      color: colors.onSurface,
    },
    manualBody: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onSurfaceVariant,
      marginTop: spacing[1],
      marginBottom: spacing[4],
    },
  });
}
