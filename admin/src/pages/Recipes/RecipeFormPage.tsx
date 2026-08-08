import { useEffect, useMemo, useState } from 'react';
import {
  LIMITS,
  MasterStatus,
  RecipeDifficulty,
  RecipeIngredientScaling,
  isLikelyTypoOf,
  normalizeNameKey,
  type RecipeWriteRequest,
} from '@menuboard/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2Icon,
  CircleFadingPlusIcon,
  GripVerticalIcon,
  LanguagesIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
} from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  CheckboxField,
  FieldGroup,
  FieldRow,
  NumberField,
  SelectField,
  TextField,
} from '@/components/form/fields';
import { BackButton } from '../../components/BackButton';
import { PageHeader } from '../../components/ui/PageHeader';
import { PageSkeleton } from '../../components/ui/Skeletons';
import { SearchPickerField, type PickerOption } from '../../components/SearchPickerField';
import { menuItemsApi } from '../../api/masters';
import { ingredientsApi } from '../../api/ingredients';
import { recipesApi, type ParsedRecipe } from '../../api/recipes';
import { youtubeImportsApi } from '../../api/youtubeImports';
import { useRecipe, useRecipeVariants, useUpsertRecipe } from '../../hooks/useRecipes';
import { useYoutubeImport } from '../../hooks/useYoutubeImports';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { TONE_BORDER_CLASS, TONE_TEXT_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { RecipeImportDialog } from './RecipeImportDialog';

interface IngredientRowState {
  key: string;
  id?: string;
  ingredientId: string;
  ingredientLabel: string;
  ingredientSublabel: string;
  quantity: number;
  unit: string;
  scaling: RecipeIngredientScaling;
  notes: string;
  /**
   * Set (and `ingredientId` left empty) when this row came from an AI/YouTube extraction
   * that named an ingredient not yet in the Ingredient Master. Saving the recipe creates —
   * or, if the name has since appeared, links to — that Ingredient Master record
   * automatically, so a menu item's recipe can never point at a non-existent ingredient.
   */
  pendingCreateName: string;
}

interface StepRowState {
  key: string;
  id?: string;
  textEn: string;
  textHi: string;
  durationMin: string;
}

interface BaseFormState {
  menuItemId: string;
  menuItemLabel: string;
  basePax: number;
  isDefault: boolean;
  prepTimeMin: string;
  cookTimeMin: string;
  teamSize: string;
  difficulty: RecipeDifficulty | '';
  descriptionEn: string;
  descriptionHi: string;
  methodEn: string;
  methodHi: string;
  yieldNote: string;
  chefNotes: string;
  status: MasterStatus;
}

function newKey(): string {
  return crypto.randomUUID();
}

function newIngredientRow(): IngredientRowState {
  return {
    key: newKey(),
    ingredientId: '',
    ingredientLabel: '',
    ingredientSublabel: '',
    quantity: 0,
    unit: '',
    scaling: RecipeIngredientScaling.LINEAR,
    notes: '',
    pendingCreateName: '',
  };
}

/** matched (green, has an Ingredient Master id) / pending (amber, will be auto-created) / unset. */
function ingredientRowStatus(row: IngredientRowState): 'matched' | 'pending' | 'unset' {
  if (row.ingredientId) return 'matched';
  if (row.pendingCreateName.trim()) return 'pending';
  return 'unset';
}

function newStepRow(): StepRowState {
  return { key: newKey(), textEn: '', textHi: '', durationMin: '' };
}

function toNullableInt(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * The recipe builder — base fields, a repeatable ingredients table and an ordered steps
 * list, plus an "Import from text" assist. Built as a dedicated route rather than the shared
 * Modal (docs/AGENTS.md Modal Standard covers small record forms; nothing in the portal's
 * existing Boards/Billing forms is this large, so a full page — not a cramped fixed-size
 * dialog — is the better fit here).
 */
export function RecipeFormPage(): JSX.Element {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const prefillMenuItemId = params.get('menuItemId') ?? '';
  // Review flow of the YouTube Recipe Downloader: the extracted recipe prefills this form,
  // the user edits/maps ingredients, and only "Save recipe" writes to the Recipe Master.
  const youtubeImportId = params.get('youtubeImportId') ?? '';
  const isEditing = Boolean(id);

  const { data: editingRecipe, isLoading: loadingRecipe } = useRecipe(id);
  const { data: youtubeImport } = useYoutubeImport(youtubeImportId || undefined);
  const [youtubeApplied, setYoutubeApplied] = useState(false);
  const qc = useQueryClient();
  const upsert = useUpsertRecipe();

  const [base, setBase] = useState<BaseFormState>({
    menuItemId: prefillMenuItemId,
    menuItemLabel: '',
    basePax: 100,
    isDefault: true,
    prepTimeMin: '',
    cookTimeMin: '',
    teamSize: '',
    difficulty: '',
    descriptionEn: '',
    descriptionHi: '',
    methodEn: '',
    methodHi: '',
    yieldNote: '',
    chefNotes: '',
    status: MasterStatus.ACTIVE,
  });
  const [ingredients, setIngredients] = useState<IngredientRowState[]>([newIngredientRow()]);
  const [steps, setSteps] = useState<StepRowState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [resolvingIngredients, setResolvingIngredients] = useState(false);
  const [hydrated, setHydrated] = useState(!isEditing);

  const [menuItemSearch, setMenuItemSearch] = useState('');
  const { data: menuItemOptions, isFetching: menuItemsFetching } = useQuery({
    queryKey: ['menu-item-picker', menuItemSearch],
    queryFn: () => menuItemsApi.list({ search: menuItemSearch || undefined, page: 1, pageSize: 20 }),
  });

  // Resolve the initial menu item's label (arrived via drill-down or when editing) once.
  const { data: resolvedMenuItem } = useQuery({
    queryKey: ['menu-item-single', base.menuItemId],
    queryFn: () => menuItemsApi.list({ page: 1, pageSize: 200 }),
    enabled: Boolean(base.menuItemId) && !base.menuItemLabel,
  });
  useEffect(() => {
    if (!resolvedMenuItem || base.menuItemLabel) return;
    const match = resolvedMenuItem.items.find((m) => m.id === base.menuItemId);
    if (match) setBase((prev) => ({ ...prev, menuItemLabel: match.name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedMenuItem, base.menuItemId]);

  const { data: variants } = useRecipeVariants(base.menuItemId || undefined);
  const otherVariantsCount = (variants ?? []).filter((v) => v.id !== id).length;
  const forceDefault = otherVariantsCount === 0;

  useEffect(() => {
    if (forceDefault) setBase((prev) => (prev.isDefault ? prev : { ...prev, isDefault: true }));
  }, [forceDefault]);

  // Hydrate the form once the editing recipe loads.
  useEffect(() => {
    if (!isEditing || !editingRecipe || hydrated) return;
    setBase({
      menuItemId: editingRecipe.menuItemId,
      menuItemLabel: editingRecipe.menuItemName ?? '',
      basePax: editingRecipe.basePax,
      isDefault: editingRecipe.isDefault,
      prepTimeMin: editingRecipe.prepTimeMin?.toString() ?? '',
      cookTimeMin: editingRecipe.cookTimeMin?.toString() ?? '',
      teamSize: editingRecipe.teamSize?.toString() ?? '',
      difficulty: editingRecipe.difficulty ?? '',
      descriptionEn: editingRecipe.descriptionEn ?? '',
      descriptionHi: editingRecipe.descriptionHi ?? '',
      methodEn: editingRecipe.methodEn ?? '',
      methodHi: editingRecipe.methodHi ?? '',
      yieldNote: editingRecipe.yieldNote ?? '',
      chefNotes: editingRecipe.chefNotes ?? '',
      status: editingRecipe.status,
    });
    setIngredients(
      editingRecipe.ingredients.length
        ? [...editingRecipe.ingredients]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((ing) => ({
            key: newKey(),
            id: ing.id,
            ingredientId: ing.ingredientId,
            ingredientLabel: ing.ingredientName ?? '',
            ingredientSublabel: ing.unit,
            quantity: ing.quantity,
            unit: ing.unit,
            scaling: ing.scaling,
            notes: ing.notes ?? '',
            pendingCreateName: '',
          }))
        : [newIngredientRow()],
    );
    setSteps(
      [...editingRecipe.steps]
        .sort((a, b) => a.stepNo - b.stepNo)
        .map((step) => ({
          key: newKey(),
          id: step.id,
          textEn: step.textEn,
          textHi: step.textHi ?? '',
          durationMin: step.durationMin?.toString() ?? '',
        })),
    );
    setHydrated(true);
  }, [isEditing, editingRecipe, hydrated]);

  // Prefill once from a READY YouTube import. Everything stays editable; unmatched
  // ingredients keep the video's wording in their notes so the user can map or create the
  // proper Ingredient Master record before saving.
  useEffect(() => {
    if (isEditing || youtubeApplied || !youtubeImport?.extractedRecipe) return;
    const extracted = youtubeImport.extractedRecipe;
    const extras = [
      extracted.category ? `Category: ${extracted.category}` : null,
      extracted.cuisine ? `Cuisine: ${extracted.cuisine}` : null,
      extracted.totalTimeMin !== null ? `Total time: ${extracted.totalTimeMin} min` : null,
      extracted.equipment.length ? `Equipment: ${extracted.equipment.join(', ')}` : null,
      extracted.garnish ? `Garnish: ${extracted.garnish}` : null,
      extracted.tips.length ? `Tips: ${extracted.tips.join(' | ')}` : null,
      extracted.notes,
      extracted.variations.length ? `Variations: ${extracted.variations.join(' | ')}` : null,
      extracted.storageInstructions ? `Storage: ${extracted.storageInstructions}` : null,
      extracted.shelfLife ? `Shelf life: ${extracted.shelfLife}` : null,
      extracted.dietaryInfo.length ? `Dietary: ${extracted.dietaryInfo.join(', ')}` : null,
      extracted.allergens.length ? `Allergens: ${extracted.allergens.join(', ')}` : null,
    ].filter((line): line is string => Boolean(line));
    setBase((prev) => ({
      ...prev,
      basePax: extracted.servings || prev.basePax,
      prepTimeMin: extracted.prepTimeMin !== null ? String(extracted.prepTimeMin) : prev.prepTimeMin,
      cookTimeMin: extracted.cookTimeMin !== null ? String(extracted.cookTimeMin) : prev.cookTimeMin,
      difficulty: extracted.difficulty ?? prev.difficulty,
      descriptionEn: (extracted.description ?? extracted.recipeName).slice(0, LIMITS.RECIPE_DESCRIPTION_MAX),
      methodEn: extracted.steps.map((s) => s.instruction).join('\n\n'),
      yieldNote: extracted.yieldNote ?? prev.yieldNote,
      chefNotes: extras.join('\n').slice(0, LIMITS.RECIPE_CHEF_NOTES_MAX),
    }));
    if (extracted.ingredients.length) {
      setIngredients(
        extracted.ingredients.map((ing) => ({
          key: newKey(),
          ingredientId: ing.ingredientId ?? '',
          ingredientLabel: ing.name,
          ingredientSublabel: ing.unit ?? '',
          quantity: ing.quantity ?? 0,
          unit: ing.unit ?? '',
          // No numeric quantity ("to taste", "as required") means the amount does not grow
          // with the serving count — keep it FIXED rather than inventing a scalable number.
          scaling: ing.quantity === null ? RecipeIngredientScaling.FIXED : RecipeIngredientScaling.LINEAR,
          notes: [ing.quantityText, ing.preparation, ing.notes].filter(Boolean).join(' · '),
          // Unmatched names are added to the Ingredient Master automatically on save — the
          // menu can never end up pointing at a missing ingredient.
          pendingCreateName: ing.ingredientId ? '' : ing.name,
        })),
      );
    }
    if (extracted.steps.length) {
      setSteps(
        extracted.steps.map((step) => ({
          key: newKey(),
          textEn: [
            step.instruction,
            step.temperature ? `(${step.temperature})` : null,
            step.cookingMethod ? `[${step.cookingMethod}]` : null,
          ]
            .filter(Boolean)
            .join(' '),
          textHi: '',
          durationMin: step.durationMin !== null ? String(step.durationMin) : '',
        })),
      );
    }
    setYoutubeApplied(true);
    notify.info(
      `Extracted from "${youtubeImport.videoTitle ?? 'YouTube video'}" — review ingredients, quantities and the Ingredient Master mapping, then save.`,
    );
  }, [isEditing, youtubeApplied, youtubeImport]);

  const submitting = upsert.isPending || resolvingIngredients;

  function updateIngredient(key: string, patch: Partial<IngredientRowState>): void {
    setIngredients((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeIngredient(key: string): void {
    setIngredients((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows));
  }

  function reorderIngredients(from: number, to: number): void {
    setIngredients((rows) => {
      const next = [...rows];
      const [moved] = next.splice(from, 1);
      if (!moved) return rows;
      next.splice(to, 0, moved);
      return next;
    });
  }

  function updateStep(key: string, patch: Partial<StepRowState>): void {
    setSteps((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeStep(key: string): void {
    setSteps((rows) => rows.filter((r) => r.key !== key));
  }

  function reorderSteps(from: number, to: number): void {
    setSteps((rows) => {
      const next = [...rows];
      const [moved] = next.splice(from, 1);
      if (!moved) return rows;
      next.splice(to, 0, moved);
      return next;
    });
  }

  function applyImportedDraft(draft: ParsedRecipe): void {
    setBase((prev) => ({
      ...prev,
      basePax: draft.basePax || prev.basePax,
      prepTimeMin: draft.prepTimeMin !== undefined ? String(draft.prepTimeMin) : prev.prepTimeMin,
      cookTimeMin: draft.cookTimeMin !== undefined ? String(draft.cookTimeMin) : prev.cookTimeMin,
      difficulty: draft.difficulty ?? prev.difficulty,
      descriptionEn: draft.descriptionEn || prev.descriptionEn,
      methodEn: draft.methodEn || prev.methodEn,
      yieldNote: draft.yieldNote || prev.yieldNote,
    }));
    if (draft.ingredients.length) {
      setIngredients(
        draft.ingredients.map((ing) => ({
          key: newKey(),
          ingredientId: ing.ingredientId ?? '',
          ingredientLabel: ing.name,
          ingredientSublabel: ing.unit ?? '',
          quantity: Number(ing.qtyForBasePax) || 0,
          unit: ing.unit ?? '',
          scaling: ing.scaling ?? RecipeIngredientScaling.LINEAR,
          notes: ing.name + (ing.notes ? ` (${ing.notes})` : ''),
          // Unmatched names are added to the Ingredient Master automatically on save.
          pendingCreateName: ing.ingredientId ? '' : ing.name,
        })),
      );
    }
    if (draft.steps.length) {
      setSteps(
        draft.steps.map((step) => ({
          key: newKey(),
          textEn: step.textEn,
          textHi: '',
          durationMin: step.durationMin !== undefined ? String(step.durationMin) : '',
        })),
      );
    }
    notify.info('Draft applied — review ingredients, steps and quantities before saving.');
  }

  /**
   * Fills every empty Hindi field from its English counterpart in one call. Fields that
   * already carry Hindi are left alone — a machine draft must never overwrite text a person
   * wrote.
   */
  async function translateAllToHindi(): Promise<void> {
    const targets: { source: string; apply: (translated: string) => void }[] = [];

    if (base.descriptionEn.trim() && !base.descriptionHi.trim()) {
      targets.push({
        source: base.descriptionEn,
        apply: (t) => setBase((prev) => ({ ...prev, descriptionHi: t })),
      });
    }
    if (base.methodEn.trim() && !base.methodHi.trim()) {
      targets.push({
        source: base.methodEn,
        apply: (t) => setBase((prev) => ({ ...prev, methodHi: t })),
      });
    }
    for (const step of steps) {
      if (step.textEn.trim() && !step.textHi.trim()) {
        targets.push({
          source: step.textEn,
          apply: (t) => updateStep(step.key, { textHi: t }),
        });
      }
    }

    if (targets.length === 0) {
      notify.info('Nothing to translate — every Hindi field is already filled.');
      return;
    }

    setTranslating(true);
    try {
      const { translated } = await recipesApi.translateBatch(targets.map((t) => t.source));
      targets.forEach((target, index) => {
        const value = translated[index];
        if (value) target.apply(value);
      });
      notify.success(
        `Translated ${targets.length} field${targets.length === 1 ? '' : 's'} — review before saving.`,
      );
    } catch (err) {
      notify.fromError(err);
    } finally {
      setTranslating(false);
    }
  }

  /**
   * Auto-adds to the Ingredient Master instead of blocking the save: any row that has a
   * name (typed by AI extraction) but no `ingredientId` is matched against the master by
   * exact name, or created if it truly does not exist yet, so a recipe can never be saved
   * pointing at a missing ingredient. Returns the resolved rows, or null on failure (with
   * `error` already set).
   */
  async function resolvePendingIngredients(): Promise<IngredientRowState[] | null> {
    const resolved: IngredientRowState[] = [];
    let created = 0;
    let linked = 0;

    // Case/space/punctuation-insensitive: "Green Cardamon" and "GreenCardamon" both resolve
    // to whatever "Green Cardamom" record already exists — same word, different formatting,
    // safe to link automatically. Genuine typos ("Cardamon" vs "Cardamom") are surfaced as a
    // one-click suggestion in the row editor instead of being auto-linked here, since saving
    // is the point of no return and two different-but-similar ingredients must never merge
    // silently.
    async function findExact(name: string) {
      const page = await ingredientsApi.list({ search: name, page: 1, pageSize: 8 });
      const key = normalizeNameKey(name);
      return page.items.find((i) => normalizeNameKey(i.name) === key) ?? null;
    }

    for (const row of ingredients) {
      if (row.ingredientId || !row.pendingCreateName.trim()) {
        resolved.push(row);
        continue;
      }
      const name = row.pendingCreateName.trim();
      try {
        const exact = await findExact(name);
        if (exact) {
          linked++;
          resolved.push({ ...row, ingredientId: exact.id, ingredientLabel: exact.name, pendingCreateName: '' });
          continue;
        }
        const createdIngredient = await ingredientsApi.create({ name, unit: row.unit.trim() || 'GM' });
        created++;
        resolved.push({
          ...row,
          ingredientId: createdIngredient.id,
          ingredientLabel: createdIngredient.name,
          pendingCreateName: '',
        });
      } catch (err) {
        // Someone else created the same name a moment ago — re-check before giving up.
        const clash = await findExact(name).catch(() => null);
        if (clash) {
          linked++;
          resolved.push({ ...row, ingredientId: clash.id, ingredientLabel: clash.name, pendingCreateName: '' });
          continue;
        }
        setError(`Could not add "${name}" to the Ingredient Master: ${readError(err).message}`);
        return null;
      }
    }

    if (created > 0 || linked > 0) {
      qc.invalidateQueries({ queryKey: ['ingredients'] });
    }
    if (created > 0) {
      notify.info(`Added ${created} new ingredient${created === 1 ? '' : 's'} to the Ingredient Master.`);
    }
    setIngredients(resolved);
    return resolved;
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!base.menuItemId) {
      setError('Choose a menu item first.');
      return;
    }
    if (ingredients.some((row) => !row.ingredientId && !row.pendingCreateName.trim())) {
      setError('Every ingredient row needs an ingredient chosen from the list.');
      return;
    }
    if (ingredients.some((row) => !row.unit.trim())) {
      setError('Every ingredient row needs a unit.');
      return;
    }

    setResolvingIngredients(true);
    const resolvedIngredients = await resolvePendingIngredients().finally(() =>
      setResolvingIngredients(false),
    );
    if (!resolvedIngredients) return;

    const body: RecipeWriteRequest = {
      ...(id ? { id } : {}),
      menuItemId: base.menuItemId,
      basePax: base.basePax,
      isDefault: base.isDefault,
      prepTimeMin: toNullableInt(base.prepTimeMin),
      cookTimeMin: toNullableInt(base.cookTimeMin),
      teamSize: toNullableInt(base.teamSize),
      difficulty: base.difficulty || null,
      descriptionEn: base.descriptionEn || null,
      descriptionHi: base.descriptionHi || null,
      methodEn: base.methodEn || null,
      methodHi: base.methodHi || null,
      yieldNote: base.yieldNote || null,
      chefNotes: base.chefNotes || null,
      status: base.status,
      ingredients: resolvedIngredients.map((row, index) => ({
        ...(row.id ? { id: row.id } : {}),
        ingredientId: row.ingredientId,
        quantity: row.quantity,
        unit: row.unit,
        scaling: row.scaling,
        notes: row.notes || null,
        sortOrder: index,
      })),
      steps: steps.map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        textEn: row.textEn,
        textHi: row.textHi || null,
        durationMin: toNullableInt(row.durationMin),
      })),
    };

    try {
      const saved = await upsert.mutateAsync(body);
      if (youtubeImportId && !isEditing) {
        // Link the staging record to the recipe it produced. Non-fatal: the recipe is
        // already saved even if this bookkeeping call fails.
        try {
          await youtubeImportsApi.markSaved(youtubeImportId, saved.id);
          qc.invalidateQueries({ queryKey: ['youtube-imports'] });
          qc.invalidateQueries({ queryKey: ['youtube-import'] });
        } catch {
          notify.error('The recipe was saved, but the YouTube import could not be marked as saved.');
        }
        notify.success('Recipe saved to the Recipe Master.');
        navigate('/youtube-imports');
        return;
      }
      notify.success(isEditing ? 'Recipe updated.' : 'Recipe created.');
      navigate(`/recipes?menuItemId=${saved.menuItemId}`);
    } catch (err) {
      setError(readError(err).message);
    }
  }

  if (isEditing && loadingRecipe) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        leading={
          youtubeImportId ? (
            <BackButton to="/youtube-imports" label="Back to YouTube downloader" />
          ) : (
            <BackButton to={base.menuItemId ? `/recipes?menuItemId=${base.menuItemId}` : '/recipes'} label="Back to recipes" />
          )
        }
        {...(youtubeImportId
          ? { eyebrow: `Reviewing YouTube import${youtubeImport?.videoTitle ? ` — ${youtubeImport.videoTitle}` : ''}` }
          : {})}
        title={isEditing ? `Edit recipe — ${base.menuItemLabel || 'variant'}` : 'New recipe'}
        subtitle="Quantities are stated for the base serving count and scaled automatically when an order asks for a different pax."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={translateAllToHindi}
              disabled={translating}
            >
              {translating ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <LanguagesIcon data-icon="inline-start" />
              )}
              {translating ? 'Translating…' : 'Translate to Hindi'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setImportOpen(true)}>
              <SparklesIcon data-icon="inline-start" />
              Import from text
            </Button>
          </>
        }
      />

      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <section className="bg-card rounded-xl border p-4">
          <h2 className="font-heading mb-4 text-base font-semibold">Base details</h2>
          <FieldGroup>
            <SearchPickerField
              id="recipe-menu-item"
              label="Menu item"
              required
              disabled={Boolean(prefillMenuItemId) || isEditing}
              value={base.menuItemId || null}
              displayValue={base.menuItemLabel}
              options={(menuItemOptions?.items ?? []).map((m) => ({ id: m.id, label: m.name }))}
              loading={menuItemsFetching}
              onSearchChange={setMenuItemSearch}
              onSelect={(opt: PickerOption) =>
                setBase((prev) => ({ ...prev, menuItemId: opt.id, menuItemLabel: opt.label }))
              }
            />

            <FieldRow>
              <NumberField
                label="Base pax"
                required
                min={1}
                step={1}
                value={base.basePax}
                onChange={(e) => setBase((prev) => ({ ...prev, basePax: Number(e.target.value) }))}
                helperText="The serving count these quantities are stated for."
              />
              <CheckboxField
                label="Default variant"
                helperText={
                  forceDefault
                    ? 'Forced — this is the only variant for this menu item.'
                    : 'The variant used for shopping lists and the default recipe view.'
                }
                checked={base.isDefault}
                disabled={forceDefault}
                onCheckedChange={(checked) => setBase((prev) => ({ ...prev, isDefault: checked }))}
              />
            </FieldRow>

            <FieldRow>
              <NumberField
                label="Prep time (min)"
                value={base.prepTimeMin}
                onChange={(e) => setBase((prev) => ({ ...prev, prepTimeMin: e.target.value }))}
              />
              <NumberField
                label="Cook time (min)"
                value={base.cookTimeMin}
                onChange={(e) => setBase((prev) => ({ ...prev, cookTimeMin: e.target.value }))}
              />
            </FieldRow>

            <FieldRow>
              <NumberField
                label="Team size"
                value={base.teamSize}
                onChange={(e) => setBase((prev) => ({ ...prev, teamSize: e.target.value }))}
              />
              <SelectField
                label="Difficulty"
                value={base.difficulty}
                onChange={(v) => setBase((prev) => ({ ...prev, difficulty: v as RecipeDifficulty | '' }))}
                emptyLabel="Not set"
                options={enumOptions(RecipeDifficulty)}
              />
            </FieldRow>

            <FieldRow>
              <TextField
                label="Variant description (EN)"
                value={base.descriptionEn}
                onChange={(e) => setBase((prev) => ({ ...prev, descriptionEn: e.target.value }))}
                maxLength={LIMITS.RECIPE_DESCRIPTION_MAX}
                helperText="e.g. “Missi Roti” — shown alongside the menu item name."
              />
              <TextField
                label="Variant description (HI)"
                value={base.descriptionHi}
                onChange={(e) => setBase((prev) => ({ ...prev, descriptionHi: e.target.value }))}
                maxLength={LIMITS.RECIPE_DESCRIPTION_MAX}
              />
            </FieldRow>

            <FieldRow>
              <TextField
                label="Method summary (EN)"
                multiline
                rows={4}
                value={base.methodEn}
                onChange={(e) => setBase((prev) => ({ ...prev, methodEn: e.target.value }))}
              />
              <TextField
                label="Method summary (HI)"
                multiline
                rows={4}
                value={base.methodHi}
                onChange={(e) => setBase((prev) => ({ ...prev, methodHi: e.target.value }))}
              />
            </FieldRow>

            <FieldRow>
              <TextField
                label="Yield note"
                value={base.yieldNote}
                onChange={(e) => setBase((prev) => ({ ...prev, yieldNote: e.target.value }))}
                maxLength={LIMITS.RECIPE_YIELD_NOTE_MAX}
              />
              <TextField
                label="Chef notes"
                multiline
                rows={2}
                value={base.chefNotes}
                onChange={(e) => setBase((prev) => ({ ...prev, chefNotes: e.target.value }))}
                maxLength={LIMITS.RECIPE_CHEF_NOTES_MAX}
              />
            </FieldRow>

            {isEditing && (
              <SelectField
                label="Status"
                value={base.status}
                onChange={(v) => setBase((prev) => ({ ...prev, status: v as MasterStatus }))}
                options={enumOptions(MasterStatus)}
              />
            )}
          </FieldGroup>
        </section>

        <section className="bg-card rounded-xl border p-4">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="font-heading text-base font-semibold">
              Ingredients ({ingredients.length})
            </h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={ingredients.length >= LIMITS.RECIPE_INGREDIENTS_PER_RECIPE_MAX}
              onClick={() => setIngredients((rows) => [newIngredientRow(), ...rows])}
            >
              <PlusIcon data-icon="inline-start" />
              Add ingredient
            </Button>
          </div>
          {ingredients.some((row) => ingredientRowStatus(row) === 'pending') && (
            <p
              className={cn(
                'mb-4 flex items-center gap-1.5 text-xs font-medium',
                TONE_TEXT_CLASS.info,
              )}
            >
              <CircleFadingPlusIcon className="size-3.5 shrink-0" />
              Ingredients marked "New" are not yet in the Ingredient Master — saving this recipe
              will add them automatically.
            </p>
          )}
          {!ingredients.some((row) => ingredientRowStatus(row) === 'pending') && <div className="mb-4" />}
          <div className="flex flex-col gap-1.5">
            {ingredients.map((row, index) => (
              <IngredientRowEditor
                key={row.key}
                row={row}
                index={index}
                canRemove={ingredients.length > 1}
                onChange={(patch) => updateIngredient(row.key, patch)}
                onRemove={() => removeIngredient(row.key)}
                onReorder={reorderIngredients}
              />
            ))}
          </div>
        </section>

        <section className="bg-card rounded-xl border p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-heading text-base font-semibold">Steps ({steps.length})</h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={steps.length >= LIMITS.RECIPE_STEPS_PER_RECIPE_MAX}
              onClick={() => setSteps((rows) => [...rows, newStepRow()])}
            >
              <PlusIcon data-icon="inline-start" />
              Add step
            </Button>
          </div>
          {steps.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No steps yet — optional, but recommended so the method is on record step by step.
            </p>
          )}
          <div className="flex flex-col gap-2">
            {steps.map((row, index) => (
              <StepRowEditor
                key={row.key}
                row={row}
                index={index}
                onChange={(patch) => updateStep(row.key, patch)}
                onRemove={() => removeStep(row.key)}
                onReorder={reorderSteps}
              />
            ))}
          </div>
        </section>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Spinner data-icon="inline-start" />}
            {resolvingIngredients
              ? 'Updating Ingredient Master…'
              : submitting
                ? 'Saving…'
                : youtubeImportId && !isEditing
                  ? 'Save to Recipe Master'
                  : 'Save recipe'}
          </Button>
        </div>
      </form>

      <RecipeImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onApply={applyImportedDraft}
      />
    </>
  );
}

/* ------------------------------------------------------------------- ingredient row */

function IngredientRowEditor({
  row,
  index,
  canRemove,
  onChange,
  onRemove,
  onReorder,
}: {
  row: IngredientRowState;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<IngredientRowState>) => void;
  onRemove: () => void;
  onReorder: (from: number, to: number) => void;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isFetching } = useQuery({
    queryKey: ['recipe-ingredient-picker', search],
    queryFn: () => ingredientsApi.list({ search: search || undefined, page: 1, pageSize: 20 }),
  });

  const options: PickerOption[] = useMemo(
    () => (data?.items ?? []).map((i) => ({ id: i.id, label: i.name, sublabel: i.unit })),
    [data],
  );

  const status = ingredientRowStatus(row);

  // Typo-level check ("Green Cardamon" -> "Green Cardamom") for a row that would otherwise
  // create a brand-new Ingredient Master record. Never auto-applied — the user reviews the
  // extracted recipe before saving, so a mismatch here costs one click, not a wrong merge.
  const pendingName = row.pendingCreateName.trim();
  const { data: suggestionPage } = useQuery({
    queryKey: ['ingredient-fuzzy-suggestion', pendingName],
    queryFn: () => ingredientsApi.list({ search: pendingName, page: 1, pageSize: 8 }),
    enabled: status === 'pending' && pendingName.length >= 4,
  });
  const suggestion = useMemo(
    () => suggestionPage?.items.find((i) => isLikelyTypoOf(i.name, pendingName)) ?? null,
    [suggestionPage, pendingName],
  );

  const statusTone =
    status === 'matched' ? 'success' : status === 'pending' ? (suggestion ? 'progress' : 'info') : 'danger';

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData('text/plain'));
        if (!Number.isNaN(from)) onReorder(from, index);
      }}
      className={cn(
        'bg-background flex flex-col gap-1.5 rounded-lg border border-l-4 px-2 py-1.5 sm:flex-row sm:items-end',
        TONE_BORDER_CLASS[statusTone],
      )}
    >
      <span className="text-muted-foreground flex h-9 shrink-0 cursor-grab items-center" aria-hidden>
        <GripVerticalIcon className="size-4" />
      </span>

      <div className="grid flex-1 grid-cols-1 gap-x-2 gap-y-1.5 sm:grid-cols-[2fr_1fr_1fr_1.2fr_1.5fr]">
        <div className="flex flex-col gap-1">
          <SearchPickerField
            id={`recipe-ingredient-${row.key}`}
            label="Ingredient"
            required
            value={row.ingredientId || null}
            displayValue={row.ingredientLabel}
            options={options}
            loading={isFetching}
            onSearchChange={setSearch}
            onSelect={(opt) =>
              onChange({
                ingredientId: opt.id,
                ingredientLabel: opt.label,
                ingredientSublabel: opt.sublabel ?? '',
                unit: row.unit || opt.sublabel || '',
                pendingCreateName: '',
              })
            }
          />
          {status !== 'unset' && (
            <span className={cn('inline-flex items-center gap-1 text-xs font-medium', TONE_TEXT_CLASS[statusTone])}>
              {status === 'matched' ? (
                <>
                  <CheckCircle2Icon className="size-3.5 shrink-0" />
                  In Ingredient Master
                </>
              ) : (
                <>
                  <CircleFadingPlusIcon className="size-3.5 shrink-0" />
                  {suggestion ? 'Possible duplicate — see suggestion below' : 'New — will be added on save'}
                </>
              )}
            </span>
          )}
          {suggestion && (
            <button
              type="button"
              onClick={() =>
                onChange({
                  ingredientId: suggestion.id,
                  ingredientLabel: suggestion.name,
                  ingredientSublabel: suggestion.unit,
                  unit: row.unit || suggestion.unit,
                  pendingCreateName: '',
                })
              }
              className={cn(
                'text-left text-xs font-medium underline underline-offset-2',
                TONE_TEXT_CLASS.progress,
              )}
            >
              Did you mean "{suggestion.name}"? Use it instead of creating a new ingredient.
            </button>
          )}
        </div>
        <NumberField
          label="Quantity"
          required
          min={0}
          step="any"
          value={row.quantity}
          onChange={(e) => onChange({ quantity: Number(e.target.value) })}
        />
        <TextField
          label="Unit"
          required
          value={row.unit}
          onChange={(e) => onChange({ unit: e.target.value })}
          maxLength={LIMITS.UNIT_MAX}
        />
        <SelectField
          label="Scaling"
          value={row.scaling}
          onChange={(v) => onChange({ scaling: v as RecipeIngredientScaling })}
          options={enumOptions(RecipeIngredientScaling)}
        />
        <TextField
          label="Notes"
          value={row.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
        />
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!canRemove}
        onClick={onRemove}
        aria-label="Remove ingredient"
        className="hover:text-destructive mb-0.5 shrink-0"
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------------- step row */

