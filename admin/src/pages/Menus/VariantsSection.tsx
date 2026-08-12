import { useEffect, useState } from 'react';
import { AvailabilityStatus, MasterStatus, type MenuItemVariantDto } from '@menuboard/shared';
import { PlusIcon, SaveIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { NumberField, SelectField, TextField } from '@/components/form/fields';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import {
  useCreateVariant,
  useDeleteVariant,
  useMenuItemVariants,
  useUpdateVariant,
} from '../../hooks/useMenuMaster';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';

interface DraftVariant {
  variantCode: string;
  name: string;
  nameHi: string;
  portionName: string;
  portionNameHi: string;
  quantity: string;
  unit: string;
  price: string;
  description: string;
  descriptionHi: string;
  preparationMethod: string;
  preparationMethodHi: string;
  availability: AvailabilityStatus;
  status: MasterStatus;
  isDefault: boolean;
}

function draftFrom(v: MenuItemVariantDto): DraftVariant {
  return {
    variantCode: v.variantCode ?? '',
    name: v.name,
    nameHi: v.nameHi ?? '',
    portionName: v.portionName ?? '',
    portionNameHi: v.portionNameHi ?? '',
    quantity: v.quantity === null ? '' : String(v.quantity),
    unit: v.unit ?? '',
    price: String(v.price),
    description: v.description ?? '',
    descriptionHi: v.descriptionHi ?? '',
    preparationMethod: v.preparationMethod ?? '',
    preparationMethodHi: v.preparationMethodHi ?? '',
    availability: v.availability,
    status: v.status,
    isDefault: v.isDefault,
  };
}

/**
 * Every variant row is editable in place and saved individually — the same "table of cells,
 * Save/Delete per row, + Add row appends a default immediately" pattern used for product
 * variants elsewhere, rather than a separate create/edit modal per variant. Each variant is a
 * small card of three lines: the sellable line (name/portion/qty/unit/price/status), the
 * Hindi/availability line, and the description/preparation line — matching every Hindi/English
 * pair menu_item_variants actually has in the database.
 *
 * Content-only (no Modal wrapper) so it can be embedded directly inside the Food Item Master's
 * own edit modal — editing a dish and managing what it sells as are the same task, not two.
 * Variants are global to the food item: every menu that offers this dish shares the same list.
 */
export function VariantsSection({ foodItemId }: { foodItemId: string }): JSX.Element {
  const { data: variants, isLoading } = useMenuItemVariants(foodItemId, true);
  const create = useCreateVariant(foodItemId);
  const update = useUpdateVariant(foodItemId);
  const del = useDeleteVariant(foodItemId);

  const [drafts, setDrafts] = useState<Record<string, DraftVariant>>({});
  const [deleting, setDeleting] = useState<MenuItemVariantDto | null>(null);

  useEffect(() => {
    if (!variants) return;
    setDrafts(Object.fromEntries(variants.map((v) => [v.id, draftFrom(v)])));
  }, [variants]);

  function setField(id: string, patch: Partial<DraftVariant>): void {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));
  }

  async function saveRow(id: string): Promise<void> {
    const draft = drafts[id];
    if (!draft) return;
    const price = Number(draft.price);
    if (!draft.name.trim() || Number.isNaN(price)) {
      notify.error('Name and a valid price are required.');
      return;
    }
    try {
      await update.mutateAsync({
        id,
        body: {
          variantCode: draft.variantCode || null,
          name: draft.name.trim(),
          nameHi: draft.nameHi || null,
          portionName: draft.portionName || null,
          portionNameHi: draft.portionNameHi || null,
          quantity: draft.quantity === '' ? null : Number(draft.quantity),
          unit: draft.unit || null,
          price,
          description: draft.description || null,
          descriptionHi: draft.descriptionHi || null,
          preparationMethod: draft.preparationMethod || null,
          preparationMethodHi: draft.preparationMethodHi || null,
          availability: draft.availability,
          status: draft.status,
          isDefault: draft.isDefault,
        },
      });
      notify.success('Variant saved.');
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function addVariant(): Promise<void> {
    try {
      await create.mutateAsync({ name: 'New variant', price: 0 });
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    try {
      await del.mutateAsync(deleting.id);
      notify.success('Variant deleted.');
      setDeleting(null);
    } catch (err) {
      notify.fromError(err);
      setDeleting(null);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <div>
        <p className="text-sm font-medium">Variants</p>
        <p className="text-muted-foreground text-sm">
          Each card is a sellable configuration for this item on this menu — e.g. Tiny ₹30, Large
          ₹100. Prices here never change what an existing order already charged.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {isLoading && <p className="text-muted-foreground p-2 text-sm">Loading…</p>}
        {!isLoading && (variants?.length ?? 0) === 0 && (
          <p className="text-muted-foreground p-2 text-sm">
            No variants yet — this item sells at its base price until you add one.
          </p>
        )}

        {(variants ?? []).map((variant) => {
          const draft = drafts[variant.id] ?? draftFrom(variant);
          return (
            <div key={variant.id} className="flex flex-col gap-2 rounded-md border p-2">
              <div className="grid grid-cols-[1.2fr_1fr_0.7fr_0.7fr_0.9fr_0.9fr_auto] items-end gap-2">
                <TextField
                  label="Name"
                  value={draft.name}
                  onChange={(e) => setField(variant.id, { name: e.target.value })}
                />
                <TextField
                  label="Portion"
                  value={draft.portionName}
                  onChange={(e) => setField(variant.id, { portionName: e.target.value })}
                />
                <NumberField
                  label="Qty"
                  value={draft.quantity}
                  onChange={(e) => setField(variant.id, { quantity: e.target.value })}
                />
                <TextField
                  label="Unit"
                  value={draft.unit}
                  onChange={(e) => setField(variant.id, { unit: e.target.value })}
                />
                <NumberField
                  label="Price"
                  value={draft.price}
                  onChange={(e) => setField(variant.id, { price: e.target.value })}
                />
                <SelectField
                  label="Status"
                  value={draft.status}
                  onChange={(v) => setField(variant.id, { status: v as MasterStatus })}
                  options={enumOptions(MasterStatus)}
                />
                <div className="flex items-center gap-1 pb-1.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => saveRow(variant.id)}
                    aria-label={`Save ${variant.name}`}
                  >
                    <SaveIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="hover:text-destructive"
                    onClick={() => setDeleting(variant)}
                    aria-label={`Delete ${variant.name}`}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-[1.2fr_1fr_0.7fr_0.9fr_auto] items-end gap-2">
                <TextField
                  label="Name (Hindi)"
                  value={draft.nameHi}
                  onChange={(e) => setField(variant.id, { nameHi: e.target.value })}
                />
                <TextField
                  label="Portion (Hindi)"
                  value={draft.portionNameHi}
                  onChange={(e) => setField(variant.id, { portionNameHi: e.target.value })}
                />
                <TextField
                  label="Code"
                  value={draft.variantCode}
                  onChange={(e) => setField(variant.id, { variantCode: e.target.value })}
                />
                <SelectField
                  label="Availability"
                  value={draft.availability}
                  onChange={(v) => setField(variant.id, { availability: v as AvailabilityStatus })}
                  options={enumOptions(AvailabilityStatus)}
                />
                <label className="flex items-center gap-1.5 pb-1.5 text-sm whitespace-nowrap">
                  <Checkbox
                    checked={draft.isDefault}
                    onCheckedChange={(checked) => setField(variant.id, { isDefault: checked === true })}
                  />
                  Default
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="Description"
                  multiline
                  rows={2}
                  value={draft.description}
                  onChange={(e) => setField(variant.id, { description: e.target.value })}
                />
                <TextField
                  label="Description (Hindi)"
                  multiline
                  rows={2}
                  value={draft.descriptionHi}
                  onChange={(e) => setField(variant.id, { descriptionHi: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="Preparation method"
                  multiline
                  rows={2}
                  value={draft.preparationMethod}
                  onChange={(e) => setField(variant.id, { preparationMethod: e.target.value })}
                />
                <TextField
                  label="Preparation method (Hindi)"
                  multiline
                  rows={2}
                  value={draft.preparationMethodHi}
                  onChange={(e) => setField(variant.id, { preparationMethodHi: e.target.value })}
                />
              </div>
            </div>
          );
        })}
      </div>

      <Button variant="outline" size="sm" className="self-start" onClick={addVariant}>
        <PlusIcon data-icon="inline-start" />
        Add variant
      </Button>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete variant"
        message={`Delete "${deleting?.name}"? Refused if any order has ever sold it.`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
