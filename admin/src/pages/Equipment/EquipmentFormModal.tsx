import { useRef, useState } from 'react';
import {
  EquipmentStatus,
  LIMITS,
  MaintenanceFrequency,
  type EquipmentCreateRequest,
  type EquipmentDto,
  type EquipmentIdentificationDraft,
  type EquipmentUpdateRequest,
} from '@menuboard/shared';
import { SparklesIcon, UploadIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { FieldGroup, NumberField, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import {
  useCreateEquipment,
  useEquipmentCategories,
  useIdentifyEquipment,
  useLocationTree,
  useUpdateEquipment,
  useUploadEquipmentMedia,
} from '../../hooks/useEquipment';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';

interface FormValues {
  name: string;
  equipmentType: string;
  brand: string;
  model: string;
  serialNumber: string;
  manufacturer: string;
  categoryId: string;
  locationId: string;
  status: EquipmentStatus;
  imageMediaId: string;
  imageUrl: string;
  purchaseDate: string;
  installationDate: string;
  purchasePrice: string;
  invoiceNumber: string;
  supplierName: string;
  warrantyExpiry: string;
  notes: string;
  scheduleFrequency: string;
}

const FORM_ID = 'equipment-form';

function initialFrom(editing: EquipmentDto | null): FormValues {
  if (editing === null) {
    return {
      name: '',
      equipmentType: '',
      brand: '',
      model: '',
      serialNumber: '',
      manufacturer: '',
      categoryId: '',
      locationId: '',
      status: EquipmentStatus.OPERATIONAL,
      imageMediaId: '',
      imageUrl: '',
      purchaseDate: '',
      installationDate: '',
      purchasePrice: '',
      invoiceNumber: '',
      supplierName: '',
      warrantyExpiry: '',
      notes: '',
      scheduleFrequency: '',
    };
  }
  return {
    name: editing.name,
    equipmentType: editing.equipmentType ?? '',
    brand: editing.brand ?? '',
    model: editing.model ?? '',
    serialNumber: editing.serialNumber ?? '',
    manufacturer: editing.manufacturer ?? '',
    categoryId: editing.categoryId ?? '',
    locationId: editing.locationId ?? '',
    status: editing.status,
    imageMediaId: editing.imageMediaId ?? '',
    imageUrl: editing.imageUrl ?? '',
    purchaseDate: editing.purchaseDate ?? '',
    installationDate: editing.installationDate ?? '',
    purchasePrice: editing.purchasePrice === null ? '' : String(editing.purchasePrice),
    invoiceNumber: editing.invoiceNumber ?? '',
    supplierName: editing.supplierName ?? '',
    warrantyExpiry: editing.warrantyExpiry ?? '',
    notes: editing.notes ?? '',
    scheduleFrequency: '',
  };
}

/**
 * Registration and editing in one form.
 *
 * The photograph comes first because that is the intended path: take the picture, let the
 * model read the plate, correct what it got wrong, save. The AI step is a shortcut through
 * the same fields, never a separate flow — with `GEMINI_API_KEY` unset the button reports why
 * and the form is filled by hand, which is why nothing below depends on a draft existing.
 */
export function EquipmentFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: EquipmentDto | null;
}): JSX.Element {
  const modalId = `equipment-form-${editing?.id ?? 'new'}`;
  const { value, setValue, clear } = usePersistedFormState<FormValues>(
    modalId,
    initialFrom(editing),
    open,
  );
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<EquipmentIdentificationDraft | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const { data: categories } = useEquipmentCategories();
  const { data: tree } = useLocationTree();
  const create = useCreateEquipment();
  const update = useUpdateEquipment();
  const upload = useUploadEquipmentMedia();
  const identify = useIdentifyEquipment();

  const submitting = create.isPending || update.isPending;
  const busy = upload.isPending || identify.isPending;

  const locationOptions = (tree?.floors ?? []).flatMap((floor) =>
    floor.areas.flatMap((area) =>
      area.locations.map((location) => ({
        value: location.id,
        label: `${floor.name} · ${area.name} · ${location.name}`,
      })),
    ),
  );

  async function onPickPhoto(file: File): Promise<void> {
    setError(null);
    try {
      const media = await upload.mutateAsync({ file });
      setValue({ ...value, imageMediaId: media.id, imageUrl: media.url });

      // Identification is a bonus on top of a successfully attached photo: if it fails the
      // photo is still saved and the form still works.
      try {
        const result = await identify.mutateAsync(media.id);
        setDraft(result);
        setValue({
          ...value,
          imageMediaId: media.id,
          imageUrl: media.url,
          name: result.name ?? value.name,
          equipmentType: result.equipmentType ?? value.equipmentType,
          brand: result.brand ?? value.brand,
          model: result.model ?? value.model,
          serialNumber: result.serialNumber ?? value.serialNumber,
          manufacturer: result.manufacturer ?? value.manufacturer,
          categoryId: result.categoryId ?? value.categoryId,
        });
      } catch (err) {
        notify.warning(readError(err).message);
      }
    } catch (err) {
      setError(readError(err).message);
    }
  }

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    const common = {
      name: value.name,
      equipmentType: value.equipmentType || null,
      brand: value.brand || null,
      model: value.model || null,
      serialNumber: value.serialNumber || null,
      manufacturer: value.manufacturer || null,
      categoryId: value.categoryId || null,
      locationId: value.locationId || null,
      imageMediaId: value.imageMediaId || null,
      purchaseDate: value.purchaseDate || null,
      installationDate: value.installationDate || null,
      purchasePrice: value.purchasePrice === '' ? null : Number(value.purchasePrice),
      invoiceNumber: value.invoiceNumber || null,
      supplierName: value.supplierName || null,
      warrantyExpiry: value.warrantyExpiry || null,
      notes: value.notes || null,
    };

    try {
      if (editing) {
        // Status is deliberately not sent: it moves through the status action, which writes
        // the history row and the timeline entry an ordinary edit must not.
        await update.mutateAsync({ id: editing.id, body: common as EquipmentUpdateRequest });
        notify.success('Equipment updated.');
      } else {
        const body: EquipmentCreateRequest = {
          ...common,
          status: value.status,
          ...(draft !== null ? { capturedVia: 'PHOTO_AI' as const } : {}),
          ...(value.scheduleFrequency !== ''
            ? { schedule: { frequency: value.scheduleFrequency as MaintenanceFrequency } }
            : {}),
        };
        const saved = await create.mutateAsync(body);
        notify.success(`Registered as ${saved.assetId}.`);
      }
      clear();
      setDraft(null);
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="equipment-form"
      title={editing ? `Edit equipment — ${editing.assetId}` : 'Register equipment'}
      open={open}
      onClose={onClose}
      footer={
        <FormModalFooter
          formId={FORM_ID}
          onCancel={onClose}
          submitting={submitting}
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

          <div className="flex items-start gap-3">
            <div className="bg-muted size-20 shrink-0 overflow-hidden rounded-md border">
              {value.imageUrl !== '' && (
                <img src={value.imageUrl} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void onPickPhoto(file);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                {busy ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
                {value.imageUrl === '' ? 'Photograph the plate' : 'Replace photo'}
              </Button>
              <p className="text-muted-foreground mt-1.5 text-xs">
                A photo of the rating plate lets the server read the make, model and serial for
                you. Everything it proposes stays editable below.
              </p>
            </div>
          </div>

          {draft !== null && (
            <Alert>
              <SparklesIcon />
              <AlertDescription>
                <span className="flex flex-wrap items-center gap-2">
                  AI suggestion applied
                  <Badge variant="outline">{Math.round(draft.confidence * 100)}% confident</Badge>
                  {draft.uncertainFields.length > 0 && (
                    <span className="text-muted-foreground text-xs">
                      Check: {draft.uncertainFields.join(', ')}
                    </span>
                  )}
                </span>
              </AlertDescription>
            </Alert>
          )}

          <TextField
            label="Name"
            required
            autoFocus
            value={value.name}
            onChange={(event) => setValue({ ...value, name: event.target.value })}
            maxLength={LIMITS.EQUIPMENT_NAME_MAX}
            helperText="What a cook would call it — “Main Deck Oven”, not the model number."
          />

          <SelectField
            label="Category"
            helperText="Decides the middle of the asset id and seeds the first service schedule."
            value={value.categoryId}
            onChange={(next) => setValue({ ...value, categoryId: next })}
            emptyLabel="Uncategorised"
            options={(categories ?? []).map((category) => ({
              value: category.id,
              label: category.name,
            }))}
          />

          <SelectField
            label="Location"
            value={value.locationId}
            onChange={(next) => setValue({ ...value, locationId: next })}
            emptyLabel="Not placed yet"
            options={locationOptions}
          />

          <TextField
            label="Type"
            value={value.equipmentType}
            onChange={(event) => setValue({ ...value, equipmentType: event.target.value })}
            maxLength={LIMITS.EQUIPMENT_TYPE_MAX}
          />

          <TextField
            label="Brand"
            value={value.brand}
            onChange={(event) => setValue({ ...value, brand: event.target.value })}
            maxLength={LIMITS.EQUIPMENT_BRAND_MAX}
          />

          <TextField
            label="Model"
            value={value.model}
            onChange={(event) => setValue({ ...value, model: event.target.value })}
            maxLength={LIMITS.EQUIPMENT_MODEL_MAX}
          />

          <TextField
            label="Serial number"
            value={value.serialNumber}
            onChange={(event) => setValue({ ...value, serialNumber: event.target.value })}
            maxLength={LIMITS.EQUIPMENT_SERIAL_MAX}
          />

          <TextField
            label="Manufacturer"
            value={value.manufacturer}
            onChange={(event) => setValue({ ...value, manufacturer: event.target.value })}
            maxLength={LIMITS.EQUIPMENT_MANUFACTURER_MAX}
          />

          <TextField
            label="Purchase date"
            type="date"
            value={value.purchaseDate}
            onChange={(event) => setValue({ ...value, purchaseDate: event.target.value })}
          />

          <TextField
            label="Installation date"
            type="date"
            helperText="What a preventive schedule counts from, when there is one."
            value={value.installationDate}
            onChange={(event) => setValue({ ...value, installationDate: event.target.value })}
          />

          <NumberField
            label="Purchase price"
            value={value.purchasePrice}
            onChange={(event) => setValue({ ...value, purchasePrice: event.target.value })}
            min={0}
            step="0.01"
          />

          <TextField
            label="Invoice number"
            value={value.invoiceNumber}
            onChange={(event) => setValue({ ...value, invoiceNumber: event.target.value })}
            maxLength={LIMITS.EQUIPMENT_INVOICE_NUMBER_MAX}
          />

          <TextField
            label="Supplier name"
            helperText="As printed on the bill. The structured supplier link is set on the asset's page."
            value={value.supplierName}
            onChange={(event) => setValue({ ...value, supplierName: event.target.value })}
            maxLength={LIMITS.SUPPLIER_NAME_MAX}
          />

          <TextField
            label="Warranty expiry"
            type="date"
            helperText="Recorded as a warranty against the asset, so the expiry can never go stale."
            value={value.warrantyExpiry}
            onChange={(event) => setValue({ ...value, warrantyExpiry: event.target.value })}
          />

          {!editing && (
            <SelectField
              label="Preventive schedule"
              helperText="Leave blank to take the category's own recommendation, if it has one."
              value={value.scheduleFrequency}
              onChange={(next) => setValue({ ...value, scheduleFrequency: next })}
              emptyLabel="Category default"
              options={enumOptions(MaintenanceFrequency)}
            />
          )}

          <TextField
            label="Notes"
            multiline
            rows={2}
            value={value.notes}
            onChange={(event) => setValue({ ...value, notes: event.target.value })}
            maxLength={LIMITS.EQUIPMENT_NOTES_MAX}
          />
        </FieldGroup>
      </form>
    </Modal>
  );
}
