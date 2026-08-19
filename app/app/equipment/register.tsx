import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type {
  EquipmentCategoryDto,
  EquipmentIdentificationDraft,
  EquipmentLocationDto,
} from '@menuboard/shared';
import { Capability, CaptureSource, LIMITS } from '@menuboard/shared';
import { equipmentApi, equipmentErrorMessage } from '../../src/api/equipment';
import { useCapabilities } from '../../src/permissions/useCapabilities';
import { EmptyState } from '../../src/components/EmptyState';
import { FormInput } from '../../src/components/FormInput';
import { PickerSheet } from '../../src/components/PickerSheet';
import { PressableScale } from '../../src/components/PressableScale';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { TopAppBar } from '../../src/components/TopAppBar';
import { pickEquipmentPhoto } from '../../src/utils/attachmentPicker';
import { radii, spacing, typography } from '../../src/theme/tokens';
import { useThemeColors } from '../../src/theme/useThemeColors';

/**
 * Registering an asset: photograph it, let the vision model read its rating plate, correct
 * whatever it got wrong, save.
 *
 * The confirmation form is the product, not the AI. Every field is editable, every field the
 * model filled says so, and the ones it was unsure about are called out at the top — because a
 * draft presented as fact is worse than no draft at all. If AI is unconfigured or the photo is
 * unreadable the server says so in a sentence and the same form opens empty, which is the
 * manual path and is never a degraded one.
 */

interface FormState {
  name: string;
  equipmentType: string;
  brand: string;
  model: string;
  serialNumber: string;
  manufacturer: string;
  categoryId: string | null;
  locationId: string | null;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  equipmentType: '',
  brand: '',
  model: '',
  serialNumber: '',
  manufacturer: '',
  categoryId: null,
  locationId: null,
  notes: '',
};

/** Which fields the model filled, so the form can label them "AI suggestion". */
type AiField = keyof Pick<
  FormState,
  'name' | 'equipmentType' | 'brand' | 'model' | 'serialNumber' | 'manufacturer' | 'categoryId'
>;

const AI_FIELD_LABELS: Record<AiField, string> = {
  name: 'Name',
  equipmentType: 'Type',
  brand: 'Brand',
  model: 'Model',
  serialNumber: 'Serial number',
  manufacturer: 'Manufacturer',
  categoryId: 'Category',
};

/** Whatever the model named, in the words the form uses. Unrecognised keys pass through. */
function humaniseUncertain(fields: readonly string[]): string[] {
  return fields.map((field) => AI_FIELD_LABELS[field as AiField] ?? field);
}

interface FlatLocation {
  id: string;
  label: string;
  subtitle: string;
}

interface LocationTreeShape {
  floors: { name: string; areas: { name: string; locations: EquipmentLocationDto[] }[] }[];
}

function flattenLocations(floors: LocationTreeShape): FlatLocation[] {
  const rows: FlatLocation[] = [];
  for (const floor of floors.floors) {
    for (const area of floor.areas) {
      for (const location of area.locations) {
        rows.push({
          id: location.id,
          label: [location.name, location.section, location.position]
            .filter((part): part is string => part !== null && part !== '')
            .join(' · '),
          subtitle: `${floor.name} · ${area.name}`,
        });
      }
    }
  }
  return rows;
}

