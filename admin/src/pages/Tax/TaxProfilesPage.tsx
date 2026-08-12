import { useMemo, useState } from 'react';
import { Capability, MasterStatus, type TaxProfileDto } from '@menuboard/shared';
import { PlusIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/form/fields';
import { DeleteAction, EditAction, RowActions } from '@/components/RowActions';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { StatusChip } from '../../components/StatusChip';
import { useAuth } from '../../services/AuthContext';
import { useDeleteTaxProfile, useTaxProfiles } from '../../hooks/useTax';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { TaxComplianceTabs } from './TaxComplianceTabs';
import { TaxProfileFormModal } from './TaxProfileFormModal';

const percent = (value: number): string => `${Number(value).toFixed(2).replace(/\.00$/, '')}%`;

export function TaxProfilesPage(): JSX.Element {
  const { hasCapability } = useAuth();
  const canWrite = hasCapability(Capability.TAX_WRITE);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MasterStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('tax-profiles');
  const [editing, setEditing] = useState<TaxProfileDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<TaxProfileDto | null>(null);

  const query = useMemo(
    () => ({ search: search || undefined, status: status || undefined, page, pageSize }),
    [search, status, page, pageSize],
  );
  const { data, isLoading } = useTaxProfiles(query);
  const del = useDeleteTaxProfile();
  const filtersActive = Boolean(status) || search.trim() !== '';

  const columns: DataTableColumn<TaxProfileDto>[] = [
    { field: 'name', headerName: 'Profile', width: 220 },
    { field: 'code', headerName: 'Code', width: 140 },
    {
      field: 'hsnSacCode',
      headerName: 'HSN / SAC',
      width: 160,
      renderCell: (r) =>
        r.hsnSacCode ? (
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-sm">{r.hsnSacCode}</span>
            <Badge variant="outline" className="text-[0.625rem]">
              {r.hsnSacCodeType}
            </Badge>
          </span>
        ) : (
          '—'
        ),
    },
    { field: 'supplyType', headerName: 'Supply', width: 110 },
    { field: 'gstTaxability', headerName: 'Taxability', width: 120 },
    { field: 'gstRate', headerName: 'GST', width: 90, align: 'right', valueGetter: (r) => percent(r.gstRate) },
    { field: 'cgstRate', headerName: 'CGST', width: 90, align: 'right', valueGetter: (r) => percent(r.cgstRate) },
    { field: 'sgstRate', headerName: 'SGST', width: 90, align: 'right', valueGetter: (r) => percent(r.sgstRate) },
    { field: 'igstRate', headerName: 'IGST', width: 90, align: 'right', valueGetter: (r) => percent(r.igstRate) },
    { field: 'cessRate', headerName: 'Cess', width: 90, align: 'right', valueGetter: (r) => percent(r.cessRate) },
    {
      field: 'priceIsInclusive',
      headerName: 'Pricing',
      width: 110,
      valueGetter: (r) => (r.priceIsInclusive ? 'Inclusive' : 'Exclusive'),
    },
    {
      field: 'foodItemCount',
      headerName: 'Food items',
      width: 110,
      align: 'right',
      valueGetter: (r) => r.foodItemCount ?? 0,
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 110,
      renderCell: (r) => <StatusChip status={r.status} />,
    },
    ...(canWrite
      ? [
          {
            field: 'actions',
            headerName: 'Actions',
            width: 100,
            sortable: false,
            align: 'right' as const,
            alwaysVisible: true,
            renderCell: (r: TaxProfileDto) => (
              <RowActions>
                <EditAction label={r.name} onClick={() => setEditing(r)} />
                <DeleteAction
                  label={r.name}
                  tooltip="Delete — refused while any food item or variant still uses this profile"
                  onClick={() => setDeleting(r)}
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
      await del.mutateAsync(deleting.id);
      notify.success('Tax profile deleted.');
    } catch (err) {
      notify.fromError(err);
    }
    setDeleting(null);
  }

  return (
    <>
      <TaxComplianceTabs
        active="tax-profiles"
        actions={
          canWrite ? (
            <Button onClick={() => setEditing(null)}>
              <PlusIcon />
              New tax profile
            </Button>
          ) : null
        }
      />

      <ListToolbar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        activeFilterCount={status ? 1 : 0}
        onClearFilters={() => {
          setStatus('');
          setPage(1);
        }}
        filters={
          <SelectField
            label="Status"
            value={status}
            onChange={(v) => {
              setStatus(v as MasterStatus | '');
              setPage(1);
            }}
            emptyLabel="All statuses"
            options={enumOptions(MasterStatus)}
          />
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
        {...(canWrite ? { onCreate: () => setEditing(null), createLabel: 'New tax profile' } : {})}
      />

      {view === 'table' ? (
        <DataTable
          gridId="tax-profiles"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onRowDoubleClick={canWrite ? (r) => setEditing(r) : undefined}
          filtered={filtersActive}
          emptyTitle="No tax profiles yet"
          emptyMessage="A tax profile is a reusable tax treatment — e.g. Restaurant Service 5% citing SAC 996331. Food items assign a profile rather than carrying rates of their own."
          {...(canWrite
            ? { emptyAction: { label: 'New tax profile', onClick: () => setEditing(null) } }
            : {})}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onCardDoubleClick={canWrite ? (r) => setEditing(r) : undefined}
          filtered={filtersActive}
          emptyTitle="No tax profiles yet"
          emptyMessage="A tax profile is a reusable tax treatment — e.g. Restaurant Service 5% citing SAC 996331."
          {...(canWrite
            ? { emptyAction: { label: 'New tax profile', onClick: () => setEditing(null) } }
            : {})}
          renderCard={(r) => (
            <div className="flex h-full flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-[0.9375rem] leading-snug font-semibold">{r.name}</p>
                <StatusChip status={r.status} />
              </div>
              <p className="text-muted-foreground text-sm">
                {r.hsnSacCode ? `${r.hsnSacCodeType} ${r.hsnSacCode}` : 'No classification'} ·{' '}
                {percent(r.gstRate)} GST
              </p>
              <p className="text-muted-foreground flex-1 text-xs">
                CGST {percent(r.cgstRate)} · SGST {percent(r.sgstRate)} · IGST {percent(r.igstRate)}
                {r.cessRate > 0 ? ` · Cess ${percent(r.cessRate)}` : ''}
              </p>
            </div>
          )}
        />
      )}

      {editing !== undefined && (
        <TaxProfileFormModal
          open={editing !== undefined}
          editing={editing}
          onClose={() => setEditing(undefined)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete tax profile"
        message={`Delete "${deleting?.name}"? This is refused while any food item or variant still uses it — deactivate it instead so existing assignments keep working.`}
        confirmLabel="Delete"
        danger
        loading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
