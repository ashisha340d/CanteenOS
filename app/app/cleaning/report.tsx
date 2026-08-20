import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  CLEANING_REPORTABLE_EVENTS,
  CLEANING_TRIGGER_EVENT_LABELS,
  CleaningTaskPriority,
  CleaningTriggerEvent,
  LIMITS,
  type CleanableAssetDto,
  type CleaningReportResultDto,
  type CleaningSetupDto,
} from '@menuboard/shared';
import { cleaningApi, cleaningErrorMessage } from '../../src/api/cleaning';
import { equipmentApi } from '../../src/api/equipment';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { TopAppBar } from '../../src/components/TopAppBar';
import { ChoiceChips, type Choice } from '../../src/components/equipment/ChoiceChips';
import { PickerSheet } from '../../src/components/PickerSheet';
import { radii, spacing, typography } from '../../src/theme/tokens';
import { useThemeColors } from '../../src/theme/useThemeColors';
import type { ColorPalette } from '../../src/theme/tokens';

/**
 * "This needs cleaning."
 *
 * The screen every user of the app can reach, and the reason the module is worth having: the
 * person standing in front of the mess is the only one who knows about it.
 *
 * Choosing an area is enough — the server resolves it to that area's general cleanable asset —
 * because somebody who has just found a spill should not have to know what the register calls
 * the floor. Naming the exact thing is offered, never required.
 *
 * The result is shown, not swallowed: what was raised, and who has it.
 */
