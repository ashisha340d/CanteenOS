import { useMemo, useState } from 'react';
import {
  CLEANING_RISK_LEVEL_LABELS,
  Capability,
  CleaningRiskLevel,
  FOOD_CONTACT_CLASS_LABELS,
  FoodContactClass,
  LIMITS,
  type CleanableAssetDto,
} from '@menuboard/shared';
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
import { notify } from '@/lib/notify';
import { useAuth } from '../../services/AuthContext';
import {
  useCleaningSetup,
  useCleanableAssets,
  useSetAssetAvailability,
} from '../../hooks/useCleaning';
import { FOOD_CONTACT_TONE, RISK_TONE, formatDateTime } from './cleaningTone';
import { CleanableAssetFormModal } from './CleanableAssetFormModal';
import { ReasonModal } from './ReasonModal';

/**
 * The register of things that get cleaned.
 *
 * The filter that earns its place is "no rule reaches it": an asset nothing schedules is the
 * module's commonest and least visible failure — it looks completely healthy until an auditor
 * asks when the drain was last done.
 */
export function CleanableAssetsPage(): JSX.Element {
  const { hasCapability } = useAuth();
  const canManage = hasCapability(Capability.CLEANING_ASSET_MANAGE);

  const [search, setSearch] = useState('');
  const [areaId, setAreaId] = useState('');
  const [assetTypeId, setAssetTypeId] = useState('');
  const [riskLevel, setRiskLevel] = useState('');
  const [foodContact, setFoodContact] = useState('');
  const [gap, setGap] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [view, setView] = useViewMode('cleaning-assets');
  const [editing, setEditing] = useState<CleanableAssetDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [takingOut, setTakingOut] = useState<CleanableAssetDto | null>(null);

  const { data: setup } = useCleaningSetup();
  const availability = useSetAssetAvailability();

  const query = useMemo(
    () => ({
      search: search || undefined,
      areaId: areaId || undefined,
      assetTypeId: assetTypeId || undefined,
      riskLevel: (riskLevel || undefined) as CleaningRiskLevel | undefined,
      foodContact: (foodContact || undefined) as FoodContactClass | undefined,
      withoutRules: gap === 'no-rules' ? true : undefined,
      availableOnly: gap === 'available' ? true : undefined,
      page,
      pageSize,
    }),
    [search, areaId, assetTypeId, riskLevel, foodContact, gap, page, pageSize],
  );

  const { data, isLoading } = useCleanableAssets(query);

  const filterCount =
    (areaId ? 1 : 0) + (assetTypeId ? 1 : 0) + (riskLevel ? 1 : 0) + (foodContact ? 1 : 0) + (gap ? 1 : 0);
  const filtersActive = filterCount > 0 || search.trim() !== '';

  /**
   * Putting an asset back needs no explanation; taking one out does, because the scheduler
   * stops raising work for it and somebody has to be able to find out why months later.
   */
  async function toggleAvailability(asset: CleanableAssetDto): Promise<void> {
    if (!asset.isAvailable) {
      await setAvailability(asset, true, null);
      return;
    }
    setTakingOut(asset);
  }

  async function setAvailability(
    asset: CleanableAssetDto,
    isAvailable: boolean,
    reason: string | null,
  ): Promise<void> {
    try {
      await availability.mutateAsync({
        id: asset.id,
        body: { isAvailable, ...(reason !== null ? { reason } : {}) },
      });
      notify.success(isAvailable ? 'Back in service.' : 'Taken out of service.');
    } catch (error) {
      notify.fromError(error);
    }
  }

  const columns: DataTableColumn<CleanableAssetDto>[] = [
    { field: 'code', headerName: 'Code', width: 160 },
    { field: 'name', headerName: 'Name', width: 220 },
    {
      field: 'assetTypeName',
      headerName: 'Type',
      width: 150,
      valueGetter: (row) => row.assetTypeName ?? '—',
    },
    {
      field: 'locationPath',
      headerName: 'Where',
      width: 200,
      valueGetter: (row) => row.locationPath ?? '—',
    },
    {
      field: 'riskLevel',
      headerName: 'Risk',
      width: 100,
      renderCell: (row) => (
        <Chip tone={RISK_TONE[row.riskLevel]} label={CLEANING_RISK_LEVEL_LABELS[row.riskLevel]} />
      ),
    },
    {
      field: 'foodContact',
      headerName: 'Food contact',
      width: 150,
      renderCell: (row) => (
        <Chip
          tone={FOOD_CONTACT_TONE[row.foodContact]}
          label={FOOD_CONTACT_CLASS_LABELS[row.foodContact]}
        />
      ),
    },
    {
      field: 'ruleCount',
      headerName: 'Rules',
      width: 90,
      align: 'right',
      renderCell: (row) =>
        (row.ruleCount ?? 0) === 0 ? (
          <Chip tone="progress" label="none" />
        ) : (
          <span className="tabular-nums">{row.ruleCount}</span>
        ),
    },
    {
      field: 'openTaskCount',
      headerName: 'Open',
      width: 90,
      align: 'right',
      valueGetter: (row) => row.openTaskCount ?? 0,
    },
    {
      field: 'lastCleanedAt',
      headerName: 'Last cleaned',
      width: 160,
      valueGetter: (row) => formatDateTime(row.lastCleanedAt),
    },
    {
      field: 'isAvailable',
      headerName: 'In service',
      width: 120,
      renderCell: (row) =>
        row.isAvailable ? (
          <Chip tone="success" label="Yes" />
        ) : (
          <Chip tone="muted" label={row.unavailableReason ?? 'Out of use'} />
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Cleanable assets"
        meta={
          data && (
            <span className="text-muted-foreground text-xs">
              {data.meta.total} registered
            </span>
          )
        }
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon data-icon="inline-start" />
              Register
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
          setAssetTypeId('');
          setRiskLevel('');
          setFoodContact('');
          setGap('');
          setPage(1);
        }}
        filters={
          <>
            <SelectField
              label="Show"
              value={gap}
              onChange={(next) => {
                setGap(next);
                setPage(1);
              }}
              emptyLabel="Everything"
              options={[
                { value: 'no-rules', label: 'Nothing schedules it' },
                { value: 'available', label: 'In service only' },
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
              label="Type"
              value={assetTypeId}
              onChange={(next) => {
                setAssetTypeId(next);
                setPage(1);
              }}
              emptyLabel="Any type"
              options={(setup?.assetTypes ?? []).map((type) => ({
                value: type.id,
                label: type.name,
              }))}
            />
            <SelectField
              label="Risk"
              value={riskLevel}
              onChange={(next) => {
                setRiskLevel(next);
                setPage(1);
              }}
              emptyLabel="Any risk"
              options={Object.values(CleaningRiskLevel).map((value) => ({
                value,
                label: CLEANING_RISK_LEVEL_LABELS[value],
              }))}
            />
            <SelectField
              label="Food contact"
              value={foodContact}
              onChange={(next) => {
                setFoodContact(next);
                setPage(1);
              }}
              emptyLabel="Any"
              options={Object.values(FoodContactClass).map((value) => ({
                value,
                label: FOOD_CONTACT_CLASS_LABELS[value],
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
        {...(canManage ? { onCreate: () => setCreating(true), createLabel: 'Register' } : {})}
      />

      {view === 'table' ? (
        <DataTable
          gridId="cleaning-assets"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtersActive}
          onRowDoubleClick={(row) => canManage && setEditing(row)}
          emptyTitle="Nothing registered yet"
          emptyMessage="Register the surfaces, machines and areas that get cleaned."
          {...(canManage
            ? { emptyAction: { label: 'Register one', onClick: () => setCreating(true) } }
            : {})}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filtersActive}
          onCardClick={(row) => canManage && setEditing(row)}
          emptyTitle="Nothing registered yet"
          emptyMessage="Register the surfaces, machines and areas that get cleaned."
          renderCard={(row) => (
            <div className="flex h-full flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <span className="text-muted-foreground font-mono text-xs">{row.code}</span>
                <Chip
                  tone={RISK_TONE[row.riskLevel]}
                  label={CLEANING_RISK_LEVEL_LABELS[row.riskLevel]}
                />
              </div>
              <p className="text-[0.9375rem] leading-snug font-semibold">{row.name}</p>
              <p className="text-muted-foreground text-xs">{row.locationPath ?? '—'}</p>
              <div className="mt-auto flex items-center justify-between gap-2">
                <Chip
                  tone={FOOD_CONTACT_TONE[row.foodContact]}
                  label={FOOD_CONTACT_CLASS_LABELS[row.foodContact]}
                />
                <span className="text-muted-foreground text-xs">
                  {(row.ruleCount ?? 0) === 0 ? 'no rule' : `${row.ruleCount} rules`}
                </span>
              </div>
              {canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleAvailability(row);
                  }}
                >
                  {row.isAvailable ? 'Take out of service' : 'Back in service'}
                </Button>
              )}
            </div>
          )}
        />
      )}

      <ReasonModal
        open={takingOut !== null}
        title="Take it out of service"
        description={takingOut?.name}
        placeholder="Being rebuilt until the end of the month"
        confirmLabel="Take it out"
        maxLength={LIMITS.CLEANABLE_ASSET_UNAVAILABLE_REASON_MAX}
        submitting={availability.isPending}
        onClose={() => setTakingOut(null)}
        onConfirm={(reason) => {
          const asset = takingOut;
          setTakingOut(null);
          if (asset !== null) void setAvailability(asset, false, reason);
        }}
      />

      <CleanableAssetFormModal
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        asset={editing}
        onToggleAvailability={toggleAvailability}
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
