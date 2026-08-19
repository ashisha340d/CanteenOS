import { useMemo, useState } from 'react';
import {
  Capability,
  LIMITS,
  MasterStatus,
  type EquipmentSupplierDto,
  type EquipmentSupplierWriteRequest,
} from '@menuboard/shared';
import { PlusIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldGroup, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusChip } from '../../components/StatusChip';
import { DeleteAction, EditAction, RowActions } from '@/components/RowActions';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { Modal } from '../../components/Modal/Modal';
import { useAuth } from '../../services/AuthContext';
import { readError } from '../../services/errorMessage';
import {
  useCreateSupplier,
  useDeleteSupplier,
  useEquipmentCategories,
  useSuppliers,
  useUpdateSupplier,
} from '../../hooks/useEquipment';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';

const FORM_ID = 'equipment-supplier-form';

/**
 * The maintenance supplier master.
 *
 * Separate from the Entity master because most service outfits are never billed through the
 * POS — but `entityId` links the two when the same company *is* already a vendor there, so
 * nobody is entered twice.
 */
export function SuppliersPage(): JSX.Element {
  const { hasCapability } = useAuth();
  const canManage = hasCapability(Capability.SUPPLIER_MANAGE);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('equipment-suppliers');
  const [editing, setEditing] = useState<EquipmentSupplierDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<EquipmentSupplierDto | null>(null);

  const query = useMemo(
    () => ({
      search: search || undefined,
      status: (status || undefined) as MasterStatus | undefined,
      categoryId: categoryId || undefined,
      page,
      pageSize,
    }),
    [search, status, categoryId, page, pageSize],
  );

  const { data, isLoading } = useSuppliers(query);
  const { data: categories } = useEquipmentCategories();
  const remove = useDeleteSupplier();

  const filterCount = (status ? 1 : 0) + (categoryId ? 1 : 0);

  const columns: DataTableColumn<EquipmentSupplierDto>[] = [
    { field: 'code', headerName: 'Code', width: 120 },
    { field: 'name', headerName: 'Supplier', width: 220 },
    {
      field: 'contactPerson',
      headerName: 'Contact',
      width: 170,
      valueGetter: (row) => row.contactPerson ?? '—',
    },
    { field: 'phone', headerName: 'Phone', width: 150, valueGetter: (row) => row.phone ?? '—' },
    {
      field: 'categoryNames',
      headerName: 'Services',
      width: 240,
      valueGetter: (row) => (row.categoryNames ?? []).join(', ') || '—',
    },
    {
      field: 'equipmentCount',
      headerName: 'Assets',
      width: 90,
      align: 'right',
      valueGetter: (row) => row.equipmentCount ?? 0,
    },
    {
      field: 'openTicketCount',
      headerName: 'Open',
      width: 90,
      align: 'right',
      valueGetter: (row) => row.openTicketCount ?? 0,
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      renderCell: (row) => <StatusChip status={row.status} />,
    },
    ...(canManage
      ? [
          {
            field: 'actions',
            headerName: 'Actions',
            width: 100,
            sortable: false,
            align: 'right' as const,
            alwaysVisible: true,
            renderCell: (row: EquipmentSupplierDto) => (
              <RowActions>
                <EditAction
                  label={row.name}
                  onClick={() => {
                    setEditing(row);
                    setFormOpen(true);
                  }}
                />
                <DeleteAction
                  label={row.name}
                  disabled={(row.equipmentCount ?? 0) > 0}
                  tooltip={
                    (row.equipmentCount ?? 0) > 0
                      ? 'Still the supplier for equipment — deactivate instead'
                      : 'Delete'
                  }
                  onClick={() => setDeleting(row)}
                />
              </RowActions>
            ),
          },
        ]
      : []),
  ];

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      notify.success('Supplier deleted.');
    } catch (err) {
      notify.fromError(err);
    }
    setDeleting(null);
  }

  return (
    <>
      <PageHeader
        eyebrow="Equipment"
        title="Suppliers"
        subtitle="Who to ring when a machine stops. Call and WhatsApp on an asset reach whoever is linked here."
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <PlusIcon data-icon="inline-start" />
              New supplier
            </Button>
          ) : null
        }
      />

      <ListToolbar
        search={search}
        onSearchChange={(next) => {
          setSearch(next);
          setPage(1);
        }}
        activeFilterCount={filterCount}
        onClearFilters={() => {
          setStatus('');
          setCategoryId('');
          setPage(1);
        }}
        filters={
          <>
            <SelectField
              label="Status"
              value={status}
              onChange={(next) => {
                setStatus(next);
                setPage(1);
              }}
              emptyLabel="All statuses"
              options={enumOptions(MasterStatus)}
            />
            <SelectField
              label="Services category"
              value={categoryId}
              onChange={(next) => {
                setCategoryId(next);
                setPage(1);
              }}
              emptyLabel="Any category"
              options={(categories ?? []).map((category) => ({
                value: category.id,
                label: category.name,
              }))}
            />
          </>
        }
        view={view}
        onViewChange={setView}
        page={page}
        pageSize={pageSize}
        total={data?.meta.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        {...(canManage
          ? {
              onCreate: () => {
                setEditing(null);
                setFormOpen(true);
              },
              createLabel: 'New supplier',
            }
          : {})}
      />

      {view === 'table' ? (
        <DataTable
          gridId="equipment-suppliers"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filterCount > 0 || search.trim() !== ''}
          emptyTitle="No suppliers yet"
          emptyMessage="Add the people you already ring. Linking one to an asset makes Call and WhatsApp one tap."
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filterCount > 0 || search.trim() !== ''}
          emptyTitle="No suppliers yet"
          emptyMessage="Add the people you already ring."
          renderCard={(row) => (
            <div className="flex h-full flex-col gap-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-[0.9375rem] font-semibold">{row.name}</p>
                <StatusChip status={row.status} />
              </div>
              <p className="text-muted-foreground text-xs">
                {row.contactPerson ?? 'No contact person'} · {row.phone ?? 'No phone'}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {(row.categoryNames ?? []).join(', ') || 'No service categories'}
              </p>
              <div className="mt-auto flex gap-2">
                <Badge variant="outline">{row.equipmentCount ?? 0} assets</Badge>
                {(row.openTicketCount ?? 0) > 0 && (
                  <Badge variant="destructive">{row.openTicketCount} open</Badge>
                )}
              </div>
            </div>
          )}
        />
      )}

      <SupplierFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        editing={editing}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete supplier"
        message={`Delete ${deleting?.name}? Their call and message history stays on the equipment timelines.`}
        confirmLabel="Delete"
        danger
        loading={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function SupplierFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: EquipmentSupplierDto | null;
}): JSX.Element {
  const [name, setName] = useState(editing?.name ?? '');
  const [contactPerson, setContactPerson] = useState(editing?.contactPerson ?? '');
  const [phone, setPhone] = useState(editing?.phone ?? '');
  const [whatsapp, setWhatsapp] = useState(editing?.whatsapp ?? '');
  const [email, setEmail] = useState(editing?.email ?? '');
  const [serviceArea, setServiceArea] = useState(editing?.serviceArea ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [status, setStatus] = useState<MasterStatus>(editing?.status ?? MasterStatus.ACTIVE);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateSupplier();
  const update = useUpdateSupplier();
  const submitting = create.isPending || update.isPending;

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const body: EquipmentSupplierWriteRequest = {
      name,
      contactPerson: contactPerson || null,
      phone: phone || null,
      whatsapp: whatsapp || null,
      email: email || null,
      serviceArea: serviceArea || null,
      notes: notes || null,
      ...(editing ? { status } : {}),
    };

    try {
      if (editing) await update.mutateAsync({ id: editing.id, body });
      else await create.mutateAsync(body);
      notify.success('Supplier saved.');
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="equipment-supplier-form"
      title={editing ? `Edit supplier — ${editing.name}` : 'New supplier'}
      open={open}
      onClose={onClose}
      footer={<FormModalFooter formId={FORM_ID} onCancel={onClose} submitting={submitting} />}
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
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={LIMITS.SUPPLIER_NAME_MAX}
          />

          <TextField
            label="Contact person"
            value={contactPerson}
            onChange={(event) => setContactPerson(event.target.value)}
            maxLength={LIMITS.SUPPLIER_CONTACT_NAME_MAX}
          />

          <TextField
            label="Phone"
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            maxLength={LIMITS.SUPPLIER_PHONE_MAX}
          />

          <TextField
            label="WhatsApp"
            type="tel"
            helperText="Country code and number. Stored digits-only, which is what wa.me needs."
            value={whatsapp}
            onChange={(event) => setWhatsapp(event.target.value)}
            maxLength={LIMITS.SUPPLIER_PHONE_MAX}
          />

          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={LIMITS.SUPPLIER_EMAIL_MAX}
          />

          <TextField
            label="Service area"
            value={serviceArea}
            onChange={(event) => setServiceArea(event.target.value)}
            maxLength={LIMITS.SUPPLIER_SERVICE_AREA_MAX}
          />

          <TextField
            label="Notes"
            multiline
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={LIMITS.SUPPLIER_NOTES_MAX}
          />

          {editing && (
            <SelectField
              label="Status"
              helperText="Deactivate rather than delete one that still services equipment."
              value={status}
              onChange={(next) => setStatus(next as MasterStatus)}
              options={enumOptions(MasterStatus)}
            />
          )}
        </FieldGroup>
      </form>
    </Modal>
  );
}
