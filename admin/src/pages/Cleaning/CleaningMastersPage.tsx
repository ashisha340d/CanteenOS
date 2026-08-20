import { useState } from 'react';
import {
  CLEANING_CHEMICAL_KIND_LABELS,
  CLEANING_RISK_LEVEL_LABELS,
  CLEANING_TOOL_KIND_LABELS,
  Capability,
  CleaningChemicalKind,
  CleaningRiskLevel,
  CleaningToolKind,
  FOOD_CONTACT_CLASS_LABELS,
  FoodContactClass,
  LIMITS,
  type CleanableAssetTypeDto,
  type CleaningChemicalDto,
  type CleaningMethodDto,
  type CleaningStandardDto,
  type CleaningToolDto,
} from '@menuboard/shared';
import { PlusIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldGroup, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { TONE_CHIP_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/notify';
import { readError } from '../../services/errorMessage';
import { useAuth } from '../../services/AuthContext';
import {
  useCleaningAssetTypes,
  useCleaningChemicals,
  useCleaningMethods,
  useCleaningStandards,
  useCleaningTools,
  useCreateAssetType,
  useCreateChemical,
  useCreateMethod,
  useCreateStandard,
  useCreateTool,
  useUpdateAssetType,
  useUpdateChemical,
  useUpdateMethod,
  useUpdateStandard,
  useUpdateTool,
} from '../../hooks/useCleaning';
import { FOOD_CONTACT_TONE, RISK_TONE, formatDate } from './cleaningTone';

/**
 * The five reference tables the module runs on: what kinds of thing get cleaned, how, to what
 * standard, with what, and using which tool.
 *
 * One page with five tabs rather than five nav entries, because to an administrator this is one
 * job — "set up cleaning" — done once and revisited rarely.
 */
export function CleaningMastersPage(): JSX.Element {
  const { hasCapability } = useAuth();
  const canManageAssets = hasCapability(Capability.CLEANING_ASSET_MANAGE);
  const canManageProcedures = hasCapability(Capability.CLEANING_PROCEDURE_MANAGE);
  const canManageChemicals = hasCapability(Capability.CLEANING_CHEMICAL_MANAGE);

  return (
    <>
      <PageHeader title="Cleaning masters" />
      <Tabs defaultValue="types" className="flex min-h-0 flex-col gap-3">
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="types">Asset types</TabsTrigger>
          <TabsTrigger value="chemicals">Chemicals</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="methods">Methods</TabsTrigger>
          <TabsTrigger value="standards">Standards</TabsTrigger>
        </TabsList>

        <TabsContent value="types" className="mt-0">
          <AssetTypesTab canManage={canManageAssets} />
        </TabsContent>
        <TabsContent value="chemicals" className="mt-0">
          <ChemicalsTab canManage={canManageChemicals} />
        </TabsContent>
        <TabsContent value="tools" className="mt-0">
          <ToolsTab canManage={canManageChemicals} />
        </TabsContent>
        <TabsContent value="methods" className="mt-0">
          <MethodsTab canManage={canManageProcedures} />
        </TabsContent>
        <TabsContent value="standards" className="mt-0">
          <StandardsTab canManage={canManageProcedures} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/* ------------------------------------------------------------------ asset types */

function AssetTypesTab({ canManage }: { canManage: boolean }): JSX.Element {
  const { data, isLoading } = useCleaningAssetTypes({ includeInactive: true });
  const create = useCreateAssetType();
  const update = useUpdateAssetType();
  const [editing, setEditing] = useState<CleanableAssetTypeDto | null>(null);
  const [open, setOpen] = useState(false);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [risk, setRisk] = useState<string>(CleaningRiskLevel.MEDIUM);
  const [contact, setContact] = useState<string>(FoodContactClass.NON_FOOD);
  const [error, setError] = useState<string | null>(null);

  function start(row: CleanableAssetTypeDto | null): void {
    setEditing(row);
    setCode(row?.code ?? '');
    setName(row?.name ?? '');
    setRisk(row?.defaultRiskLevel ?? CleaningRiskLevel.MEDIUM);
    setContact(row?.defaultFoodContact ?? FoodContactClass.NON_FOOD);
    setError(null);
    setOpen(true);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const body = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        defaultRiskLevel: risk as CleaningRiskLevel,
        defaultFoodContact: contact as FoodContactClass,
      };
      if (editing === null) await create.mutateAsync(body);
      else await update.mutateAsync({ id: editing.id, body });
      notify.success('Saved.');
      setOpen(false);
    } catch (err) {
      setError(readError(err).message);
    }
  }

  const columns: DataTableColumn<CleanableAssetTypeDto>[] = [
    { field: 'code', headerName: 'Code', width: 180 },
    { field: 'name', headerName: 'Name', width: 220 },
    {
      field: 'defaultRiskLevel',
      headerName: 'Default risk',
      width: 130,
      renderCell: (row) => (
        <Chip
          tone={RISK_TONE[row.defaultRiskLevel]}
          label={CLEANING_RISK_LEVEL_LABELS[row.defaultRiskLevel]}
        />
      ),
    },
    {
      field: 'defaultFoodContact',
      headerName: 'Default food contact',
      width: 180,
      renderCell: (row) => (
        <Chip
          tone={FOOD_CONTACT_TONE[row.defaultFoodContact]}
          label={FOOD_CONTACT_CLASS_LABELS[row.defaultFoodContact]}
        />
      ),
    },
    {
      field: 'assetCount',
      headerName: 'Assets',
      width: 100,
      align: 'right',
      valueGetter: (row) => row.assetCount ?? 0,
    },
    { field: 'status', headerName: 'Status', width: 110 },
  ];

  return (
    <MasterTab
      title="Asset types"
      hint="What kind of thing this is. The type carries the defaults an asset inherits."
      canManage={canManage}
      onCreate={() => start(null)}
      gridId="cleaning-asset-types"
      columns={columns}
      rows={data ?? []}
      loading={isLoading}
      onRowDoubleClick={(row) => canManage && start(row)}
      modal={
        <Modal
          id="cleaning-asset-type"
          title={editing === null ? 'New asset type' : editing.name}
          open={open}
          onClose={() => setOpen(false)}
          footer={
            <FormModalFooter
              formId="asset-type-form"
              onCancel={() => setOpen(false)}
              submitting={create.isPending || update.isPending}
            />
          }
        >
          <form id="asset-type-form" onSubmit={submit}>
            <FieldGroup>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <TextField
                label="Code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                maxLength={LIMITS.CLEANABLE_ASSET_TYPE_CODE_MAX}
                disabled={editing !== null}
              />
              <TextField
                label="Name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={LIMITS.CLEANABLE_ASSET_TYPE_NAME_MAX}
              />
              <SelectField
                label="Default risk"
                value={risk}
                onChange={setRisk}
                options={Object.values(CleaningRiskLevel).map((value) => ({
                  value,
                  label: CLEANING_RISK_LEVEL_LABELS[value],
                }))}
              />
              <SelectField
                label="Default food contact"
                value={contact}
                onChange={setContact}
                options={Object.values(FoodContactClass).map((value) => ({
                  value,
                  label: FOOD_CONTACT_CLASS_LABELS[value],
                }))}
              />
            </FieldGroup>
          </form>
        </Modal>
      }
    />
  );
}

/* -------------------------------------------------------------------- chemicals */

function ChemicalsTab({ canManage }: { canManage: boolean }): JSX.Element {
  const { data, isLoading } = useCleaningChemicals({ includeInactive: true });
  const create = useCreateChemical();
  const update = useUpdateChemical();
  const [editing, setEditing] = useState<CleaningChemicalDto | null>(null);
  const [open, setOpen] = useState(false);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<string>(CleaningChemicalKind.DETERGENT);
  const [dilution, setDilution] = useState('');
  const [ppm, setPpm] = useState('');
  const [contactSeconds, setContactSeconds] = useState('');
  const [safety, setSafety] = useState('');
  const [expiry, setExpiry] = useState('');
  const [error, setError] = useState<string | null>(null);

  function start(row: CleaningChemicalDto | null): void {
    setEditing(row);
    setCode(row?.code ?? '');
    setName(row?.name ?? '');
    setKind(row?.chemicalKind ?? CleaningChemicalKind.DETERGENT);
    setDilution(row?.dilutionRatio ?? '');
    setPpm(row?.concentrationPpm === null || row === null ? '' : String(row.concentrationPpm));
    setContactSeconds(
      row?.contactTimeSeconds === null || row === null ? '' : String(row.contactTimeSeconds),
    );
    setSafety(row?.safetyInformation ?? '');
    setExpiry(row?.expiryDate ?? '');
    setError(null);
    setOpen(true);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const body = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        chemicalKind: kind as CleaningChemicalKind,
        dilutionRatio: dilution.trim() === '' ? null : dilution.trim(),
        concentrationPpm: ppm === '' ? null : Number(ppm),
        contactTimeSeconds: contactSeconds === '' ? null : Number(contactSeconds),
        safetyInformation: safety.trim() === '' ? null : safety.trim(),
        expiryDate: expiry === '' ? null : expiry,
      };
      if (editing === null) await create.mutateAsync(body);
      else await update.mutateAsync({ id: editing.id, body });
      notify.success('Saved.');
      setOpen(false);
    } catch (err) {
      setError(readError(err).message);
    }
  }

  const columns: DataTableColumn<CleaningChemicalDto>[] = [
    { field: 'code', headerName: 'Code', width: 150 },
    { field: 'name', headerName: 'Name', width: 200 },
    {
      field: 'chemicalKind',
      headerName: 'Kind',
      width: 140,
      valueGetter: (row) => CLEANING_CHEMICAL_KIND_LABELS[row.chemicalKind],
    },
    {
      field: 'dilutionRatio',
      headerName: 'Dilution',
      width: 120,
      valueGetter: (row) => row.dilutionRatio ?? '—',
    },
    {
      field: 'concentrationPpm',
      headerName: 'ppm',
      width: 90,
      align: 'right',
      valueGetter: (row) => row.concentrationPpm ?? '—',
    },
    {
      field: 'expiryDate',
      headerName: 'Expires',
      width: 140,
      renderCell: (row) =>
        row.isExpired ? (
          <Chip tone="danger" label={formatDate(row.expiryDate)} />
        ) : (
          <span>{formatDate(row.expiryDate)}</span>
        ),
    },
    { field: 'status', headerName: 'Status', width: 110 },
  ];

  return (
    <MasterTab
      title="Chemicals"
      hint="What is used, at what strength, for how long. A step can name one directly."
      canManage={canManage}
      onCreate={() => start(null)}
      gridId="cleaning-chemicals"
      columns={columns}
      rows={data ?? []}
      loading={isLoading}
      onRowDoubleClick={(row) => canManage && start(row)}
      modal={
        <Modal
          id="cleaning-chemical"
          title={editing === null ? 'New chemical' : editing.name}
          open={open}
          onClose={() => setOpen(false)}
          footer={
            <FormModalFooter
              formId="chemical-form"
              onCancel={() => setOpen(false)}
              submitting={create.isPending || update.isPending}
            />
          }
        >
          <form id="chemical-form" onSubmit={submit}>
            <FieldGroup>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <TextField
                label="Code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                maxLength={LIMITS.CLEANING_CHEMICAL_CODE_MAX}
                disabled={editing !== null}
              />
              <TextField
                label="Name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={LIMITS.CLEANING_CHEMICAL_NAME_MAX}
              />
              <SelectField
                label="Kind"
                value={kind}
                onChange={setKind}
                options={Object.values(CleaningChemicalKind).map((value) => ({
                  value,
                  label: CLEANING_CHEMICAL_KIND_LABELS[value],
                }))}
              />
              <TextField
                label="Dilution"
                placeholder="1:100"
                value={dilution}
                onChange={(event) => setDilution(event.target.value)}
                maxLength={LIMITS.CLEANING_CHEMICAL_DILUTION_MAX}
              />
              <TextField
                label="Concentration (ppm)"
                type="number"
                min={0}
                max={LIMITS.CLEANING_CONCENTRATION_PPM_MAX}
                value={ppm}
                onChange={(event) => setPpm(event.target.value)}
              />
              <TextField
                label="Contact time (seconds)"
                type="number"
                min={0}
                max={LIMITS.CLEANING_CONTACT_SECONDS_MAX}
                helperText="How long it must stay wet on the surface to work."
                value={contactSeconds}
                onChange={(event) => setContactSeconds(event.target.value)}
              />
              <TextField
                label="Safety information"
                multiline
                rows={3}
                value={safety}
                onChange={(event) => setSafety(event.target.value)}
                maxLength={LIMITS.CLEANING_CHEMICAL_SAFETY_MAX}
              />
              <TextField
                label="Expires"
                type="date"
                value={expiry}
                onChange={(event) => setExpiry(event.target.value)}
              />
            </FieldGroup>
          </form>
        </Modal>
      }
    />
  );
}

