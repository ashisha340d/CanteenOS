import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LIMITS,
  MasterStatus,
  MediaEntityType,
  MediaRole,
  ScheduleShift,
  type MediaAssetDto,
  type MenuItemWriteRequest,
} from '@menuboard/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MediaPicker } from '@/components/MediaPicker/MediaPicker';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { FieldGroup, FieldRow, NumberField, SelectField, SwitchField, TextField } from '@/components/form/fields';
import { BackButton } from '../../components/BackButton';
import { PageSkeleton } from '../../components/ui/Skeletons';
import { SearchPickerField } from '../../components/SearchPickerField';
import { MediaStrip } from '../Menus/MediaStrip';
import { menuCategoriesApi } from '../../api/masters';
import { itemGroupsApi, menusApi } from '../../api/menuMaster';
import {
  useAssignCounterRoute,
  useCounterRoutesForEntity,
  useCounters,
  useCreateVariant,
  useDeleteVariant,
  useMenuItemSchedule,
  useMenuItemVariants,
  usePrintingGroups,
  usePrintingRoutesForEntity,
  useAssignPrintingRoute,
  useRemoveCounterRoute,
  useRemovePrintingRoute,
  useSetMenuItemSchedule,
  useSetVariantCatalogPrice,
  useUpdateVariant,
  useVariantCatalogPrices,
} from '../../hooks/useMenuMaster';
import { useCreateMenuItem, useMenuItem, useUpdateMenuItem } from '../../hooks/useMasters';
import { useEnterAdvance } from '../../hooks/useEnterAdvance';
import { useMediaForEntity, useAssignMedia } from '../../hooks/useMedia';
import { readError } from '../../services/errorMessage';
import { ingredientsApi } from '../../api/ingredients';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { RecipePickerButton } from './RecipePickerButton';
import { TaxComplianceSection } from './TaxComplianceSection';
import { VariantTaxOverride } from './VariantTaxOverride';

const DAYS: { key: number; label: string }[] = [
  { key: 0, label: 'Sun' },
  { key: 1, label: 'Mon' },
  { key: 2, label: 'Tue' },
  { key: 3, label: 'Wed' },
  { key: 4, label: 'Thu' },
  { key: 5, label: 'Fri' },
  { key: 6, label: 'Sat' },
];
const SHIFTS: { key: ScheduleShift; label: string }[] = [
  { key: ScheduleShift.MORNING, label: 'Morning' },
  { key: ScheduleShift.EVENING, label: 'Evening' },
];

function slotKey(day: number, shift: ScheduleShift): string {
  return `${day}-${shift}`;
}

function allSlotsAvailable(): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const d of DAYS) for (const s of SHIFTS) map[slotKey(d.key, s.key)] = true;
  return map;
}

const SAVE_BUTTON_ID = 'menu-item-save-button';

interface MenuItemHeroImageProps {
  foodItemId?: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Compact hero thumbnail shown in the form header. If the item already has a primary image it
 * is displayed; otherwise a clickable File + Image placeholder invites the user to open the
 * media picker and choose/upload a default image.
 */
function MenuItemHeroImage({ foodItemId, onClick, disabled }: MenuItemHeroImageProps): JSX.Element {
  const { data: assignments } = useMediaForEntity(MediaEntityType.MENU_ITEM, foodItemId ?? '');
  const primary = assignments?.find((a) => a.isPrimary) ?? assignments?.[0];
  const url = primary?.media?.url;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="focus-ring bg-muted text-muted-foreground hover:bg-muted/80 relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border transition-colors disabled:opacity-50"
    >
      {url ? (
        <img src={url} alt="Item" className="h-full w-full object-cover" />
      ) : (
        <div className="flex flex-col items-center gap-0.5">
          <ImageIcon className="size-5 opacity-60" />
          <span className="text-[10px]">Image</span>
        </div>
      )}
    </button>
  );
}

