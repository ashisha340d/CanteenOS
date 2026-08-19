import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  MasterStatus,
  ReceiptTransport,
  type KioskDeviceDto,
  type MenuTreeDto,
} from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { menusApi } from '../../api/menuMaster';
import { useCreateKioskDevice, useUpdateKioskDevice } from '../../hooks/useAdmin';
import { useMenus } from '../../hooks/useMenuMaster';
import { useStations } from '../../hooks/useMasters';
import { readError } from '../../services/errorMessage';
import { CategoryOrderBoard } from './CategoryOrderBoard';

interface FormValues {
  code: string;
  label: string;
  menuCode: string;
  stationId: string;
  outletName: string;
  outletNameHi: string;
  upiVpa: string;
  upiPayeeName: string;
  receiptTransport: ReceiptTransport;
  categoryOrder: string[];
  status: MasterStatus;
}

const FORM_ID = 'kiosk-device-form';

const EMPTY: FormValues = {
  code: '',
  label: '',
  menuCode: '',
  stationId: '',
  outletName: '',
  outletNameHi: '',
  upiVpa: '',
  upiPayeeName: '',
  receiptTransport: ReceiptTransport.USB,
  categoryOrder: [],
  status: MasterStatus.ACTIVE,
};

/**
 * Everything a stand is, on one form.
 *
 * The form is deliberately not split into a wizard. An operator registering a kiosk knows all
 * of this at once — it is written on a sheet of paper next to them — and a three-step flow
 * would turn one minute of typing into three screens of clicking Next.
 *
 * `usePersistedFormState` is not used here, unlike the master-data modals. Those are short
 * forms where recovering a half-typed name after an accidental dismissal is a kindness; this
 * one carries a dragged category order that only makes sense against the menu it was dragged
 * for, and restoring it against a different menu would silently apply the wrong order.
 */
