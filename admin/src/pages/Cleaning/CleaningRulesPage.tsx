import { useMemo, useState } from 'react';
import {
  CLEANING_FREQUENCY_KIND_LABELS,
  Capability,
  CleaningFrequencyKind,
  CleaningRuleScope,
  type CleaningRuleDto,
} from '@menuboard/shared';
import { AlertTriangleIcon, PlayIcon, PlusIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/form/fields';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { TONE_CHIP_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/notify';
import { useAuth } from '../../services/AuthContext';
import { useCleaningRules, useCleaningSetup, useRunCleaningRule } from '../../hooks/useCleaning';
import { CLEANING_PRIORITY_TONE, formatDateTime } from './cleaningTone';
import { CleaningRuleFormModal } from './CleaningRuleFormModal';

/**
 * The checklists: what must be cleaned, how often, to what standard, by whom.
 *
 * The "needs attention" filter is the one that matters. A rule whose procedure was never
 * published, or which currently reaches no asset, looks entirely healthy in a list and does
 * nothing at all — so the page surfaces both as a warning on the row itself.
 */
export function CleaningRulesPage(): JSX.Element {
  const { hasCapability } = useAuth();
  const canManage = hasCapability(Capability.CLEANING_RULE_MANAGE);

  const [search, setSearch] = useState('');
  const [areaId, setAreaId] = useState('');
  const [frequencyKind, setFrequencyKind] = useState('');
  const [show, setShow] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('cleaning-rules');
  const [editing, setEditing] = useState<CleaningRuleDto | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: setup } = useCleaningSetup();
  const runRule = useRunCleaningRule();

  const query = useMemo(
    () => ({
      search: search || undefined,
      areaId: areaId || undefined,
      frequencyKind: (frequencyKind || undefined) as CleaningFrequencyKind | undefined,
      includeInactive: show === 'all' ? true : undefined,
      problemsOnly: show === 'problems' ? true : undefined,
      page,
      pageSize,
    }),
    [search, areaId, frequencyKind, show, page, pageSize],
  );

  const { data, isLoading } = useCleaningRules(query);

  const filterCount = (areaId ? 1 : 0) + (frequencyKind ? 1 : 0) + (show ? 1 : 0);
  const filtersActive = filterCount > 0 || search.trim() !== '';

  async function run(rule: CleaningRuleDto): Promise<void> {
    try {
      const result = await runRule.mutateAsync(rule.id);
      notify.success(
        result.tasks.length === 0
          ? 'Nothing was raised — the rule currently reaches no available asset.'
          : `${result.tasks.length} task${result.tasks.length === 1 ? '' : 's'} raised.`,
      );
    } catch (error) {
      notify.fromError(error);
    }
  }

  /** Why a rule cannot currently raise work, in one short phrase, or null when it can. */
  function problemWith(rule: CleaningRuleDto): string | null {
    if (rule.publishedVersionId === null || rule.publishedVersionId === undefined) {
      return 'procedure not published';
    }
    if (rule.targetAssetCount === 0) return 'reaches no asset';
    return null;
  }

  const columns: DataTableColumn<CleaningRuleDto>[] = [
    { field: 'code', headerName: 'Code', width: 150 },
    { field: 'taskName', headerName: 'Task', width: 220 },
    {
      field: 'scope',
      headerName: 'Applies to',
      width: 220,
      valueGetter: (row) =>
        row.scope === CleaningRuleScope.ASSET
          ? (row.cleanableAssetName ?? '—')
          : row.scope === CleaningRuleScope.ASSET_TYPE_IN_AREA
            ? `${row.assetTypeName ?? '—'} in ${row.areaName ?? '—'}`
            : `${row.assetTypeName ?? '—'} everywhere`,
    },
    {
      field: 'frequencyKind',
      headerName: 'How often',
      width: 160,
      valueGetter: (row) =>
        row.frequencyKind === CleaningFrequencyKind.PERIODIC
          ? `Every ${row.intervalDays ?? '?'} days`
          : CLEANING_FREQUENCY_KIND_LABELS[row.frequencyKind],
    },
    {
      field: 'procedureName',
      headerName: 'Procedure',
      width: 180,
      valueGetter: (row) => row.procedureName ?? '—',
    },
    {
      field: 'priority',
      headerName: 'Priority',
      width: 100,
      renderCell: (row) => <Chip tone={CLEANING_PRIORITY_TONE[row.priority]} label={row.priority} />,
    },
    {
      field: 'targetAssetCount',
      headerName: 'Targets',
      width: 100,
      align: 'right',
      valueGetter: (row) => row.targetAssetCount ?? '—',
    },
    {
      field: 'health',
      headerName: 'Health',
      width: 190,
      renderCell: (row) => {
        const problem = problemWith(row);
        if (!row.isActive) return <Chip tone="muted" label="Switched off" />;
        return problem === null ? (
          <Chip tone="success" label="Working" />
        ) : (
          <Chip tone="danger" label={problem} />
        );
      },
    },
    {
      field: 'lastGeneratedAt',
      headerName: 'Last raised',
      width: 160,
      valueGetter: (row) => formatDateTime(row.lastGeneratedAt),
    },
  ];

  return (
    <>
      <PageHeader
        title="Cleaning rules"
        meta={
          data && <span className="text-muted-foreground text-xs">{data.meta.total} rules</span>
        }
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon data-icon="inline-start" />
              New rule
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
          setAreaId('');
          setFrequencyKind('');
          setShow('');
          setPage(1);
        }}
        filters={
          <>
            <SelectField
              label="Show"
              value={show}
              onChange={(next) => {
                setShow(next);
                setPage(1);
              }}
              emptyLabel="Active rules"
              options={[
                { value: 'problems', label: 'Needs attention' },
                { value: 'all', label: 'Including switched off' },
              ]}
            />
            <SelectField
              label="Area"
              value={areaId}
              onChange={(next) => {
                setAreaId(next);
                setPage(1);
              }}
              emptyLabel="Everywhere"
              options={(setup?.areas ?? []).map((area) => ({ value: area.id, label: area.name }))}
            />
            <SelectField
              label="How often"
              value={frequencyKind}
              onChange={(next) => {
                setFrequencyKind(next);
                setPage(1);
              }}
              emptyLabel="Any frequency"
              options={Object.values(CleaningFrequencyKind).map((value) => ({
                value,
                label: CLEANING_FREQUENCY_KIND_LABELS[value],
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
        {...(canManage ? { onCreate: () => setCreating(true), createLabel: 'New rule' } : {})}
      />

      {view === 'table' ? (
        <DataTable
          gridId="cleaning-rules"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtersActive}
          onRowDoubleClick={(row) => canManage && setEditing(row)}
          emptyTitle="No cleaning rules yet"
          emptyMessage="A rule is what turns a procedure into work that appears on somebody's phone."
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
          onCardClick={(row) => canManage && setEditing(row)}
          emptyTitle="No cleaning rules yet"
          emptyMessage="A rule is what turns a procedure into work that appears on somebody's phone."
          renderCard={(row) => {
            const problem = problemWith(row);
            return (
              <div className="flex h-full flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-muted-foreground font-mono text-xs">{row.code}</span>
                  <Chip tone={CLEANING_PRIORITY_TONE[row.priority]} label={row.priority} />
                </div>
                <p className="text-[0.9375rem] leading-snug font-semibold">{row.taskName}</p>
                <p className="text-muted-foreground text-xs">
                  {CLEANING_FREQUENCY_KIND_LABELS[row.frequencyKind]} ·{' '}
                  {row.procedureName ?? 'no procedure'}
                </p>
                {problem !== null && row.isActive && (
                  <p className="text-tone-danger flex items-center gap-1 text-xs font-medium">
                    <AlertTriangleIcon className="size-3.5" />
                    {problem}
                  </p>
                )}
                <div className="mt-auto flex items-center justify-between gap-2">
                  <span className="text-muted-foreground text-xs">
                    {row.targetAssetCount ?? 0} target
                    {(row.targetAssetCount ?? 0) === 1 ? '' : 's'}
                  </span>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(event) => {
                        event.stopPropagation();
                        void run(row);
                      }}
                    >
                      <PlayIcon data-icon="inline-start" />
                      Run now
                    </Button>
                  )}
                </div>
              </div>
            );
          }}
        />
      )}

      <CleaningRuleFormModal
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        rule={editing}
        onRun={run}
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