/* ------------------------------------------------------------------------ tools */

function ToolsTab({ canManage }: { canManage: boolean }): JSX.Element {
  const { data, isLoading } = useCleaningTools({ includeInactive: true });
  const create = useCreateTool();
  const update = useUpdateTool();
  const [editing, setEditing] = useState<CleaningToolDto | null>(null);
  const [open, setOpen] = useState(false);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<string>(CleaningToolKind.CLOTH);
  const [colour, setColour] = useState('');
  const [storage, setStorage] = useState('');
  const [error, setError] = useState<string | null>(null);

  function start(row: CleaningToolDto | null): void {
    setEditing(row);
    setCode(row?.code ?? '');
    setName(row?.name ?? '');
    setKind(row?.toolKind ?? CleaningToolKind.CLOTH);
    setColour(row?.colourCode ?? '');
    setStorage(row?.storageLocation ?? '');
    setError(null);
    setOpen(true);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const body = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        toolKind: kind as CleaningToolKind,
        colourCode: colour.trim() === '' ? null : colour.trim(),
        storageLocation: storage.trim() === '' ? null : storage.trim(),
      };
      if (editing === null) await create.mutateAsync(body);
      else await update.mutateAsync({ id: editing.id, body });
      notify.success('Saved.');
      setOpen(false);
    } catch (err) {
      setError(readError(err).message);
    }
  }

  const columns: DataTableColumn<CleaningToolDto>[] = [
    { field: 'code', headerName: 'Code', width: 150 },
    { field: 'name', headerName: 'Name', width: 200 },
    {
      field: 'toolKind',
      headerName: 'Kind',
      width: 150,
      valueGetter: (row) => CLEANING_TOOL_KIND_LABELS[row.toolKind],
    },
    {
      field: 'colourCode',
      headerName: 'Colour code',
      width: 140,
      valueGetter: (row) => row.colourCode ?? '—',
    },
    {
      field: 'storageLocation',
      headerName: 'Kept',
      width: 180,
      valueGetter: (row) => row.storageLocation ?? '—',
    },
    { field: 'status', headerName: 'Status', width: 110 },
  ];

  return (
    <MasterTab
      title="Tools"
      hint="Colour coding is what keeps a toilet brush out of the prep room. Record it here."
      canManage={canManage}
      onCreate={() => start(null)}
      gridId="cleaning-tools"
      columns={columns}
      rows={data ?? []}
      loading={isLoading}
      onRowDoubleClick={(row) => canManage && start(row)}
      modal={
        <Modal
          id="cleaning-tool"
          title={editing === null ? 'New tool' : editing.name}
          open={open}
          onClose={() => setOpen(false)}
          footer={
            <FormModalFooter
              formId="tool-form"
              onCancel={() => setOpen(false)}
              submitting={create.isPending || update.isPending}
            />
          }
        >
          <form id="tool-form" onSubmit={submit}>
            <FieldGroup>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <TextField
                label="Code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                maxLength={LIMITS.CLEANING_TOOL_CODE_MAX}
                disabled={editing !== null}
              />
              <TextField
                label="Name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={LIMITS.CLEANING_TOOL_NAME_MAX}
              />
              <SelectField
                label="Kind"
                value={kind}
                onChange={setKind}
                options={Object.values(CleaningToolKind).map((value) => ({
                  value,
                  label: CLEANING_TOOL_KIND_LABELS[value],
                }))}
              />
              <TextField
                label="Colour code"
                placeholder="Red — washrooms"
                value={colour}
                onChange={(event) => setColour(event.target.value)}
                maxLength={LIMITS.CLEANING_TOOL_COLOUR_MAX}
              />
              <TextField
                label="Where it is kept"
                value={storage}
                onChange={(event) => setStorage(event.target.value)}
                maxLength={LIMITS.CLEANING_TOOL_STORAGE_MAX}
              />
            </FieldGroup>
          </form>
        </Modal>
      }
    />
  );
}