function StepRowEditor({
  row,
  index,
  onChange,
  onRemove,
  onReorder,
}: {
  row: StepRowState;
  index: number;
  onChange: (patch: Partial<StepRowState>) => void;
  onRemove: () => void;
  onReorder: (from: number, to: number) => void;
}): JSX.Element {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData('text/plain'));
        if (!Number.isNaN(from)) onReorder(from, index);
      }}
      className="bg-background flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start"
    >
      <span className="text-muted-foreground flex h-8 shrink-0 items-center gap-1" aria-hidden>
        <GripVerticalIcon className="size-4 cursor-grab" />
        <span className="text-xs font-semibold tabular-nums">#{index + 1}</span>
      </span>

      <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-[2fr_2fr_0.7fr]">
        <TextField
          label="Step (EN)"
          required
          multiline
          rows={2}
          value={row.textEn}
          onChange={(e) => onChange({ textEn: e.target.value })}
          maxLength={LIMITS.RECIPE_STEP_TEXT_MAX}
        />
        <TextField
          label="Step (HI)"
          multiline
          rows={2}
          value={row.textHi}
          onChange={(e) => onChange({ textHi: e.target.value })}
          maxLength={LIMITS.RECIPE_STEP_TEXT_MAX}
        />
        <NumberField
          label="Duration (min)"
          value={row.durationMin}
          onChange={(e) => onChange({ durationMin: e.target.value })}
        />
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onRemove}
        aria-label="Remove step"
        className="hover:text-destructive shrink-0"
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}
