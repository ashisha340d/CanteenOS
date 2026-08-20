import { useMemo, useState } from 'react';
import { Capability, type CleaningProcedureDto } from '@menuboard/shared';
import { PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/form/fields';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { TONE_CHIP_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { useAuth } from '../../services/AuthContext';
import { useCleaningProcedures } from '../../hooks/useCleaning';
import { formatDateTime } from './cleaningTone';
import { ProcedureEditorModal } from './ProcedureEditorModal';

/**
 * The SOPs a cleaning task tells its operator to follow.
 *
 * The list leads with publication state because that is the only thing about a procedure that
 * changes what the system does: a procedure with no published version cannot be attached to a
 * rule, and a rule pointing at one raises nothing.
 */
export function CleaningProceduresPage(): JSX.Element {
  const { hasCapability } = useAuth();
  const canManage = hasCapability(Capability.CLEANING_PROCEDURE_MANAGE);

  const [search, setSearch] = useState('');
  const [show, setShow] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('cleaning-procedures');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const query = useMemo(
    () => ({
      search: search || undefined,
      includeInactive: show === 'all' ? true : undefined,
      publishedOnly: show === 'published' ? true : undefined,
      page,
      pageSize,
    }),
    [search, show, page, pageSize],
  );

  const { data, isLoading } = useCleaningProcedures(query);
  const filtersActive = show !== '' || search.trim() !== '';

  const columns: DataTableColumn<CleaningProcedureDto>[] = [
    { field: 'code', headerName: 'Code', width: 160 },
    { field: 'name', headerName: 'Name', width: 240 },
    {
      field: 'currentVersion',
      headerName: 'In force',
      width: 140,
      renderCell: (row) =>
        row.currentVersion === null ? (
          <Chip tone="danger" label="Never published" />
        ) : (
          <Chip tone="success" label={`v${row.currentVersion}`} />
        ),
    },
    {
      field: 'hasDraft',
      headerName: 'Draft',
      width: 110,
      renderCell: (row) =>
        row.hasDraft === true ? <Chip tone="progress" label="Open" /> : <span>—</span>,
    },
    {
      field: 'ruleCount',
      headerName: 'Used by',
      width: 110,
      align: 'right',
      valueGetter: (row) => `${row.ruleCount ?? 0} rules`,
    },
    {
      field: 'versionCount',
      headerName: 'Versions',
      width: 100,
      align: 'right',
      valueGetter: (row) => row.versionCount ?? 0,
    },
    {
      field: 'updatedAt',
      headerName: 'Updated',
      width: 160,
      valueGetter: (row) => formatDateTime(row.updatedAt),
    },
  ];

  return (
    <>
      <PageHeader
        title="Cleaning procedures"
        meta={
          data && (
            <span className="text-muted-foreground text-xs">{data.meta.total} procedures</span>
          )
        }
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon data-icon="inline-start" />
              New procedure
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
        activeFilterCount={show === '' ? 0 : 1}
        onClearFilters={() => {
          setShow('');
          setPage(1);
        }}
        filters={
          <SelectField
            label="Show"
            value={show}
            onChange={(next) => {
              setShow(next);
              setPage(1);
            }}
            emptyLabel="Active procedures"
            options={[
              { value: 'published', label: 'Published only' },
              { value: 'all', label: 'Including retired' },
            ]}
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
        {...(canManage ? { onCreate: () => setCreating(true), createLabel: 'New' } : {})}
      />

      {view === 'table' ? (
        <DataTable
          gridId="cleaning-procedures"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtersActive}
          onRowDoubleClick={(row) => setOpenId(row.id)}
          emptyTitle="No procedures yet"
          emptyMessage="A procedure is the numbered list of steps a cleaner actually follows."
          {...(canManage
            ? { emptyAction: { label: 'Write one', onClick: () => setCreating(true) } }
            : {})}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtersActive}
          onCardClick={(row) => setOpenId(row.id)}
          emptyTitle="No procedures yet"
          emptyMessage="A procedure is the numbered list of steps a cleaner actually follows."
          renderCard={(row) => (
            <div className="flex h-full flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <span className="text-muted-foreground font-mono text-xs">{row.code}</span>
                {row.currentVersion === null ? (
                  <Chip tone="danger" label="Not published" />
                ) : (
                  <Chip tone="success" label={`v${row.currentVersion}`} />
                )}
              </div>
              <p className="text-[0.9375rem] leading-snug font-semibold">{row.name}</p>
              {row.description !== null && (
                <p className="text-muted-foreground line-clamp-2 text-xs">{row.description}</p>
              )}
              <div className="mt-auto flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">
                  {row.ruleCount ?? 0} rule{(row.ruleCount ?? 0) === 1 ? '' : 's'}
                </span>
                {row.hasDraft === true && <Chip tone="progress" label="Draft open" />}
              </div>
            </div>
          )}
        />
      )}

      <ProcedureEditorModal
        open={creating || openId !== null}
        onClose={() => {
          setCreating(false);
          setOpenId(null);
        }}
        procedureId={openId}
      />
    </>
  );
}

function Chip({ tone, label }: { tone: keyof typeof TONE_CHIP_CLASS; label: string }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold whitespace-nowrap',
        TONE_CHIP_CLASS[tone],
      )}
    >
      {label}
    </span>
  );
}