export default function RegisterEquipmentScreen(): React.JSX.Element {
  const router = useRouter();
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { has } = useCapabilities();
  const canCreate = has(Capability.EQUIPMENT_CREATE);
  const canUpload = has(Capability.EQUIPMENT_REPORT_PROBLEM);

  const [step, setStep] = useState<'capture' | 'form'>('capture');
  const [busy, setBusy] = useState<null | 'uploading' | 'identifying' | 'saving'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EquipmentIdentificationDraft | null>(null);
  const [aiFields, setAiFields] = useState<Set<AiField>>(new Set());

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [categories, setCategories] = useState<EquipmentCategoryDto[]>([]);
  const [locations, setLocations] = useState<FlatLocation[]>([]);
  const [categorySheet, setCategorySheet] = useState(false);
  const [locationSheet, setLocationSheet] = useState(false);

  useEffect(() => {
    if (!canCreate) return;
    void (async () => {
      try {
        const [categoryList, tree] = await Promise.all([
          equipmentApi.listCategories(),
          equipmentApi.locationTree(),
        ]);
        setCategories(categoryList);
        setLocations(flattenLocations(tree));
      } catch (caught) {
        setError(equipmentErrorMessage(caught, 'Categories and locations could not be loaded.'));
      }
    })();
  }, [canCreate]);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
    // An edited field is the user's answer, not the model's, so the badge comes off.
    setAiFields((current) => {
      if (!current.has(key as AiField)) return current;
      const next = new Set(current);
      next.delete(key as AiField);
      return next;
    });
  }, []);

  const capture = useCallback(
    async (source: 'camera' | 'library'): Promise<void> => {
      setError(null);
      setNotice(null);
      const picked = await pickEquipmentPhoto(source);
      if (picked === null) return;
      setPhotoUri(picked.uri);

      setBusy('uploading');
      let uploadedId: string;
      try {
        const media = await equipmentApi.uploadMedia({
          uri: picked.uri,
          fileName: picked.fileName,
          mimeType: picked.mimeType,
        });
        uploadedId = media.id;
        setMediaId(media.id);
      } catch (caught) {
        setBusy(null);
        setError(equipmentErrorMessage(caught, 'The photo could not be uploaded.'));
        return;
      }

      setBusy('identifying');
      try {
        const identified = await equipmentApi.identify(uploadedId);
        setDraft(identified);
        const filled = new Set<AiField>();
        const nextForm: FormState = { ...EMPTY_FORM };
        const assign = (field: AiField, value: string | null): void => {
          if (value === null || value === '') return;
          nextForm[field] = value;
          filled.add(field);
        };
        assign('name', identified.name);
        assign('equipmentType', identified.equipmentType);
        assign('brand', identified.brand);
        assign('model', identified.model);
        assign('serialNumber', identified.serialNumber);
        assign('manufacturer', identified.manufacturer);
        if (identified.categoryId !== null) {
          nextForm.categoryId = identified.categoryId;
          filled.add('categoryId');
        }
        setForm(nextForm);
        setAiFields(filled);
      } catch (caught) {
        // A refusal here is expected and survivable: the manual form is the same form.
        setNotice(
          equipmentErrorMessage(
            caught,
            'The photo could not be read. Fill the details in yourself.',
          ),
        );
      } finally {
        setBusy(null);
        setStep('form');
      }
    },
    [],
  );

  const submit = useCallback(async (): Promise<void> => {
    if (form.name.trim() === '') {
      setError('Give the asset a name.');
      return;
    }
    setBusy('saving');
    setError(null);
    try {
      const created = await equipmentApi.create({
        name: form.name.trim(),
        equipmentType: form.equipmentType.trim() === '' ? null : form.equipmentType.trim(),
        brand: form.brand.trim() === '' ? null : form.brand.trim(),
        model: form.model.trim() === '' ? null : form.model.trim(),
        serialNumber: form.serialNumber.trim() === '' ? null : form.serialNumber.trim(),
        manufacturer: form.manufacturer.trim() === '' ? null : form.manufacturer.trim(),
        categoryId: form.categoryId,
        locationId: form.locationId,
        imageMediaId: mediaId,
        notes: form.notes.trim() === '' ? null : form.notes.trim(),
        specifications: draft?.specifications ?? null,
        capturedVia: draft !== null ? CaptureSource.PHOTO_AI : CaptureSource.MANUAL,
      });
      router.replace({
        pathname: '/equipment/[equipmentId]',
        params: { equipmentId: created.id },
      });
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'The asset was not saved.'));
    } finally {
      setBusy(null);
    }
  }, [draft, form, mediaId, router]);

  if (!canCreate) {
    return (
      <View style={styles.screen}>
        <TopAppBar title="Register equipment" onBack={() => router.back()} />
        <EmptyState
          title="Not your job"
          subtitle="Registering an asset is a manager's task. You can still report problems against equipment that already exists."
        />
      </View>
    );
  }

  const selectedCategory = categories.find((category) => category.id === form.categoryId);
  const selectedLocation = locations.find((location) => location.id === form.locationId);
  const uncertain = draft?.uncertainFields ?? [];

  return (
    <View style={styles.screen}>
      <TopAppBar title="Register equipment" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {step === 'capture' ? (
          <View style={styles.captureBlock}>
            <View style={styles.captureIcon}>
              <MaterialIcons name="photo-camera" size={40} color={colors.taskBar} />
            </View>
            <Text style={styles.captureTitle}>Photograph the rating plate</Text>
            <Text style={styles.captureBody}>
              The clearer the plate, the more of the form fills itself. Everything it proposes is
              yours to correct before anything is saved.
            </Text>

            {error !== null ? <ErrorBar text={error} /> : null}

            {canUpload ? (
              <>
                <PrimaryButton
                  label="Take a photo"
                  loading={busy === 'uploading' || busy === 'identifying'}
                  onPress={() => void capture('camera')}
                />
                <View style={styles.captureSpacer} />
                <PrimaryButton
                  label="Choose an existing photo"
                  variant="secondary"
                  disabled={busy !== null}
                  onPress={() => void capture('library')}
                />
              </>
            ) : null}
            <View style={styles.captureSpacer} />
            <PrimaryButton
              label="Enter the details myself"
              variant="ghost"
              disabled={busy !== null}
              onPress={() => {
                setStep('form');
                setForm(EMPTY_FORM);
                setDraft(null);
                setAiFields(new Set());
              }}
            />
            {busy === 'identifying' ? (
              <Text style={styles.busyLine}>Reading the plate…</Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.formBlock}>
            {photoUri !== null ? (
              <Image source={{ uri: photoUri }} style={styles.thumb} />
            ) : null}

            {notice !== null ? (
              <View style={styles.noticeBar}>
                <MaterialIcons name="info-outline" size={18} color={colors.onTertiaryContainer} />
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            ) : null}

            {draft !== null ? (
              <View style={styles.aiBanner}>
                <MaterialIcons name="auto-awesome" size={18} color={colors.onPrimaryContainer} />
                <Text style={styles.aiBannerText}>
                  {uncertain.length === 0
                    ? 'Filled in from the photo. Check every line before saving.'
                    : `Filled in from the photo. Unsure about: ${humaniseUncertain(uncertain).join(', ')}.`}
                </Text>
              </View>
            ) : null}

            {error !== null ? <ErrorBar text={error} /> : null}

            <FieldLabel label="Name" ai={aiFields.has('name')} />
            <FormInput
              label=""
              value={form.name}
              onChangeText={(value) => set('name', value)}
              placeholder="Combi oven, back line"
              maxLength={LIMITS.EQUIPMENT_NAME_MAX}
            />

            <FieldLabel label="Type" ai={aiFields.has('equipmentType')} />
            <FormInput
              label=""
              value={form.equipmentType}
              onChangeText={(value) => set('equipmentType', value)}
              placeholder="Convection oven"
              maxLength={LIMITS.EQUIPMENT_TYPE_MAX}
            />

            <FieldLabel label="Brand" ai={aiFields.has('brand')} />
            <FormInput
              label=""
              value={form.brand}
              onChangeText={(value) => set('brand', value)}
              maxLength={LIMITS.EQUIPMENT_BRAND_MAX}
            />

            <FieldLabel label="Model" ai={aiFields.has('model')} />
            <FormInput
              label=""
              value={form.model}
              onChangeText={(value) => set('model', value)}
              maxLength={LIMITS.EQUIPMENT_MODEL_MAX}
            />

            <FieldLabel label="Serial number" ai={aiFields.has('serialNumber')} />
            <FormInput
              label=""
              value={form.serialNumber}
              onChangeText={(value) => set('serialNumber', value)}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={LIMITS.EQUIPMENT_SERIAL_MAX}
            />

            <FieldLabel label="Manufacturer" ai={aiFields.has('manufacturer')} />
            <FormInput
              label=""
              value={form.manufacturer}
              onChangeText={(value) => set('manufacturer', value)}
              maxLength={LIMITS.EQUIPMENT_MANUFACTURER_MAX}
            />

            <FieldLabel label="Category" ai={aiFields.has('categoryId')} />
            <SelectRow
              value={selectedCategory?.name ?? 'Choose a category'}
              placeholder={selectedCategory === undefined}
              onPress={() => setCategorySheet(true)}
            />

            <FieldLabel label="Location" />
            <SelectRow
              value={
                selectedLocation === undefined
                  ? 'Choose where it stands'
                  : `${selectedLocation.label} — ${selectedLocation.subtitle}`
              }
              placeholder={selectedLocation === undefined}
              onPress={() => setLocationSheet(true)}
            />

            <FieldLabel label="Notes" />
            <FormInput
              label=""
              value={form.notes}
              onChangeText={(value) => set('notes', value)}
              placeholder="Anything the next person should know"
              multiline
              maxLength={LIMITS.EQUIPMENT_NOTES_MAX}
            />

            <PrimaryButton
              label="Register asset"
              loading={busy === 'saving'}
              disabled={form.name.trim() === ''}
              onPress={() => void submit()}
            />
            <View style={styles.captureSpacer} />
            <PrimaryButton
              label="Back to the photo"
              variant="ghost"
              disabled={busy !== null}
              onPress={() => setStep('capture')}
            />
          </View>
        )}
      </ScrollView>

      <PickerSheet
        isOpen={categorySheet}
        onClose={() => setCategorySheet(false)}
        title="Category"
        searchable
        options={categories.map((category) => ({
          id: category.id,
          label: category.name,
          subtitle: category.assetSegment,
        }))}
        selectedId={form.categoryId}
        onSelect={(option) => set('categoryId', option.id)}
      />

      <PickerSheet
        isOpen={locationSheet}
        onClose={() => setLocationSheet(false)}
        title="Location"
        searchable
        options={locations}
        selectedId={form.locationId}
        onSelect={(option) => set('locationId', option.id)}
      />
    </View>
  );
}

