import { useState } from 'react';
import {
  Capability,
  LIMITS,
  MAINTENANCE_FREQUENCY_LABELS,
  MaintenanceFrequency,
  MasterStatus,
  type EquipmentAreaDto,
  type EquipmentCategoryDto,
  type EquipmentFloorDto,
  type EquipmentLocationDto,
} from '@menuboard/shared';
import { PlusIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FieldGroup, NumberField, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusChip } from '../../components/StatusChip';
import { Modal } from '../../components/Modal/Modal';
import { useAuth } from '../../services/AuthContext';
import { readError } from '../../services/errorMessage';
import {
  useCreateArea,
  useCreateCategory,
  useCreateFloor,
  useCreateLocation,
  useEquipmentAreas,
  useEquipmentCategories,
  useEquipmentFloors,
  useEquipmentLocations,
} from '../../hooks/useEquipment';
import { notify } from '@/lib/notify';

type Dialog = 'floor' | 'area' | 'location' | 'category' | null;

/**
 * The location tree and the category master behind every asset id.
 *
 * Both matter more than they look: an area contributes the middle segment of an asset id
 * (MTC-**KIT**-OVN-001) and a category the last one, so renaming a segment changes what
 * future ids read — existing ones are never rewritten.
 */
export function EquipmentLocationsPage(): JSX.Element {
  const { hasCapability } = useAuth();
  const canManageLocations = hasCapability(Capability.EQUIPMENT_MANAGE_LOCATION);
  const canManageCategories = hasCapability(Capability.EQUIPMENT_EDIT);
  const [dialog, setDialog] = useState<Dialog>(null);

  const { data: floors } = useEquipmentFloors({ includeInactive: true });
  const { data: areas } = useEquipmentAreas({ includeInactive: true });
  const { data: locations } = useEquipmentLocations({ includeInactive: true });
  const { data: categories } = useEquipmentCategories({ includeInactive: true });

  return (
    <>
      <PageHeader
        eyebrow="Equipment"
        title="Locations & categories"
        subtitle="Floors, areas and locations — plus the categories that shape every asset id."
      />

      <Tabs defaultValue="locations">
        <TabsList>
          <TabsTrigger value="locations">Locations</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="locations" className="space-y-6">
          {canManageLocations && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialog('floor')}>
                <PlusIcon data-icon="inline-start" />
                Floor
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDialog('area')}>
                <PlusIcon data-icon="inline-start" />
                Area
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDialog('location')}>
                <PlusIcon data-icon="inline-start" />
                Location
              </Button>
            </div>
          )}

          {(floors ?? []).length === 0 ? (
            <EmptyState title="No floors yet" description="Start with a floor, then an area inside it." />
          ) : (
            <div className="space-y-4">
              {(floors ?? []).map((floor) => (
                <FloorCard
                  key={floor.id}
                  floor={floor}
                  areas={(areas ?? []).filter((area) => area.floorId === floor.id)}
                  locations={locations ?? []}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="categories" className="space-y-4">
          {canManageCategories && (
            <Button variant="outline" size="sm" onClick={() => setDialog('category')}>
              <PlusIcon data-icon="inline-start" />
              New category
            </Button>
          )}

          <ul className="divide-border bg-card divide-y rounded-xl border">
            {(categories ?? []).map((category) => (
              <CategoryRow key={category.id} category={category} />
            ))}
          </ul>
        </TabsContent>
      </Tabs>

      <FloorFormModal open={dialog === 'floor'} onClose={() => setDialog(null)} />
      <AreaFormModal
        open={dialog === 'area'}
        onClose={() => setDialog(null)}
        floors={floors ?? []}
      />
      <LocationFormModal
        open={dialog === 'location'}
        onClose={() => setDialog(null)}
        areas={areas ?? []}
      />
      <CategoryFormModal open={dialog === 'category'} onClose={() => setDialog(null)} />
    </>
  );
}

function FloorCard({
  floor,
  areas,
  locations,
}: {
  floor: EquipmentFloorDto;
  areas: EquipmentAreaDto[];
  locations: EquipmentLocationDto[];
}): JSX.Element {
  return (
    <section className="bg-card rounded-xl border p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-base font-semibold">{floor.name}</h2>
        <Badge variant="outline">{floor.code}</Badge>
        <StatusChip status={floor.status} />
        <span className="text-muted-foreground ml-auto text-xs">
          {floor.equipmentCount ?? 0} asset{(floor.equipmentCount ?? 0) === 1 ? '' : 's'}
          {floor.hasFloorPlan === true ? ' · plan uploaded' : ''}
        </span>
      </div>

      {areas.length === 0 ? (
        <p className="text-muted-foreground text-sm">No areas on this floor yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {areas.map((area) => (
            <div key={area.id} className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{area.name}</span>
                <Badge variant="secondary" className="font-mono">
                  {area.assetSegment}
                </Badge>
              </div>
              <ul className="text-muted-foreground mt-2 space-y-0.5 text-xs">
                {locations
                  .filter((location) => location.areaId === area.id)
                  .map((location) => (
                    <li key={location.id} className="truncate">
                      {[location.name, location.room, location.section, location.position]
                        .filter((part) => part !== null && part !== '')
                        .join(' · ')}
                      {(location.equipmentCount ?? 0) > 0 && ` — ${location.equipmentCount}`}
                    </li>
                  ))}
                {locations.every((location) => location.areaId !== area.id) && (
                  <li>No locations yet</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CategoryRow({ category }: { category: EquipmentCategoryDto }): JSX.Element {
  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <Badge variant="secondary" className="font-mono">
        {category.assetSegment}
      </Badge>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{category.name}</span>
        {category.description !== null && (
          <span className="text-muted-foreground block truncate text-xs">
            {category.description}
          </span>
        )}
      </span>
      {category.defaultFrequency !== null && (
        <Badge variant="outline">{MAINTENANCE_FREQUENCY_LABELS[category.defaultFrequency]}</Badge>
      )}
      <span className="text-muted-foreground text-xs tabular-nums">
        {category.equipmentCount ?? 0}
      </span>
      <StatusChip status={category.status} />
    </li>
  );
}

function FloorFormModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [levelIndex, setLevelIndex] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateFloor();

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({ code, name, levelIndex: Number(levelIndex) });
      notify.success('Floor added.');
      setCode('');
      setName('');
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="equipment-floor-form"
      title="New floor"
      open={open}
      onClose={onClose}
      footer={
        <FormModalFooter formId="floor-form" onCancel={onClose} submitting={create.isPending} />
      }
    >
      <form id="floor-form" onSubmit={onSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <TextField
            label="Code"
            required
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value)}
            maxLength={40}
          />
          <TextField
            label="Name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={LIMITS.EQUIPMENT_FLOOR_NAME_MAX}
          />
          <NumberField
            label="Level"
            helperText="Ground is 0, basements negative. Orders the floor switcher."
            value={levelIndex}
            onChange={(event) => setLevelIndex(event.target.value)}
          />
        </FieldGroup>
      </form>
    </Modal>
  );
}

function AreaFormModal({
  open,
  onClose,
  floors,
}: {
  open: boolean;
  onClose: () => void;
  floors: EquipmentFloorDto[];
}): JSX.Element {
  const [floorId, setFloorId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [assetSegment, setAssetSegment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateArea();

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({ floorId, code, name, assetSegment });
      notify.success('Area added.');
      setCode('');
      setName('');
      setAssetSegment('');
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="equipment-area-form"
      title="New area"
      open={open}
      onClose={onClose}
      footer={
        <FormModalFooter formId="area-form" onCancel={onClose} submitting={create.isPending} />
      }
    >
      <form id="area-form" onSubmit={onSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <SelectField
            label="Floor"
            required
            value={floorId}
            onChange={setFloorId}
            placeholder="Choose a floor"
            options={floors.map((floor) => ({ value: floor.id, label: floor.name }))}
          />
          <TextField
            label="Code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            maxLength={40}
          />
          <TextField
            label="Name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={LIMITS.EQUIPMENT_AREA_NAME_MAX}
          />
          <TextField
            label="Asset segment"
            required
            helperText="Two to four letters. Becomes the middle of every asset id here — KIT in MTC-KIT-OVN-001."
            value={assetSegment}
            onChange={(event) => setAssetSegment(event.target.value.toUpperCase())}
            maxLength={LIMITS.ASSET_SEGMENT_MAX}
            className="[&_input]:uppercase"
          />
        </FieldGroup>
      </form>
    </Modal>
  );
}

function LocationFormModal({
  open,
  onClose,
  areas,
}: {
  open: boolean;
  onClose: () => void;
  areas: EquipmentAreaDto[];
}): JSX.Element {
  const [areaId, setAreaId] = useState('');
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  const [section, setSection] = useState('');
  const [position, setPosition] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateLocation();

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({
        areaId,
        name,
        room: room || null,
        section: section || null,
        position: position || null,
      });
      notify.success('Location added.');
      setName('');
      setRoom('');
      setSection('');
      setPosition('');
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="equipment-location-form"
      title="New location"
      open={open}
      onClose={onClose}
      footer={
        <FormModalFooter formId="location-form" onCancel={onClose} submitting={create.isPending} />
      }
    >
      <form id="location-form" onSubmit={onSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <SelectField
            label="Area"
            required
            value={areaId}
            onChange={setAreaId}
            placeholder="Choose an area"
            options={areas.map((area) => ({ value: area.id, label: area.name }))}
          />
          <TextField
            label="Name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={LIMITS.EQUIPMENT_LOCATION_NAME_MAX}
          />
          <TextField
            label="Room"
            value={room}
            onChange={(event) => setRoom(event.target.value)}
            maxLength={LIMITS.EQUIPMENT_ROOM_MAX}
          />
          <TextField
            label="Section"
            helperText="“Hot line”, “Wash-up” — how the floor actually refers to it."
            value={section}
            onChange={(event) => setSection(event.target.value)}
            maxLength={LIMITS.EQUIPMENT_SECTION_MAX}
          />
          <TextField
            label="Position"
            value={position}
            onChange={(event) => setPosition(event.target.value)}
            maxLength={LIMITS.EQUIPMENT_POSITION_MAX}
          />
        </FieldGroup>
      </form>
    </Modal>
  );
}

function CategoryFormModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [assetSegment, setAssetSegment] = useState('');
  const [description, setDescription] = useState('');
  const [defaultFrequency, setDefaultFrequency] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateCategory();

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({
        code,
        name,
        assetSegment,
        description: description || null,
        defaultFrequency:
          defaultFrequency === '' ? null : (defaultFrequency as MaintenanceFrequency),
        status: MasterStatus.ACTIVE,
      });
      notify.success('Category added.');
      setCode('');
      setName('');
      setAssetSegment('');
      setDescription('');
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="equipment-category-form"
      title="New equipment category"
      open={open}
      onClose={onClose}
      footer={
        <FormModalFooter formId="category-form" onCancel={onClose} submitting={create.isPending} />
      }
    >
      <form id="category-form" onSubmit={onSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <TextField
            label="Code"
            required
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            maxLength={LIMITS.EQUIPMENT_CATEGORY_CODE_MAX}
            className="[&_input]:uppercase"
          />
          <TextField
            label="Name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={LIMITS.EQUIPMENT_CATEGORY_NAME_MAX}
          />
          <TextField
            label="Asset segment"
            required
            helperText="Two to four letters — OVN in MTC-KIT-OVN-001."
            value={assetSegment}
            onChange={(event) => setAssetSegment(event.target.value.toUpperCase())}
            maxLength={LIMITS.ASSET_SEGMENT_MAX}
            className="[&_input]:uppercase"
          />
          <TextField
            label="Description"
            multiline
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={1000}
          />
          <SelectField
            label="Recommended service interval"
            helperText="Seeds the first preventive schedule when equipment in this category is registered."
            value={defaultFrequency}
            onChange={setDefaultFrequency}
            emptyLabel="None"
            options={Object.values(MaintenanceFrequency).map((value) => ({
              value,
              label: MAINTENANCE_FREQUENCY_LABELS[value],
            }))}
          />
        </FieldGroup>
      </form>
    </Modal>
  );
}
