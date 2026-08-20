import { useEffect, useState } from 'react';
import {
  CLEANING_RISK_LEVEL_LABELS,
  CleaningRiskLevel,
  FOOD_CONTACT_CLASS_LABELS,
  FoodContactClass,
  LIMITS,
  MasterStatus,
  type CleanableAssetDto,
} from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldGroup, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { notify } from '@/lib/notify';
import { readError } from '../../services/errorMessage';
import {
  useCleaningSetup,
  useCreateCleanableAsset,
  useUpdateCleanableAsset,
} from '../../hooks/useCleaning';

const FORM_ID = 'cleanable-asset-form';

/**
 * Registering something that gets cleaned.
 *
 * Only a name, a type and an area are required. The code is generated from the area and type
 * segments, and the risk level and food-contact class default from the type — asking somebody
 * registering a chopping board to classify it from first principles is how a register ends up
 * inconsistent.
 */
export function CleanableAssetFormModal({
  open,
  onClose,
  asset,
  onToggleAvailability,
}: {
  open: boolean;
  onClose: () => void;
  asset: CleanableAssetDto | null;
  onToggleAvailability?: (asset: CleanableAssetDto) => Promise<void>;
}): JSX.Element {
  const editing = asset !== null;
  const { data: setup } = useCleaningSetup();
  const create = useCreateCleanableAsset();
  const update = useUpdateCleanableAsset();

  const [name, setName] = useState('');
  const [assetTypeId, setAssetTypeId] = useState('');
  const [areaId, setAreaId] = useState('');
  const [riskLevel, setRiskLevel] = useState('');
  const [foodContact, setFoodContact] = useState('');
  const [positionNote, setPositionNote] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<string>(MasterStatus.ACTIVE);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(asset?.name ?? '');
    setAssetTypeId(asset?.assetTypeId ?? '');
    setAreaId(asset?.areaId ?? '');
    setRiskLevel(asset?.riskLevel ?? '');
    setFoodContact(asset?.foodContact ?? '');
    setPositionNote(asset?.positionNote ?? '');
    setDescription(asset?.description ?? '');
    setNotes(asset?.notes ?? '');
    setStatus(asset?.status ?? MasterStatus.ACTIVE);
  }, [open, asset]);

  // Choosing a type on a new asset pulls its defaults through, which is the whole point of
  // the type carrying them. On an edit it must not overwrite a deliberate override.
  function onTypeChange(next: string): void {
    setAssetTypeId(next);
    if (editing) return;
    const type = (setup?.assetTypes ?? []).find((candidate) => candidate.id === next);
    if (type === undefined) return;
    setRiskLevel(type.defaultRiskLevel);
    setFoodContact(type.defaultFoodContact);
  }

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (name.trim() === '' || assetTypeId === '' || areaId === '') {
      setError('A name, a type and an area are required.');
      return;
    }
    try {
      if (editing) {
        await update.mutateAsync({
          id: asset.id,
          body: {
            name: name.trim(),
            assetTypeId,
            areaId,
            ...(riskLevel !== '' ? { riskLevel: riskLevel as CleaningRiskLevel } : {}),
            ...(foodContact !== '' ? { foodContact: foodContact as FoodContactClass } : {}),
            positionNote: positionNote.trim() === '' ? null : positionNote.trim(),
            description: description.trim() === '' ? null : description.trim(),
            notes: notes.trim() === '' ? null : notes.trim(),
            status: status as MasterStatus,
          },
        });
        notify.success('Asset updated.');
      } else {
        const created = await create.mutateAsync({
          name: name.trim(),
          assetTypeId,
          areaId,
          ...(riskLevel !== '' ? { riskLevel: riskLevel as CleaningRiskLevel } : {}),
          ...(foodContact !== '' ? { foodContact: foodContact as FoodContactClass } : {}),
          ...(positionNote.trim() !== '' ? { positionNote: positionNote.trim() } : {}),
          ...(description.trim() !== '' ? { description: description.trim() } : {}),
          ...(notes.trim() !== '' ? { notes: notes.trim() } : {}),
        });
        notify.success(`Registered as ${created.code}.`);
      }
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="cleanable-asset-form"
      title={editing ? asset.name : 'Register something cleanable'}
      description={editing ? asset.code : 'A surface, a machine, a room — anything that gets cleaned.'}
      open={open}
      onClose={onClose}
      minWidth={560}
      footer={
        <FormModalFooter
          formId={FORM_ID}
          onCancel={onClose}
          submitting={create.isPending || update.isPending}
          saveLabel={editing ? 'Save' : 'Register'}
        />
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <TextField
            label="Name"
            required
            placeholder="Prep table 1 — worktop"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={LIMITS.CLEANABLE_ASSET_NAME_MAX}
          />

          <SelectField
            label="Type"
            required
            helperText="Sets the default risk level and food-contact class."
            value={assetTypeId}
            onChange={onTypeChange}
            emptyLabel="Choose a type"
            options={(setup?.assetTypes ?? []).map((type) => ({
              value: type.id,
              label: type.name,
            }))}
          />

          <SelectField
            label="Area"
            required
            value={areaId}
            onChange={setAreaId}
            emptyLabel="Choose an area"
            options={(setup?.areas ?? []).map((area) => ({
              value: area.id,
              label: area.floorName === null ? area.name : `${area.floorName} · ${area.name}`,
            }))}
          />

          <SelectField
            label="Risk if it is not cleaned"
            value={riskLevel}
            onChange={setRiskLevel}
            emptyLabel="Use the type's default"
            options={Object.values(CleaningRiskLevel).map((value) => ({
              value,
              label: CLEANING_RISK_LEVEL_LABELS[value],
            }))}
          />

          <SelectField
            label="Food contact"
            value={foodContact}
            onChange={setFoodContact}
            emptyLabel="Use the type's default"
            options={Object.values(FoodContactClass).map((value) => ({
              value,
              label: FOOD_CONTACT_CLASS_LABELS[value],
            }))}
          />

          <TextField
            label="Where exactly"
            placeholder="By the window, third from the door"
            value={positionNote}
            onChange={(event) => setPositionNote(event.target.value)}
            maxLength={LIMITS.CLEANABLE_ASSET_POSITION_NOTE_MAX}
          />

          <TextField
            label="Description"
            multiline
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={LIMITS.CLEANABLE_ASSET_DESCRIPTION_MAX}
          />

          <TextField
            label="Notes"
            multiline
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={LIMITS.CLEANABLE_ASSET_NOTES_MAX}
          />

          {editing && (
            <>
              <SelectField
                label="Status"
                value={status}
                onChange={setStatus}
                options={Object.values(MasterStatus).map((value) => ({ value, label: value }))}
              />
              {onToggleAvailability !== undefined && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void onToggleAvailability(asset)}
                >
                  {asset.isAvailable
                    ? 'Take out of service (stops new cleaning tasks)'
                    : 'Put back in service'}
                </Button>
              )}
            </>
          )}
        </FieldGroup>
      </form>
    </Modal>
  );
}