/**
 * The label above a field, carrying the "AI suggestion" mark.
 *
 * `FormInput` renders its own label, but it cannot show a badge beside it, and the badge is the
 * whole point of this screen: a value the model guessed must never look like one a person typed.
 */
function FieldLabel({ label, ai = false }: { label: string; ai?: boolean }): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.fieldLabelRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {ai ? (
        <View style={styles.aiTag}>
          <MaterialIcons name="auto-awesome" size={11} color={colors.onPrimaryContainer} />
          <Text style={styles.aiTagText}>AI SUGGESTION</Text>
        </View>
      ) : null}
    </View>
  );
}

function SelectRow({
  value,
  placeholder,
  onPress,
}: {
  value: string;
  placeholder: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={value}>
      <View style={styles.selectRow}>
        <Text
          style={[styles.selectValue, placeholder && styles.selectPlaceholder]}
          numberOfLines={1}
        >
          {value}
        </Text>
        <MaterialIcons name="expand-more" size={22} color={colors.outline} />
      </View>
    </PressableScale>
  );
}

function ErrorBar({ text }: { text: string }): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.errorBar}>
      <MaterialIcons name="error-outline" size={18} color={colors.onErrorContainer} />
      <Text style={styles.errorText}>{text}</Text>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useThemeColors>['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.marginMobile, paddingBottom: spacing[12] },

    captureBlock: { paddingTop: spacing[8], alignItems: 'stretch' },
    captureIcon: {
      alignSelf: 'center',
      width: 88,
      height: 88,
      borderRadius: radii.full,
      backgroundColor: colors.surfaceContainer,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing[5],
    },
    captureTitle: {
      fontFamily: typography.headlineLg.fontFamily,
      fontSize: typography.headlineLg.size,
      lineHeight: typography.headlineLg.lineHeight,
      color: colors.onSurface,
      textAlign: 'center',
    },
    captureBody: {
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      lineHeight: typography.bodyMd.lineHeight,
      color: colors.onSurfaceVariant,
      textAlign: 'center',
      marginTop: spacing[2],
      marginBottom: spacing[6],
    },
    captureSpacer: { height: spacing[3] },
    busyLine: {
      marginTop: spacing[4],
      textAlign: 'center',
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.onSurfaceVariant,
    },

    formBlock: { paddingTop: spacing[2] },
    thumb: {
      width: '100%',
      height: 180,
      borderRadius: radii.xl,
      backgroundColor: colors.surfaceContainerLow,
      marginBottom: spacing[4],
    },

    aiBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing[2],
      padding: spacing[3],
      borderRadius: radii.lg,
      backgroundColor: colors.primaryFixed,
      marginBottom: spacing[4],
    },
    aiBannerText: {
      flex: 1,
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onPrimaryContainer,
    },
    noticeBar: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing[2],
      padding: spacing[3],
      borderRadius: radii.lg,
      backgroundColor: colors.tertiaryFixed,
      marginBottom: spacing[4],
    },
    noticeText: {
      flex: 1,
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onTertiaryContainer,
    },
    errorBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      padding: spacing[3],
      borderRadius: radii.lg,
      backgroundColor: colors.errorContainer,
      marginBottom: spacing[4],
    },
    errorText: {
      flex: 1,
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      lineHeight: typography.bodySm.lineHeight,
      color: colors.onErrorContainer,
    },

    fieldLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      marginBottom: spacing[1.5],
    },
    fieldLabel: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: typography.labelCaps.size,
      letterSpacing: typography.labelCaps.letterSpacing,
      color: colors.textSecondary,
      textTransform: 'uppercase',
    },
    aiTag: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[0.5],
      paddingHorizontal: spacing[1.5],
      paddingVertical: spacing[0.5],
      borderRadius: radii.full,
      backgroundColor: colors.primaryFixed,
    },
    aiTagText: {
      fontFamily: typography.labelCaps.fontFamily,
      fontSize: 9,
      letterSpacing: typography.labelCaps.letterSpacing,
      color: colors.onPrimaryContainer,
    },

    selectRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      minHeight: 48,
      paddingHorizontal: spacing[3],
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.gray200,
      backgroundColor: colors.surfaceContainerLowest,
      marginBottom: spacing[4],
    },
    selectValue: {
      flex: 1,
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.textPrimary,
    },
    selectPlaceholder: { color: colors.gray400 },
  });
}