export default function ReportCleaningScreen(): React.JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams<{ cleanableAssetId?: string }>();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [setup, setSetup] = useState<CleaningSetupDto | null>(null);
  const [assets, setAssets] = useState<CleanableAssetDto[]>([]);
  const [areaId, setAreaId] = useState('');
  const [assetId, setAssetId] = useState(params.cleanableAssetId ?? '');
  const [eventType, setEventType] = useState<CleaningTriggerEvent>(
    CleaningTriggerEvent.MANUAL_TRIGGER,
  );
  const [priority, setPriority] = useState<CleaningTaskPriority | null>(null);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<{ id: string; uri: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CleaningReportResultDto | null>(null);
  const [areaPicker, setAreaPicker] = useState(false);
  const [assetPicker, setAssetPicker] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setSetup(await cleaningApi.setup());
      } catch (caught) {
        setError(cleaningErrorMessage(caught, 'The area list could not be loaded.'));
      }
    })();
  }, []);

  // A named asset was passed in (from the scanner or an asset screen): adopt its area so the
  // form is consistent and the picker below is narrowed to the right place.
  useEffect(() => {
    if (params.cleanableAssetId === undefined) return;
    void (async () => {
      try {
        const asset = await cleaningApi.getAsset(params.cleanableAssetId as string);
        setAreaId(asset.areaId);
        setAssetId(asset.id);
      } catch {
        // A bad id from a deep link is not worth an error banner on a reporting screen; the
        // person can still choose the place by hand.
      }
    })();
  }, [params.cleanableAssetId]);

  const loadAssets = useCallback(async (area: string): Promise<void> => {
    if (area === '') {
      setAssets([]);
      return;
    }
    try {
      const page = await cleaningApi.listAssets({ areaId: area, pageSize: 200 });
      setAssets(page.items);
    } catch {
      setAssets([]);
    }
  }, []);

  useEffect(() => {
    void loadAssets(areaId);
  }, [areaId, loadAssets]);

  async function addPhoto(): Promise<void> {
    if (photos.length >= LIMITS.CLEANING_EVIDENCE_PER_TASK_MAX) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera needed', 'Allow the camera to show what needs cleaning.');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (shot.canceled || shot.assets[0] === undefined) return;
    const asset = shot.assets[0];

    setBusy(true);
    try {
      const media = await equipmentApi.uploadMedia({
        uri: asset.uri,
        fileName: asset.fileName ?? `cleaning-report-${Date.now()}.jpg`,
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
      setPhotos((current) => [...current, { id: media.id, uri: asset.uri }]);
    } catch (caught) {
      setError(cleaningErrorMessage(caught, 'The photo could not be uploaded.'));
    } finally {
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    if (areaId === '' && assetId === '') {
      setError('Choose where it is.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(
        await cleaningApi.report({
          eventType,
          ...(assetId !== '' ? { cleanableAssetId: assetId } : {}),
          ...(areaId !== '' ? { areaId } : {}),
          ...(priority !== null ? { priority } : {}),
          ...(note.trim() !== '' ? { note: note.trim() } : {}),
          ...(photos.length > 0 ? { photoMediaIds: photos.map((photo) => photo.id) } : {}),
        }),
      );
    } catch (caught) {
      setError(cleaningErrorMessage(caught, 'That could not be reported.'));
    } finally {
      setBusy(false);
    }
  }

  const areaName =
    (setup?.areas ?? []).find((area) => area.id === areaId)?.name ?? 'Choose an area';
  const assetName =
    assets.find((asset) => asset.id === assetId)?.name ?? 'The area in general';

  const eventChoices: readonly Choice<CleaningTriggerEvent>[] = CLEANING_REPORTABLE_EVENTS.map(
    (value) => ({ value, label: CLEANING_TRIGGER_EVENT_LABELS[value] }),
  );

  const priorityChoices: readonly Choice<CleaningTaskPriority>[] = [
    { value: CleaningTaskPriority.NORMAL, label: 'Normal' },
    { value: CleaningTaskPriority.HIGH, label: 'Urgent' },
    { value: CleaningTaskPriority.CRITICAL, label: 'Right now' },
  ];

  if (result !== null) {
    return (
      <View style={styles.screen}>
        <TopAppBar title="Reported" onBack={() => router.back()} />
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.doneMark}>
            <MaterialIcons name="check-circle" size={48} color={colors.onSecondaryContainer} />
          </View>
          <Text style={styles.doneText}>{result.message}</Text>

          {result.tasks.map((task) => (
            <View key={task.id} style={styles.card}>
              <Text style={styles.cardTitle}>{task.taskName}</Text>
              <Text style={styles.meta}>
                {task.locationPath} · {task.priority}
              </Text>
              <Text style={styles.meta}>
                {task.assignedToName ?? 'A supervisor has been asked to assign it'}
              </Text>
            </View>
          ))}

          <PrimaryButton
            label="Report something else"
            variant="secondary"
            onPress={() => {
              setResult(null);
              setNote('');
              setPhotos([]);
              setPriority(null);
            }}
          />
          <PrimaryButton label="Done" onPress={() => router.back()} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <TopAppBar title="Report cleaning" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {error !== null ? (
          <View style={styles.errorBar}>
            <MaterialIcons name="error-outline" size={18} color={colors.onErrorContainer} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>Where is it?</Text>
        <PrimaryButton
          variant="secondary"
          label={areaName}
          onPress={() => setAreaPicker(true)}
        />

        <Text style={styles.label}>Exactly what? (optional)</Text>
        <PrimaryButton
          variant="secondary"
          label={assetName}
          onPress={() => setAssetPicker(true)}
          disabled={areaId === ''}
        />
        <Text style={styles.hint}>
          Leave this as it is if it is the area itself — a floor, a wall, a corner.
        </Text>

        <Text style={styles.label}>What happened?</Text>
        <ChoiceChips choices={eventChoices} selected={eventType} onSelect={setEventType} />

        <Text style={styles.label}>Say what you found</Text>
        <TextInput
          style={styles.input}
          placeholder="Oil spill by the fryer, floor is slippery"
          placeholderTextColor={colors.onSurfaceVariant}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={LIMITS.CLEANING_EVENT_NOTE_MAX}
        />

        <Text style={styles.label}>How urgent? (optional)</Text>
        <ChoiceChips choices={priorityChoices} selected={priority} onSelect={setPriority} />
        <Text style={styles.hint}>
          This can only make the job more urgent than the rule would, never less.
        </Text>

        <Text style={styles.label}>Show it</Text>
        {photos.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.photoRow}>
              {photos.map((photo) => (
                <Image key={photo.id} source={{ uri: photo.uri }} style={styles.photo} />
              ))}
            </View>
          </ScrollView>
        ) : null}
        <PrimaryButton
          variant="secondary"
          label={photos.length === 0 ? 'Take a photo' : 'Take another'}
          onPress={() => void addPhoto()}
          disabled={busy}
        />

        <View style={styles.submit}>
          <PrimaryButton label="Report it" loading={busy} onPress={() => void submit()} />
        </View>
      </ScrollView>

      <PickerSheet
        isOpen={areaPicker}
        title="Where is it?"
        searchable
        options={(setup?.areas ?? []).map((area) => ({
          id: area.id,
          label: area.name,
          ...(area.floorName !== null ? { subtitle: area.floorName } : {}),
        }))}
        selectedId={areaId}
        onSelect={(option) => {
          setAreaId(option.id);
          setAssetId('');
          setAreaPicker(false);
        }}
        onClose={() => setAreaPicker(false)}
      />

      <PickerSheet
        isOpen={assetPicker}
        title="What exactly?"
        searchable
        options={[
          { id: '', label: 'The area in general', subtitle: 'Floors, walls, surfaces' },
          ...assets.map((asset) => ({
            id: asset.id,
            label: asset.name,
            ...(asset.positionNote !== null ? { subtitle: asset.positionNote } : {}),
          })),
        ]}
        selectedId={assetId}
        onSelect={(option) => {
          setAssetId(option.id);
          setAssetPicker(false);
        }}
        onClose={() => setAssetPicker(false)}
      />

    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: spacing[3], paddingBottom: spacing[16], gap: spacing[2] },
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
    },
    meta: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.onSurfaceVariant,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      borderRadius: radii.lg,
      padding: spacing[3],
      minHeight: 88,
      textAlignVertical: 'top',
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.onSurface,
      backgroundColor: colors.surfaceContainerLowest,
    },
    photoRow: { flexDirection: 'row', gap: spacing[2] },
    photo: { width: 96, height: 96, borderRadius: radii.lg },
    submit: { marginTop: spacing[4] },
    card: {
      padding: spacing[3],
      borderRadius: radii.xl,
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      backgroundColor: colors.surfaceContainerLowest,
      gap: spacing[0.5],
    },
    cardTitle: {
      fontFamily: typography.headlineMd.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.onSurface,
    },
    doneMark: { alignItems: 'center', marginTop: spacing[6] },
    doneText: {
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      lineHeight: typography.bodyMd.lineHeight,
      color: colors.onSurface,
      textAlign: 'center',
      marginBottom: spacing[3],
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