/* ---------------------------------------------------------------------- methods */

function MethodsTab({ canManage }: { canManage: boolean }): JSX.Element {
  const { data, isLoading } = useCleaningMethods({ includeInactive: true });
  const create = useCreateMethod();
  const update = useUpdateMethod();
  const [editing, setEditing] = useState<CleaningMethodDto | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  function start(row: CleaningMethodDto | null): void {
    setEditing(row);
    setCode(row?.code ?? '');
    setName(row?.name ?? '');
    setDescription(row?.description ?? '');
    setError(null);
    setOpen(true);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const body = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
      };
      if (editing === null) await create.mutateAsync(body);
      else await update.mutateAsync({ id: editing.id, body });
      notify.success('Saved.');
      setOpen(false);
    } catch (err) {
      setError(readError(err).message);
    }
  }

  const columns: DataTableColumn<CleaningMethodDto>[] = [
    { field: 'code', headerName: 'Code', width: 180 },
    { field: 'name', headerName: 'Name', width: 220 },
    {
      field: 'description',
      headerName: 'Description',
      width: 320,
      valueGetter: (row) => row.description ?? '—',
    },
    { field: 'status', headerName: 'Status', width: 110 },
  ];

  return (
    <MasterTab
      title="Methods"
      hint="How a surface is cleaned — wiped, soaked, foamed, cleaned in place."
      canManage={canManage}
      onCreate={() => start(null)}
      gridId="cleaning-methods"
      columns={columns}
      rows={data ?? []}
      loading={isLoading}
      onRowDoubleClick={(row) => canManage && start(row)}
      modal={
        <Modal
          id="cleaning-method"
          title={editing === null ? 'New method' : editing.name}
          open={open}
          onClose={() => setOpen(false)}
          footer={
            <FormModalFooter
              formId="method-form"
              onCancel={() => setOpen(false)}
              submitting={create.isPending || update.isPending}
            />
          }
        >
          <form id="method-form" onSubmit={submit}>
            <FieldGroup>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <TextField
                label="Code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                maxLength={LIMITS.CLEANING_METHOD_CODE_MAX}
                disabled={editing !== null}
              />
              <TextField
                label="Name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={LIMITS.CLEANING_METHOD_NAME_MAX}
              />
              <TextField
                label="Description"
                multiline
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={LIMITS.CLEANABLE_ASSET_DESCRIPTION_MAX}
              />
            </FieldGroup>
          </form>
        </Modal>
      }
    />
  );
}