export function KioskDeviceModal({
  open,
  editing,
  onClose,
}: {
  open: boolean;
  editing: KioskDeviceDto | null;
  onClose: () => void;
}): JSX.Element {
  const [value, setValue] = useState<FormValues>(EMPTY);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateKioskDevice();
  const update = useUpdateKioskDevice();
  const submitting = create.isPending || update.isPending;

  const menus = useMenus({ status: MasterStatus.ACTIVE, pageSize: 100 });
  const stations = useStations({ status: MasterStatus.ACTIVE, pageSize: 100 });

  // Reseeds when the modal is opened on a different subject. Doing this in render rather than
  // an effect means the first paint already shows the right values — an effect would flash the
  // previous kiosk's details for a frame every time the operator opened a second one.
  const subject = editing?.id ?? 'new';
  if (open && loadedFor !== subject) {
    setLoadedFor(subject);
    setValue(editing === null ? EMPTY : fromDevice(editing));
    setError(null);
  }
  if (!open && loadedFor !== null) setLoadedFor(null);

  const published = (menus.data?.items ?? []).filter((menu) => menu.publishedAt !== null);

  // The categories to sort come from the resolved tree rather than the assignment list, because
  // that is what the kiosk itself reads — sorting against a list the hall will never see is how
  // an operator ends up dragging a category that turns out to be empty.
  const tree = useQuery({
    queryKey: ['menu-tree', value.menuCode],
    queryFn: () => menusApi.tree(value.menuCode),
    enabled: open && value.menuCode !== '',
    staleTime: 60_000,
  });

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const body = {
      code: value.code,
      label: value.label,
      menuCode: value.menuCode,
      stationId: value.stationId === '' ? null : value.stationId,
      outletName: value.outletName,
      outletNameHi: value.outletNameHi === '' ? null : value.outletNameHi,
      upiVpa: value.upiVpa,
      upiPayeeName: value.upiPayeeName,
      receiptTransport: value.receiptTransport,
      categoryOrder: value.categoryOrder,
      status: value.status,
    };
    try {
      if (editing === null) await create.mutateAsync(body);
      else await update.mutateAsync({ id: editing.id, body });
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="kiosk-device-form"
      minWidth={720}
      title={editing === null ? 'New kiosk' : `Edit kiosk — ${editing.label}`}
      open={open}
      onClose={onClose}
      footer={<FormModalFooter formId={FORM_ID} onCancel={onClose} submitting={submitting} />}
    >
      <form onSubmit={onSubmit} id={FORM_ID}>
        <FieldGroup>
          {error !== null && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Kiosk code"
              helperText="Typed into the tablet once. Print it on the stand."
              autoFocus
              required
              value={value.code}
              onChange={(e) => setValue({ ...value, code: e.target.value.toUpperCase() })}
              className="font-mono"
              maxLength={40}
            />
            <TextField
              label="Label"
              helperText="What you call it here — “North Hall, by the pillar”"
              required
              value={value.label}
              onChange={(e) => setValue({ ...value, label: e.target.value })}
              maxLength={120}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Menu to sell from"
              helperText={
                published.length === 0
                  ? 'No menu has been published yet — publish one first.'
                  : 'Only published menus can be sold from.'
              }
              value={value.menuCode}
              onChange={(next) =>
                // The dragged order belongs to the menu it was dragged for; carrying it across
                // would silently apply one menu's arrangement to another's categories.
                setValue({ ...value, menuCode: next, categoryOrder: [] })
              }
              options={published.map((menu) => ({ value: menu.code, label: menu.name }))}
            />
            <SelectField
              label="Station"
              helperText="Optional — which site this stand belongs to"
              value={value.stationId}
              onChange={(next) => setValue({ ...value, stationId: next })}
              emptyLabel="Not tied to a station"
              options={(stations.data?.items ?? []).map((station) => ({
                value: station.id,
                label: station.name,
              }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Name shown on screen"
              helperText="The stand’s own name, never the legal name — that is on the Settings page."
              required
              value={value.outletName}
              onChange={(e) => setValue({ ...value, outletName: e.target.value })}
              maxLength={120}
            />
            <TextField
              label="Name in Hindi"
              lang="hi"
              value={value.outletNameHi}
              onChange={(e) => setValue({ ...value, outletNameHi: e.target.value })}
              maxLength={160}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="UPI ID for the payment QR"
              helperText="Where this stand’s money goes. Changing it is audited."
              placeholder="name@bank"
              className="font-mono"
              value={value.upiVpa}
              onChange={(e) => setValue({ ...value, upiVpa: e.target.value })}
              maxLength={120}
            />
            <TextField
              label="Payee name shown while scanning"
              helperText="Blank uses the on-screen name. Never leave a UPI app showing a blank payee."
              value={value.upiPayeeName}
              onChange={(e) => setValue({ ...value, upiPayeeName: e.target.value })}
              maxLength={120}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Receipt printer"
              helperText="Both are ESC/POS. USB needs pairing once, on the tablet itself."
              value={value.receiptTransport}
              onChange={(next) =>
                setValue({ ...value, receiptTransport: next as ReceiptTransport })
              }
              options={[
                { value: ReceiptTransport.USB, label: 'A printer attached to this tablet' },
                { value: ReceiptTransport.NETWORK, label: 'The counter printer on the network' },
              ]}
            />
            <SelectField
              label="Status"
              helperText="An inactive stand stops serving and disappears from the tablet’s picker."
              value={value.status}
              onChange={(next) => setValue({ ...value, status: next as MasterStatus })}
              options={[
                { value: MasterStatus.ACTIVE, label: 'Active' },
                { value: MasterStatus.INACTIVE, label: 'Inactive' },
              ]}
            />
          </div>

          <section>
            <p className="text-sm font-medium">Screen order</p>
            <p className="text-muted-foreground mt-0.5 mb-3 text-xs">
              Drag the categories into the order this stand should show them in. Anything you do
              not place stays where the menu puts it, so a category added later never disappears.
            </p>
            {value.menuCode === '' ? (
              <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
                Pick a menu first.
              </p>
            ) : tree.isLoading ? (
              <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
                Reading the menu…
              </p>
            ) : (
              <CategoryOrderBoard
                categories={sellableCategories(tree.data)}
                value={value.categoryOrder}
                onChange={(categoryOrder) => setValue({ ...value, categoryOrder })}
              />
            )}
          </section>
        </FieldGroup>
      </form>
    </Modal>
  );
}

function fromDevice(device: KioskDeviceDto): FormValues {
  return {
    code: device.code,
    label: device.label,
    menuCode: device.menuCode,
    stationId: device.stationId ?? '',
    outletName: device.outletName,
    outletNameHi: device.outletNameHi ?? '',
    upiVpa: device.upiVpa,
    upiPayeeName: device.upiPayeeName,
    receiptTransport: device.receiptTransport,
    categoryOrder: device.categoryOrder,
    status: device.status,
  };
}

/** Only categories a guest could actually order from — an empty one is not worth sorting. */
function sellableCategories(tree: MenuTreeDto | undefined) {
  if (tree === undefined) return [];
  return tree.categories
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((category) => category.items.length > 0);
}
