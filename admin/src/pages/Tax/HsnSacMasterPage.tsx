import { useMemo, useState } from 'react';
import { Capability, HsnSacCodeType, type GstSyncRunDto, type HsnSacCodeDto } from '@menuboard/shared';
import { CloudDownloadIcon, DatabaseIcon, RefreshCwIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/form/fields';
import { StatTile } from '@/components/ui/StatTile';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { useAuth } from '../../services/AuthContext';
import { notify } from '@/lib/notify';
import {
  useGstSyncRuns,
  useHsnSacSearch,
  useHsnSacSummary,
  useSyncGstMaster,
} from '../../hooks/useTax';
import { TaxComplianceTabs } from './TaxComplianceTabs';

function formatDateTime(value: string | null): string {
  if (value === null) return 'Never';
  return new Date(value).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** The counters the specification requires a completed run to report. */
function SyncSummary({ run }: { run: GstSyncRunDto }): JSX.Element {
  const rows: [string, string | number][] = [
    ['Records Downloaded', run.recordsDownloaded.toLocaleString()],
    ['Records Added', run.recordsAdded.toLocaleString()],
    ['Records Updated', run.recordsUpdated.toLocaleString()],
    ['Records Deactivated', run.recordsDeactivated.toLocaleString()],
    ['Records Unchanged', run.recordsUnchanged.toLocaleString()],
    ['Records Failed', run.recordsFailed.toLocaleString()],
    ['Synchronization Time', formatDuration(run.durationMs)],
    ['Source', run.source],
    ['Source Version', run.sourceVersion ?? 'Not published by the source'],
  ];

  return (
    <Alert variant={run.status === 'FAILED' ? 'destructive' : 'default'} className="mb-6">
      <AlertTitle>
        {run.status === 'SUCCESS' ? 'Synchronization complete' : 'Synchronization failed'}
      </AlertTitle>
      <AlertDescription>
        <dl className="mt-2 grid w-full grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 text-sm">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {run.recordsFailed > 0 && (
          <p className="text-muted-foreground mt-2 text-xs">
            {run.recordsFailed} row(s) in the official file could not be used (duplicates or
            malformed codes) and were skipped. Everything else was applied.
          </p>
        )}
        {run.status === 'FAILED' && run.errorDetails && (
          <p className="mt-2 text-sm">{run.errorDetails}</p>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * The HSN/SAC classification master: read-only reference data whose only author is the
 * official GST/GSTN dataset. There is deliberately no create/edit/delete here — the single
 * write action is "Sync GST Master", and it is gated on TAX_SYNC.
 */
export function HsnSacMasterPage(): JSX.Element {
  const { hasCapability } = useAuth();
  const [search, setSearch] = useState('');
  const [codeType, setCodeType] = useState<HsnSacCodeType | ''>('');
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('hsn-sac-master');
  const [confirmSync, setConfirmSync] = useState(false);
  const [lastRun, setLastRun] = useState<GstSyncRunDto | null>(null);

  const query = useMemo(
    () => ({
      q: search || undefined,
      codeType: codeType || undefined,
      activeOnly: !showInactive,
      page,
      pageSize,
    }),
    [search, codeType, showInactive, page, pageSize],
  );

  const { data, isLoading } = useHsnSacSearch(query);
  const summary = useHsnSacSummary();
  const runs = useGstSyncRuns({ page: 1, pageSize: 5 });
  const sync = useSyncGstMaster();

  const canSync = hasCapability(Capability.TAX_SYNC);
  const filtersActive = Boolean(codeType) || showInactive || search.trim() !== '';
  const emptyMessage =
    summary.data?.totalCodes === 0
      ? 'The classification master is empty. Run "Sync GST Master" to import the official GST/GSTN dataset.'
      : 'No code or description matches this search.';

  async function runSync(): Promise<void> {
    setConfirmSync(false);
    try {
      const run = await sync.mutateAsync();
      setLastRun(run);
      notify.success(
        `Synchronized ${run.recordsDownloaded.toLocaleString()} records from ${run.source}.`,
      );
    } catch (err) {
      notify.fromError(err);
      setLastRun(null);
    }
  }

  const columns: DataTableColumn<HsnSacCodeDto>[] = [
    { field: 'code', headerName: 'Code', width: 130 },
    {
      field: 'codeType',
      headerName: 'Type',
      width: 90,
      renderCell: (r) => <Badge variant="outline">{r.codeType}</Badge>,
    },
    { field: 'description', headerName: 'Description', width: 520 },
    { field: 'chapter', headerName: 'Chapter', width: 100, valueGetter: (r) => r.chapter ?? '—' },
    { field: 'heading', headerName: 'Heading', width: 100, valueGetter: (r) => r.heading ?? '—' },
    {
      field: 'isActive',
      headerName: 'Status',
      width: 120,
      renderCell: (r) =>
        r.isActive ? (
          <Badge variant="outline">Active</Badge>
        ) : (
          <Badge variant="secondary">Deactivated</Badge>
        ),
    },
  ];

  const runColumns: DataTableColumn<GstSyncRunDto>[] = [
    {
      field: 'startedAt',
      headerName: 'Started',
      width: 200,
      valueGetter: (r) => formatDateTime(r.startedAt),
    },
    { field: 'startedByName', headerName: 'User', width: 160, valueGetter: (r) => r.startedByName ?? 'System' },
    { field: 'sourceVersion', headerName: 'Version', width: 120, valueGetter: (r) => r.sourceVersion ?? '—' },
    { field: 'recordsDownloaded', headerName: 'Downloaded', width: 120, align: 'right' },
    { field: 'recordsAdded', headerName: 'Added', width: 90, align: 'right' },
    { field: 'recordsUpdated', headerName: 'Updated', width: 100, align: 'right' },
    { field: 'recordsDeactivated', headerName: 'Deactivated', width: 120, align: 'right' },
    { field: 'recordsFailed', headerName: 'Failed', width: 90, align: 'right' },
    {
      field: 'durationMs',
      headerName: 'Time',
      width: 100,
      align: 'right',
      valueGetter: (r) => formatDuration(r.durationMs),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 110,
      renderCell: (r) => (
        <Badge variant={r.status === 'FAILED' ? 'destructive' : 'outline'}>{r.status}</Badge>
      ),
    },
  ];

  return (
    <>
      <TaxComplianceTabs
        active="hsn-sac"
        actions={
          canSync ? (
            <Button onClick={() => setConfirmSync(true)} disabled={sync.isPending}>
              {sync.isPending ? (
                <RefreshCwIcon className="animate-spin" />
              ) : (
                <CloudDownloadIcon />
              )}
              {sync.isPending ? 'Syncing…' : 'Sync GST Master'}
            </Button>
          ) : null
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Total Codes"
          value={(summary.data?.totalCodes ?? 0).toLocaleString()}
          hint={
            summary.data
              ? `${summary.data.hsnCodes.toLocaleString()} HSN · ${summary.data.sacCodes.toLocaleString()} SAC`
              : undefined
          }
          icon={<DatabaseIcon />}
        />
        <StatTile label="Last Synced" value={formatDateTime(summary.data?.lastSyncedAt ?? null)} />
        <StatTile
          label="Source"
          value={summary.data?.source ?? 'GST/GSTN'}
          hint={summary.data?.sourceVersion ? `Version ${summary.data.sourceVersion}` : 'No version published'}
        />
        <StatTile
          label="Status"
          value={summary.data?.lastSyncStatus === 'SUCCESS' ? 'Synced' : (summary.data?.lastSyncStatus ?? 'Never synced')}
          hint={
            summary.data && summary.data.inactiveCodes > 0
              ? `${summary.data.inactiveCodes.toLocaleString()} deactivated`
              : undefined
          }
          tone={summary.data?.lastSyncStatus === 'FAILED' ? 'danger' : 'neutral'}
          emphasis={summary.data?.lastSyncStatus === 'FAILED'}
        />
      </div>

      {lastRun && <SyncSummary run={lastRun} />}

      {!canSync && (
        <Alert className="mb-6">
          <AlertDescription>
            Only an administrator can synchronize the GST master. You can search and select
            classification codes, but not change them.
          </AlertDescription>
        </Alert>
      )}

      <ListToolbar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        activeFilterCount={(codeType ? 1 : 0) + (showInactive ? 1 : 0)}
        onClearFilters={() => {
          setCodeType('');
          setShowInactive(false);
          setPage(1);
        }}
        filters={
          <>
            <SelectField
              label="Type"
              value={codeType}
              onChange={(v) => {
                setCodeType(v as HsnSacCodeType | '');
                setPage(1);
              }}
              emptyLabel="HSN and SAC"
              options={[
                { value: HsnSacCodeType.HSN, label: 'HSN — Goods' },
                { value: HsnSacCodeType.SAC, label: 'SAC — Services' },
              ]}
            />
            <SelectField
              label="Include deactivated"
              value={showInactive ? 'yes' : 'no'}
              onChange={(v) => {
                setShowInactive(v === 'yes');
                setPage(1);
              }}
              options={[
                { value: 'no', label: 'Active codes only' },
                { value: 'yes', label: 'Include deactivated' },
              ]}
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
      />

      {view === 'table' ? (
        <DataTable
          gridId="hsn-sac-master"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          filtered={filtersActive}
          emptyTitle={summary.data?.totalCodes === 0 ? 'No HSN/SAC codes yet' : 'No matching codes'}
          emptyMessage={emptyMessage}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          filtered={filtersActive}
          emptyTitle={summary.data?.totalCodes === 0 ? 'No HSN/SAC codes yet' : 'No matching codes'}
          emptyMessage={emptyMessage}
          renderCard={(r) => (
            <div className="flex h-full flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="font-mono text-[0.9375rem] leading-snug font-semibold">{r.code}</p>
                <Badge variant={r.isActive ? 'outline' : 'secondary'}>
                  {r.isActive ? r.codeType : 'Deactivated'}
                </Badge>
              </div>
              <p className="text-muted-foreground flex-1 text-sm">{r.description}</p>
            </div>
          )}
        />
      )}

      <section className="mt-8">
        <h2 className="font-heading mb-3 text-base font-semibold">Recent synchronizations</h2>
        <DataTable
          gridId="gst-sync-runs"
          columns={runColumns}
          rows={runs.data?.items ?? []}
          getRowId={(r) => r.id}
          loading={runs.isLoading}
          emptyTitle="No synchronizations yet"
          emptyMessage="Every run is recorded here with its counts, source version and outcome."
        />
      </section>

      <ConfirmDialog
        open={confirmSync}
        title="Sync GST Master"
        message={
          'Download the latest official HSN/SAC classification dataset from GST/GSTN and apply it to the ' +
          'classification master. New codes are added, changed descriptions updated, and codes no longer ' +
          'published are deactivated — never deleted. Tax Profiles and Food Item tax treatment are NOT changed.'
        }
        confirmLabel="Sync now"
        loading={sync.isPending}
        onConfirm={runSync}
        onCancel={() => setConfirmSync(false)}
      />
    </>
  );
}