/* -------------------------------------------------------------------- standards */

function StandardsTab({ canManage }: { canManage: boolean }): JSX.Element {
  const { data, isLoading } = useCleaningStandards({ includeInactive: true });
  const create = useCreateStandard();
  const update = useUpdateStandard();
  const [editing, setEditing] = useState<CleaningStandardDto | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [unit, setUnit] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [error, setError] = useState<string | null>(null);

  function start(row: CleaningStandardDto | null): void {
    setEditing(row);
    setCode(row?.code ?? '');
    setName(row?.name ?? '');
    setAcceptance(row?.acceptanceText ?? '');
    setUnit(row?.measureUnit ?? '');
    setMin(row?.minValue === null || row === null ? '' : String(row.minValue));
    setMax(row?.maxValue === null || row === null ? '' : String(row.maxValue));
    setError(null);
    setOpen(true);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const body = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        acceptanceText: acceptance.trim(),
        measureUnit: unit.trim() === '' ? null : unit.trim(),
        minValue: min === '' ? null : Number(min),
        maxValue: max === '' ? null : Number(max),
      };
      if (editing === null) await create.mutateAsync(body);
      else await update.mutateAsync({ id: editing.id, body });
      notify.success('Saved.');
      setOpen(false);
    } catch (err) {
      setError(readError(err).message);
    }
  }

  const columns: DataTableColumn<CleaningStandardDto>[] = [
    { field: 'code', headerName: 'Code', width: 190 },
    { field: 'name', headerName: 'Name', width: 240 },
    { field: 'acceptanceText', headerName: 'Clean means', width: 320 },
    {
      field: 'range',
      headerName: 'Acceptable range',
      width: 180,
      valueGetter: (row) =>
        row.minValue === null && row.maxValue === null
          ? '—'
          : `${row.minValue ?? '−∞'} – ${row.maxValue ?? '∞'} ${row.measureUnit ?? ''}`.trim(),
    },
    { field: 'status', headerName: 'Status', width: 110 },
  ];

  return (
    <MasterTab
      title="Standards"
      hint="What 'clean enough' means. A numeric window turns a check into a measurement."
      canManage={canManage}
      onCreate={() => start(null)}
      gridId="cleaning-standards"
      columns={columns}
      rows={data ?? []}
      loading={isLoading}
      onRowDoubleClick={(row) => canManage && start(row)}
      modal={
        <Modal
          id="cleaning-standard"
          title={editing === null ? 'New standard' : editing.name}
          open={open}
          onClose={() => setOpen(false)}
          footer={
            <FormModalFooter
              formId="standard-form"
              onCancel={() => setOpen(false)}
              submitting={create.isPending || update.isPending}
            />
          }
        >
          <form id="standard-form" onSubmit={submit}>
            <FieldGroup>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <TextField
                label="Code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                maxLength={LIMITS.CLEANING_STANDARD_CODE_MAX}
                disabled={editing !== null}
              />
              <TextField
                label="Name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={LIMITS.CLEANING_STANDARD_NAME_MAX}
              />
              <TextField
                label="Clean means"
                required
                multiline
                rows={3}
                helperText="Written so the person checking can apply it without asking anybody."
                value={acceptance}
                onChange={(event) => setAcceptance(event.target.value)}
                maxLength={LIMITS.CLEANING_STANDARD_ACCEPTANCE_MAX}
              />
              <TextField
                label="Unit"
                placeholder="ppm, RLU, degC"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                maxLength={LIMITS.CLEANING_STANDARD_UNIT_MAX}
              />
              <TextField
                label="Minimum"
                type="number"
                value={min}
                onChange={(event) => setMin(event.target.value)}
              />
              <TextField
                label="Maximum"
                type="number"
                value={max}
                onChange={(event) => setMax(event.target.value)}
              />
            </FieldGroup>
          </form>
        </Modal>
      }
    />
  );
}

/* ------------------------------------------------------------------ shared shell */

function MasterTab<T>({
  title,
  hint,
  canManage,
  onCreate,
  gridId,
  columns,
  rows,
  loading,
  onRowDoubleClick,
  modal,
}: {
  title: string;
  hint: string;
  canManage: boolean;
  onCreate: () => void;
  gridId: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  loading: boolean;
  onRowDoubleClick: (row: T) => void;
  modal: JSX.Element;
}): JSX.Element {
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-sm font-semibold tracking-tight">{title}</h2>
          <p className="text-muted-foreground text-xs">{hint}</p>
        </div>
        {canManage && (
          <Button size="sm" onClick={onCreate}>
            <PlusIcon data-icon="inline-start" />
            New
          </Button>
        )}
      </div>
      <DataTable
        gridId={gridId}
        columns={columns}
        rows={rows}
        getRowId={(row) => (row as { id: string }).id}
        loading={loading}
        onRowDoubleClick={onRowDoubleClick}
        emptyTitle="Nothing here yet"
        emptyMessage="Reference data the cleaning rules and procedures draw on."
        {...(canManage ? { emptyAction: { label: 'Add one', onClick: onCreate } } : {})}
      />
      {modal}
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
