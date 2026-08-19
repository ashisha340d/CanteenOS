import { useMemo, useState } from 'react';
import { MasterStatus, type ModifierGroupDto } from '@menuboard/shared';
import { InfoIcon, PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/form/fields';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusChip } from '../../components/StatusChip';
import { useViewMode } from '../../components/DataTable/gridState';
import { useModifierGroups } from '../../hooks/useMenuMaster';
import { enumOptions } from '@/lib/options';
import { useNavigate } from 'react-router-dom';

export function ModifierAssignmentsPage(): JSX.Element {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MasterStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('modifier-assignments');

  const query = useMemo(
    () => ({ search: search || undefined, status: status || undefined, page, pageSize }),
    [search, status, page, pageSize],
  );
  const { data, isLoading } = useModifierGroups(query);
  const filtersActive = Boolean(status) || search.trim() !== '';

  const columns: DataTableColumn<ModifierGroupDto>[] = [
    { field: 'name', headerName: 'Modifier group', width: 260 },
    { field: 'selectionType', headerName: 'Selection', width: 120 },
    {
      field: 'modifiers',
      headerName: 'Modifiers',
      width: 120,
      sortable: false,
      renderCell: (r) => `${r.modifiers?.length ?? 0} item${r.modifiers?.length === 1 ? '' : 's'}`,
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 110,
      renderCell: (r) => <StatusChip status={r.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Menu"
        title="Modifier Assignments"
        subtitle="Modifier groups are assigned to menu items inside the Food Item Master. Choose a group to see its modifiers, then open the item to attach it."
        actions={
          <Button onClick={() => navigate('/menu-items')}>
            <PlusIcon className="size-4" />
            Assign on item
          </Button>
        }
      />

      <div className="mb-4 flex items-start gap-3 rounded-lg border bg-muted/50 p-3 text-sm">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-muted-foreground">
          This page shows the modifier groups available for assignment. To attach a group to a
          dish, open a menu item and add the modifier group in its form.
        </p>
      </div>

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
      />

      {view === 'table' ? (
        <DataTable
          gridId="modifier-assignments"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          filtered={filtersActive}
          emptyTitle="No modifier groups"
          emptyMessage="Create modifier groups first, then assign them to menu items."
          emptyAction={{ label: 'Go to modifiers', onClick: () => navigate('/menu-master?tab=modifiers') }}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          filtered={filtersActive}
          emptyTitle="No modifier groups"
          emptyMessage="Create modifier groups first, then assign them to menu items."
          emptyAction={{ label: 'Go to modifiers', onClick: () => navigate('/menu-master?tab=modifiers') }}
          renderCard={(r) => (
            <div className="flex h-full flex-col gap-2">
              <p className="font-semibold">{r.name}</p>
              <p className="text-muted-foreground text-sm">
                {r.modifiers?.length ?? 0} modifier{r.modifiers?.length === 1 ? '' : 's'}
              </p>
              <StatusChip status={r.status} />
            </div>
          )}
        />
      )}
    </>
  );
}