/**
 * The Menu Master item screen (grid Image 1 / form Image 2): one page that looks like it
 * manages everything about a dish, while each section persists to its own normalized table
 * behind the scenes — the food item record itself (name/description/category/unit) via the
 * form's own Save, and groups/counters/schedule/variants/catalogue overrides live-saved the
 * moment they're touched, the same incremental-save convention already used by VariantsSection
 * elsewhere in Menu Master. Everything below Basic Information is unlocked once the item has
 * an id, i.e. after the first Save for a brand-new item.
 */
export function MenuItemFormPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const formRef = useRef<HTMLFormElement>(null);
  const onKeyDownCapture = useEnterAdvance(formRef, SAVE_BUTTON_ID);

  const qc = useQueryClient();

  const { data: editingItem, isLoading: loadingItem } = useMenuItem(id);
  const create = useCreateMenuItem();
  const update = useUpdateMenuItem();
  const assignMedia = useAssignMedia();
  const [creatingImage, setCreatingImage] = useState(false);
  const submitting = create.isPending || update.isPending || creatingImage;

  const [name, setName] = useState(editingItem?.name ?? '');
  const [nameHi, setNameHi] = useState(editingItem?.nameHi ?? '');
  const [descriptionEn, setDescriptionEn] = useState('');
  const [descriptionHi, setDescriptionHi] = useState('');
  const [unit, setUnit] = useState(editingItem?.unit ?? '');
  /**
   * How long this dish takes, in minutes — one number with two consumers: it is saved on the
   * item as its KDS deadline, and it seeds the preparation time of any new portion added below.
   *
   * It used to be two fields. "Time for Prep" was never written anywhere — it only seeded new
   * variants — so a prep time typed into the Menu Master File was silently thrown away on save,
   * while a second box beside it labelled "KDS prep deadline" was the one that actually stored
   * anything. Nobody can be expected to know that.
   */
  const [prepMinutes, setPrepMinutes] = useState('15');
  const [categoryId, setCategoryId] = useState(editingItem?.categoryId ?? '');
  const [categoryLabel, setCategoryLabel] = useState(editingItem?.categoryName ?? '');
  const [groupId, setGroupId] = useState<string | null>(editingItem?.groupId ?? null);
  const [groupLabel, setGroupLabel] = useState(editingItem?.groupName ?? '');
  const [status, setStatus] = useState<MasterStatus>(editingItem?.status ?? MasterStatus.ACTIVE);
  const [taxProfileId, setTaxProfileId] = useState<string | null>(editingItem?.taxProfileId ?? null);
  const [autoTranslate, setAutoTranslate] = useState(true);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [imagePickerTargetId, setImagePickerTargetId] = useState<string | undefined>(undefined);

  // Hydrate once the item this route is editing loads.
  const [hydrated, setHydrated] = useState(!isEditing);
  if (isEditing && editingItem && !hydrated) {
    setName(editingItem.name);
    setNameHi(editingItem.nameHi ?? '');
    setDescriptionEn(editingItem.description ?? '');
    setDescriptionHi(editingItem.descriptionHi ?? '');
    setUnit(editingItem.unit);
    setCategoryId(editingItem.categoryId);
    setCategoryLabel(editingItem.categoryName ?? '');
    setGroupId(editingItem.groupId);
    setGroupLabel(editingItem.groupName ?? '');
    setStatus(editingItem.status);
    setTaxProfileId(editingItem.taxProfileId);
    setPrepMinutes(
      editingItem.prepSeconds === null || editingItem.prepSeconds === undefined
        ? ''
        : String(editingItem.prepSeconds / 60),
    );
    setHydrated(true);
  }

  // Open the media picker automatically when the user just created the item by clicking
  // the hero image area (we navigate here with ?image=1 to trigger the flow).
  useEffect(() => {
    if (searchParams.get('image') === '1' && id) {
      setImagePickerTargetId(id);
      setImagePickerOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [id, searchParams, setSearchParams]);

  const [categorySearch, setCategorySearch] = useState('');
  const { data: categoryOptions, isFetching: categoriesFetching } = useQuery({
    queryKey: ['menu-category-picker', categorySearch],
    queryFn: () => menuCategoriesApi.list({ search: categorySearch || undefined, page: 1, pageSize: 20 }),
  });

  const [groupSearch, setGroupSearch] = useState('');
  const { data: groupOptions, isFetching: groupsFetching } = useQuery({
    queryKey: ['item-group-picker', groupSearch],
    queryFn: () => itemGroupsApi.list({ search: groupSearch || undefined, page: 1, pageSize: 20 }),
  });

  async function translateField(source: string, apply: (v: string) => void): Promise<void> {
    if (!autoTranslate || !source.trim()) return;
    setTranslating(true);
    try {
      const { translated } = await ingredientsApi.translate(source);
      if (translated) apply(translated);
    } catch {
      // Best-effort only — the field stays blank/manual on failure.
    } finally {
      setTranslating(false);
    }
  }

  function buildBody(): MenuItemWriteRequest {
    const minutes = Number(prepMinutes);
    return {
      name,
      nameHi: nameHi || null,
      description: descriptionEn || null,
      descriptionHi: descriptionHi || null,
      categoryId,
      groupId,
      unit,
      unitHi: null,
      status,
      taxProfileId,
      prepSeconds:
        prepMinutes === '' || !Number.isFinite(minutes) || minutes <= 0
          ? null
          : Math.round(minutes * 60),
      sortOrder: editingItem?.sortOrder ?? 0,
    };
  }

  async function handleHeroImageClick(): Promise<void> {
    setError(null);
    if (isEditing && id) {
      setImagePickerTargetId(id);
      setImagePickerOpen(true);
      return;
    }
    if (!name.trim()) {
      setError('Item name is required before adding an image.');
      return;
    }
    if (!categoryId) {
      setError('Choose a category first.');
      return;
    }
    if (!unit.trim()) {
      setError('Unit is required before adding an image.');
      return;
    }

    setCreatingImage(true);
    try {
      const created = await create.mutateAsync(buildBody());
      notify.success('Item created — choose a default image.');
      navigate(`/menu-items/${created.id}/edit?image=1`, { replace: true });
    } catch (err) {
      setError(readError(err).message);
    } finally {
      setCreatingImage(false);
    }
  }

  async function handleMediaSelected(media: MediaAssetDto): Promise<void> {
    const targetId = imagePickerTargetId ?? id;
    if (!targetId) return;
    try {
      await assignMedia.mutateAsync({
        mediaId: media.id,
        entityType: MediaEntityType.MENU_ITEM,
        entityId: targetId,
        role: MediaRole.PRIMARY,
        isPrimary: true,
      });
      notify.success('Default image set.');
      void qc.invalidateQueries({ queryKey: ['media-assignments', MediaEntityType.MENU_ITEM, targetId] });
      void qc.invalidateQueries({ queryKey: ['menu-items'] });
      void qc.invalidateQueries({ queryKey: ['menu-item', targetId] });
    } catch (err) {
      notify.fromError(err);
    } finally {
      setImagePickerOpen(false);
      setImagePickerTargetId(undefined);
    }
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!categoryId) {
      setError('Choose a category first.');
      return;
    }
    if (!unit.trim()) {
      setError('Unit is required (e.g. plate, kg, litre).');
      return;
    }
    try {
      if (isEditing && id) {
        await update.mutateAsync({ id, body: buildBody() });
        notify.success('Item updated.');
      } else {
        const created = await create.mutateAsync(buildBody());
        notify.success('Item created — now add its schedule, groups, counters and pricing.');
        navigate(`/menu-items/${created.id}/edit`, { replace: true });
        return;
      }
    } catch (err) {
      setError(readError(err).message);
    }
  }

  const foodItemId = isEditing ? id : undefined;

  return (
    <>
      <div className="mb-3 flex items-center gap-3 border-b pb-3 text-sm">
        <BackButton to="/menu-items" label="Back to Master Menu" />
        <Badge variant={isEditing ? 'secondary' : 'outline'}>{isEditing ? status : 'Draft'}</Badge>
        <div className="ml-auto flex items-center gap-3">
          <MenuItemHeroImage
            foodItemId={foodItemId}
            onClick={handleHeroImageClick}
            disabled={creatingImage}
          />
          <SwitchField
            id="auto-translate"
            label="Auto-translate to Hindi"
            checked={autoTranslate}
            onCheckedChange={setAutoTranslate}
          />
          <RecipePickerButton menuItemId={foodItemId ?? null} />
        </div>
      </div>
      <h1 className="font-heading mb-4 text-2xl font-bold">
        {isEditing ? editingItem?.name ?? '' : 'New menu item'}
      </h1>

      {isEditing && loadingItem && !hydrated ? (
        <PageSkeleton />
      ) : (
        <form
          ref={formRef}
          onSubmit={onSubmit}
          onKeyDownCapture={onKeyDownCapture}
          className="flex flex-col gap-6 pb-24"
        >
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <section className="bg-card rounded-xl border p-4">
            <h2 className="font-heading mb-4 text-base font-semibold">Basic Information</h2>
            <FieldGroup>
              <FieldRow>
                <TextField
                  label="Item Name (English)"
                  autoFocus
                  required
                  placeholder="e.g. Paneer Tikka Masala"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => translateField(name, setNameHi)}
                  maxLength={LIMITS.MENU_ITEM_NAME_MAX}
                />
                <TextField
                  label="Item Name (Hindi)"
                  placeholder="जैसे: पनीर टिक्का मसाला"
                  value={nameHi}
                  onChange={(e) => setNameHi(e.target.value)}
                  maxLength={LIMITS.MENU_ITEM_NAME_MAX}
                  disabled={translating}
                />
              </FieldRow>

              <FieldRow>
                <TextField
                  label="Item Description (English)"
                  multiline
                  rows={2}
                  placeholder="Describe the dish, ingredients, and taste profile…"
                  value={descriptionEn}
                  onChange={(e) => setDescriptionEn(e.target.value)}
                  onBlur={() => translateField(descriptionEn, setDescriptionHi)}
                />
                <TextField
                  label="Item Description (Hindi)"
                  multiline
                  rows={2}
                  placeholder="व्यंजन, सामग्री और स्वाद के बारे में बताएं…"
                  value={descriptionHi}
                  onChange={(e) => setDescriptionHi(e.target.value)}
                  disabled={translating}
                />
              </FieldRow>

              <FieldRow>
                <SearchPickerField
                  id="menu-item-category"
                  label="Primary Category"
                  required
                  value={categoryId || null}
                  displayValue={categoryLabel}
                  options={(categoryOptions?.items ?? []).map((c) => ({ id: c.id, label: c.name }))}
                  loading={categoriesFetching}
                  onSearchChange={setCategorySearch}
                  onSelect={(opt) => {
                    setCategoryId(opt.id);
                    setCategoryLabel(opt.label);
                  }}
                />
                <SearchPickerField
                  id="menu-item-group"
                  label="Item Group"
                  value={groupId}
                  displayValue={groupLabel}
                  options={(groupOptions?.items ?? []).map((g) => ({ id: g.id, label: g.name }))}
                  loading={groupsFetching}
                  onSearchChange={setGroupSearch}
                  onSelect={(opt) => {
                    setGroupId(opt.id);
                    setGroupLabel(opt.label);
                  }}
                  onClear={() => {
                    setGroupId(null);
                    setGroupLabel('');
                  }}
                />
              </FieldRow>

              <FieldRow className="sm:grid-cols-2">
                <TextField
                  label="Unit"
                  required
                  placeholder="plate, kg, litre"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  maxLength={LIMITS.UNIT_MAX}
                />
                <NumberField
                  label="Time for Prep (mins)"
                  helperText="The line's deadline on the kitchen board, and the default for new portions. Blank uses the station default."
                  value={prepMinutes}
                  onChange={(e) => setPrepMinutes(e.target.value)}
                />
              </FieldRow>

              {isEditing && (
                <SelectField
                  label="Status"
                  value={status}
                  onChange={(v) => setStatus(v as MasterStatus)}
                  options={enumOptions(MasterStatus)}
                  className="sm:max-w-xs"
                />
              )}
            </FieldGroup>
          </section>

          <TaxComplianceSection taxProfileId={taxProfileId} onChange={setTaxProfileId} />

          <ItemImagesSection foodItemId={foodItemId} />

          <TagsAndAssignmentsSection foodItemId={foodItemId} />

          <TimingAvailabilitySection foodItemId={foodItemId} />

          <PricingVariantsSection
            foodItemId={foodItemId}
            prepDefaultMinutes={prepMinutes}
            itemTaxProfileId={taxProfileId}
          />

          <div className="bg-background/95 fixed inset-x-0 bottom-0 z-10 flex justify-end gap-2 border-t p-3 backdrop-blur">
            <Button type="button" variant="outline" onClick={() => navigate('/menu-items')}>
              Cancel
            </Button>
            <Button id={SAVE_BUTTON_ID} type="submit" disabled={submitting}>
              {submitting && <Spinner data-icon="inline-start" />}
              Save Item
            </Button>
          </div>
        </form>
      )}

      <MediaPicker
        open={imagePickerOpen}
        onClose={() => {
          setImagePickerOpen(false);
          setImagePickerTargetId(undefined);
        }}
        onSelect={handleMediaSelected}
      />
    </>
  );
}

