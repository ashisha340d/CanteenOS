import { useEffect, useState } from 'react';
import { MasterStatus, type ModifierDto, type ModifierGroupDto } from '@menuboard/shared';
import { PlusIcon, SaveIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NumberField, SelectField, TextField } from '@/components/form/fields';
import { Modal } from '../../components/Modal/Modal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useCreateModifier, useDeleteModifier, useUpdateModifier } from '../../hooks/useMenuMaster';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';

interface DraftModifier {
  name: string;
  nameHi: string;
  priceDelta: string;
  status: MasterStatus;
}

function draftFrom(m: ModifierDto): DraftModifier {
  return { name: m.name, nameHi: m.nameHi ?? '', priceDelta: String(m.priceDelta), status: m.status };
}

/**
 * The modifiers inside one group, editable in place — same "table of cells, Save/Delete per
 * row, + Add row appends a default immediately" pattern as the menu item variant table.
 */
export function ModifiersModal({
  open,
  onClose,
  group,
}: {
  open: boolean;
  onClose: () => void;
  group: ModifierGroupDto | null;
}): JSX.Element | null {
  const groupId = group?.id ?? '';
  const create = useCreateModifier(groupId);
  const update = useUpdateModifier();
  const del = useDeleteModifier();

  const [drafts, setDrafts] = useState<Record<string, DraftModifier>>({});
  const [deleting, setDeleting] = useState<ModifierDto | null>(null);

  useEffect(() => {
    if (!group?.modifiers) return;
    setDrafts(Object.fromEntries(group.modifiers.map((m) => [m.id, draftFrom(m)])));
  }, [group]);

  if (!group) return null;

  function setField(id: string, patch: Partial<DraftModifier>): void {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));
  }

  async function saveRow(id: string): Promise<void> {
    const draft = drafts[id];
    if (!draft) return;
    const priceDelta = Number(draft.priceDelta);
    if (!draft.name.trim() || Number.isNaN(priceDelta)) {
      notify.error('Name and a valid price delta are required.');
      return;
    }
    try {
      await update.mutateAsync({
        id,
        body: { name: draft.name.trim(), nameHi: draft.nameHi || null, priceDelta, status: draft.status },
      });
      notify.success('Modifier saved.');
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function addModifier(): Promise<void> {
    try {
      await create.mutateAsync({ name: 'New modifier', priceDelta: 0 });
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    try {
      await del.mutateAsync(deleting.id);
      notify.success('Modifier deleted.');
      setDeleting(null);
    } catch (err) {
      notify.fromError(err);
      setDeleting(null);
    }
  }

  return (
    <>
      <Modal
        id="modifiers"
        title={`Modifiers — ${group.name}`}
        open={open}
        onClose={onClose}
        minWidth={640}
        minHeight={380}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <div className="text-muted-foreground grid grid-cols-[1.2fr_1fr_0.8fr_0.8fr_auto] gap-2 px-1 text-xs font-medium">
              <span>Name</span>
              <span>Hindi name</span>
              <span>Price delta</span>
              <span>Status</span>
              <span />
            </div>

            {(group.modifiers ?? []).length === 0 && (
              <p className="text-muted-foreground p-2 text-sm">No modifiers in this group yet.</p>
            )}

            {(group.modifiers ?? []).map((modifier) => {
              const draft = drafts[modifier.id] ?? draftFrom(modifier);
              return (
                <div
                  key={modifier.id}
                  className="grid grid-cols-[1.2fr_1fr_0.8fr_0.8fr_auto] items-center gap-2 rounded-md border p-1.5"
                >
                  <TextField
                    value={draft.name}
                    onChange={(e) => setField(modifier.id, { name: e.target.value })}
                  />
                  <TextField
                    value={draft.nameHi}
                    onChange={(e) => setField(modifier.id, { nameHi: e.target.value })}
                  />
                  <NumberField
                    value={draft.priceDelta}
                    onChange={(e) => setField(modifier.id, { priceDelta: e.target.value })}
                  />
                  <SelectField
                    value={draft.status}
                    onChange={(v) => setField(modifier.id, { status: v as MasterStatus })}
                    options={enumOptions(MasterStatus)}
                  />
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => saveRow(modifier.id)}
                      aria-label={`Save ${modifier.name}`}
                    >
                      <SaveIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="hover:text-destructive"
                      onClick={() => setDeleting(modifier)}
                      aria-label={`Delete ${modifier.name}`}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <Button variant="outline" size="sm" className="self-start" onClick={addModifier}>
            <PlusIcon data-icon="inline-start" />
            Add modifier
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete modifier"
        message={`Delete "${deleting?.name}"?`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