/* ------------------------------------------------------------------------- images */

/**
 * Photography attached to the food item itself, so it follows the dish onto every menu that
 * offers it — a per-menu assignment or a variant may still override it with its own picture.
 * The primary image is what the list thumbnails, the detail screen and the device show.
 */
function ItemImagesSection({ foodItemId }: { foodItemId: string | undefined }): JSX.Element {
  const qc = useQueryClient();
  return (
    <section className="bg-card rounded-xl border p-4">
      <h2 className="font-heading mb-4 text-base font-semibold">Images</h2>
      {!foodItemId ? (
        <p className="text-muted-foreground text-sm">Save the item first to attach images.</p>
      ) : (
        <>
          <MediaStrip
            entityType={MediaEntityType.MENU_ITEM}
            entityId={foodItemId}
            onChanged={() => {
              void qc.invalidateQueries({ queryKey: ['menu-items'] });
              void qc.invalidateQueries({ queryKey: ['menu-item', foodItemId] });
            }}
          />
          <p className="text-muted-foreground mt-2 text-xs">
            The primary image is used for the item everywhere it appears.
          </p>
        </>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- tags & assignments */

function TagsAndAssignmentsSection({ foodItemId }: { foodItemId: string | undefined }): JSX.Element {
  const { data: counterOptions } = useCounters({ page: 1, pageSize: 100 });
  const { data: counterAssignments } = useCounterRoutesForEntity('MENU_ITEM', foodItemId ?? '');
  const assignCounter = useAssignCounterRoute();
  const removeCounter = useRemoveCounterRoute();

  const { data: kitchenGroupOptions } = usePrintingGroups({ page: 1, pageSize: 100 });
  const { data: kitchenGroupAssignments } = usePrintingRoutesForEntity('MENU_ITEM', foodItemId ?? '');
  const assignKitchenGroup = useAssignPrintingRoute();
  const removeKitchenGroup = useRemovePrintingRoute();

  const selectedCounterIds = useMemo(
    () => new Set((counterAssignments ?? []).map((a) => a.counterId)),
    [counterAssignments],
  );
  const selectedKitchenGroupIds = useMemo(
    () => new Set((kitchenGroupAssignments ?? []).map((a) => a.printingGroupId)),
    [kitchenGroupAssignments],
  );

  async function toggleCounter(counterId: string): Promise<void> {
    if (!foodItemId) return;
    try {
      if (selectedCounterIds.has(counterId)) {
        const existing = (counterAssignments ?? []).find((a) => a.counterId === counterId);
        if (existing) await removeCounter.mutateAsync({ id: existing.id, entityType: 'MENU_ITEM', entityId: foodItemId });
      } else {
        await assignCounter.mutateAsync({ entityType: 'MENU_ITEM', entityId: foodItemId, counterId });
      }
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function toggleKitchenGroup(printingGroupId: string): Promise<void> {
    if (!foodItemId) return;
    try {
      if (selectedKitchenGroupIds.has(printingGroupId)) {
        const existing = (kitchenGroupAssignments ?? []).find((a) => a.printingGroupId === printingGroupId);
        if (existing)
          await removeKitchenGroup.mutateAsync({ id: existing.id, entityType: 'MENU_ITEM', entityId: foodItemId });
      } else {
        await assignKitchenGroup.mutateAsync({ entityType: 'MENU_ITEM', entityId: foodItemId, printingGroupId });
      }
    } catch (err) {
      notify.fromError(err);
    }
  }

  return (
    <section className="bg-card rounded-xl border p-4">
      <h2 className="font-heading mb-4 text-base font-semibold">Tags & Assignments</h2>
      {!foodItemId ? (
        <p className="text-muted-foreground text-sm">Save the item first to assign counters and kitchen groups.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-sm font-medium">Service Counters</p>
            <div className="flex flex-wrap gap-2">
              {(counterOptions?.items ?? []).map((c) => (
                <ToggleBadge key={c.id} active={selectedCounterIds.has(c.id)} onClick={() => toggleCounter(c.id)}>
                  {c.name}
                </ToggleBadge>
              ))}
              {(counterOptions?.items ?? []).length === 0 && (
                <p className="text-muted-foreground text-sm">
                  No service counters yet — <Link to="/counters">add some here</Link>.
                </p>
              )}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Kitchen Groups</p>
            <div className="flex flex-wrap gap-2">
              {(kitchenGroupOptions?.items ?? []).map((g) => (
                <ToggleBadge
                  key={g.id}
                  active={selectedKitchenGroupIds.has(g.id)}
                  onClick={() => toggleKitchenGroup(g.id)}
                >
                  {g.name}
                </ToggleBadge>
              ))}
              {(kitchenGroupOptions?.items ?? []).length === 0 && (
                <p className="text-muted-foreground text-sm">
                  No kitchen groups yet — <Link to="/printing-groups">add some here</Link>.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ToggleBadge({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'focus-ring rounded-full border px-3 py-1 text-sm transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary font-medium'
          : 'border-border text-muted-foreground hover:bg-muted',
      )}
    >
      {active && '✓ '}
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- timing & availability */

function TimingAvailabilitySection({ foodItemId }: { foodItemId: string | undefined }): JSX.Element {
  const { data: schedule } = useMenuItemSchedule(foodItemId ?? '');
  const setSchedule = useSetMenuItemSchedule(foodItemId ?? '');

  const [alwaysAvailable, setAlwaysAvailable] = useState(true);
  const [slots, setSlots] = useState<Record<string, boolean>>(allSlotsAvailable());

  useEffect(() => {
    if (!schedule) return;
    setAlwaysAvailable(schedule.alwaysAvailable);
    const next = allSlotsAvailable();
    for (const s of schedule.slots) next[slotKey(s.dayOfWeek, s.shift)] = s.isAvailable;
    setSlots(next);
  }, [schedule]);

  async function persist(nextAlwaysAvailable: boolean, nextSlots: Record<string, boolean>): Promise<void> {
    if (!foodItemId) return;
    try {
      await setSchedule.mutateAsync({
        alwaysAvailable: nextAlwaysAvailable,
        slots: DAYS.flatMap((d) =>
          SHIFTS.map((s) => ({ dayOfWeek: d.key, shift: s.key, isAvailable: nextSlots[slotKey(d.key, s.key)] ?? true })),
        ),
      });
    } catch (err) {
      notify.fromError(err);
    }
  }

  function toggleAlways(next: boolean): void {
    if (setSchedule.isPending) return;
    setAlwaysAvailable(next);
    void persist(next, slots);
  }

  function toggleSlot(day: number, shift: ScheduleShift): void {
    if (setSchedule.isPending) return;
    const key = slotKey(day, shift);
    const next = { ...slots, [key]: !slots[key] };
    setSlots(next);
    void persist(alwaysAvailable, next);
  }

  return (
    <section className="bg-card rounded-xl border p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-heading text-base font-semibold">Timing & Availability</h2>
        <SwitchField
          id="always-available"
          label="Always Available"
          checked={alwaysAvailable}
          onCheckedChange={toggleAlways}
          disabled={!foodItemId || setSchedule.isPending}
        />
      </div>
      {!foodItemId ? (
        <p className="text-muted-foreground text-sm">Save the item first to set its weekly schedule.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-muted-foreground text-xs">
                <th className="w-20 pb-2 text-left font-normal">Shift</th>
                {DAYS.map((d) => (
                  <th key={d.key} className="pb-2 text-center font-normal">
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SHIFTS.map((s) => (
                <tr key={s.key}>
                  <td className="text-muted-foreground py-1.5">{s.label}</td>
                  {DAYS.map((d) => (
                    <td key={d.key} className="py-1.5">
                      {/* The portal's checkbox, so this grid matches every other checkbox in
                          the app rather than rendering the OS control. */}
                      <div className="flex justify-center">
                        <Checkbox
                          aria-label={`${s.label} on ${d.label}`}
                          checked={alwaysAvailable ? true : (slots[slotKey(d.key, s.key)] ?? true)}
                          disabled={alwaysAvailable || setSchedule.isPending}
                          onCheckedChange={() => toggleSlot(d.key, s.key)}
                        />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- pricing & variants */

interface VariantDraft {
  id: string;
  portionName: string;
  price: string;
}

function PricingVariantsSection({
  foodItemId,
  prepDefaultMinutes,
  itemTaxProfileId,
}: {
  foodItemId: string | undefined;
  prepDefaultMinutes: string;
  /** The food item's profile — what a variant inherits while it has no override of its own. */
  itemTaxProfileId: string | null;
}): JSX.Element {
  const { data: variants } = useMenuItemVariants(foodItemId ?? '', true);
  const create = useCreateVariant(foodItemId ?? '');
  const update = useUpdateVariant(foodItemId ?? '');
  const del = useDeleteVariant(foodItemId ?? '');
  const { data: catalogs } = useQuery({
    queryKey: ['catalogs-picker'],
    queryFn: () => menusApi.list({ page: 1, pageSize: 50 }),
  });

  async function addVariant(): Promise<void> {
    try {
      await create.mutateAsync({
        name: 'New portion',
        portionName: 'Regular',
        price: 0,
        preparationTimeMinutes: prepDefaultMinutes === '' ? null : Number(prepDefaultMinutes),
      });
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function saveVariant(draft: VariantDraft): Promise<void> {
    const price = Number(draft.price);
    if (Number.isNaN(price)) {
      notify.error('Enter a valid price.');
      return;
    }
    try {
      await update.mutateAsync({
        id: draft.id,
        body: { name: draft.portionName || 'Portion', portionName: draft.portionName || null, price },
      });
    } catch (err) {
      notify.fromError(err);
    }
  }

  return (
    <section className="bg-card rounded-xl border p-4">
      <h2 className="font-heading mb-4 text-base font-semibold">Pricing & Variants</h2>
      {!foodItemId ? (
        <p className="text-muted-foreground text-sm">Save the item first to add its portions and pricing.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {(variants ?? []).map((variant) => (
            <VariantRow
              key={variant.id}
              variant={variant}
              catalogs={catalogs?.items ?? []}
              itemTaxProfileId={itemTaxProfileId}
              onSave={saveVariant}
              onSaveTaxProfile={(taxProfileId) =>
                update
                  .mutateAsync({ id: variant.id, body: { taxProfileId } })
                  .catch((err) => notify.fromError(err))
              }
              onDelete={() =>
                del.mutateAsync(variant.id).catch((err) => notify.fromError(err))
              }
            />
          ))}
          {(variants ?? []).length === 0 && (
            <p className="text-muted-foreground text-sm">
              No portions yet — add one to start selling this item.
            </p>
          )}
          <Button type="button" variant="outline" onClick={addVariant} className="self-start">
            <PlusIcon data-icon="inline-start" />
            Add Another Variant
          </Button>
        </div>
      )}
    </section>
  );
}

function VariantRow({
  variant,
  catalogs,
  itemTaxProfileId,
  onSave,
  onSaveTaxProfile,
  onDelete,
}: {
  variant: import('@menuboard/shared').MenuItemVariantDto;
  catalogs: import('@menuboard/shared').MenuDto[];
  itemTaxProfileId: string | null;
  onSave: (draft: VariantDraft) => Promise<void>;
  onSaveTaxProfile: (taxProfileId: string | null) => void;
  onDelete: () => void;
}): JSX.Element {
  const [portionName, setPortionName] = useState(variant.portionName ?? variant.name);
  const [price, setPrice] = useState(String(variant.price));
  const { data: overrides } = useVariantCatalogPrices(variant.id);
  const setOverride = useSetVariantCatalogPrice(variant.id);
  const [overrideDrafts, setOverrideDrafts] = useState<Record<string, string>>({});

  const overrideByMenu = useMemo(
    () => new Map((overrides ?? []).map((o) => [o.menuId, o])),
    [overrides],
  );

  async function toggleOverride(menuId: string, enabled: boolean): Promise<void> {
    try {
      if (enabled) {
        await setOverride.mutateAsync({ menuId, price: Number(price) || 0 });
      } else {
        await setOverride.mutateAsync({ menuId, price: null });
      }
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function commitOverridePrice(menuId: string): Promise<void> {
    const raw = overrideDrafts[menuId];
    if (raw === undefined) return;
    const value = Number(raw);
    if (Number.isNaN(value)) return;
    try {
      await setOverride.mutateAsync({ menuId, price: value });
    } catch (err) {
      notify.fromError(err);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
      <div className="shrink-0">
        <MediaStrip entityType="MENU_ITEM_VARIANT" entityId={variant.id} size="sm" />
      </div>
      <TextField
        label="Portion Name"
        value={portionName}
        onChange={(e) => setPortionName(e.target.value)}
        onBlur={() => onSave({ id: variant.id, portionName, price })}
        className="w-32"
      />
      <NumberField
        label="Base Price"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        onBlur={() => onSave({ id: variant.id, portionName, price })}
        className="w-24"
      />
      <VariantTaxOverride
        variantTaxProfileId={variant.taxProfileId}
        itemTaxProfileId={itemTaxProfileId}
        onChange={onSaveTaxProfile}
      />

      {catalogs.map((catalog) => {
        const override = overrideByMenu.get(catalog.id);
        const enabled = Boolean(override);
        const draftValue = overrideDrafts[catalog.id] ?? (override ? String(override.price) : price);
        return (
          <div key={catalog.id} className="flex items-center gap-1.5 rounded-md border px-1.5 py-1">
            <Switch
              id={`override-${variant.id}-${catalog.id}`}
              checked={enabled}
              onCheckedChange={(next) => toggleOverride(catalog.id, next)}
            />
            <label
              htmlFor={`override-${variant.id}-${catalog.id}`}
              className="cursor-pointer text-xs whitespace-nowrap"
            >
              {catalog.name}
            </label>
            <NumberField
              aria-label={`${catalog.name} price override`}
              disabled={!enabled}
              value={draftValue}
              onChange={(e) => setOverrideDrafts((prev) => ({ ...prev, [catalog.id]: e.target.value }))}
              onBlur={() => commitOverridePrice(catalog.id)}
              className="w-16"
            />
          </div>
        );
      })}

      <Button
        variant="ghost"
        size="icon-sm"
        className="ml-auto"
        onClick={onDelete}
        aria-label={`Remove ${portionName}`}
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}
