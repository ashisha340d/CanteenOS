import { useState } from 'react';
import {
  LIMITS,
  MAINTENANCE_REQUEST_KIND_LABELS,
  MaintenancePriority,
  MaintenanceRequestKind,
  PROBLEM_CATEGORY_LABELS,
  ProblemCategory,
  type EquipmentDto,
} from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { useCreateTicket, useEquipmentList } from '../../hooks/useEquipment';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';

const FORM_ID = 'report-problem-form';

/**
 * Opening a ticket from the portal.
 *
 * Only the equipment is required. Priority is left blank by default because the server
 * derives it from the problem category — a safety or electrical fault opens CRITICAL whatever
 * anybody selected, which is the whole point of not asking.
 */
export function ReportProblemModal({
  open,
  onClose,
  equipment,
}: {
  open: boolean;
  onClose: () => void;
  /** Pre-selected when raised from an asset's own page. */
  equipment?: EquipmentDto | null;
}): JSX.Element {
  const [equipmentId, setEquipmentId] = useState(equipment?.id ?? '');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<MaintenanceRequestKind>(MaintenanceRequestKind.PROBLEM);
  const [category, setCategory] = useState<string>('');
  const [priority, setPriority] = useState<string>('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useCreateTicket();
  const { data: options } = useEquipmentList({
    search: search || undefined,
    page: 1,
    pageSize: 25,
  });

  const chosen = equipment ?? (options?.items ?? []).find((row) => row.id === equipmentId) ?? null;

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (equipmentId === '') {
      setError('Choose which piece of equipment this is about.');
      return;
    }

    try {
      const ticket = await create.mutateAsync({
        equipmentId,
        kind,
        problemCategory: category === '' ? null : (category as ProblemCategory),
        description: description || null,
        ...(priority === '' ? {} : { priority: priority as MaintenancePriority }),
      });
      notify.success(`${ticket.ticketNumber} raised.`);
      setCategory('');
      setPriority('');
      setDescription('');
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="report-problem"
      title="Report a problem"
      open={open}
      onClose={onClose}
      footer={
        <FormModalFooter
          formId={FORM_ID}
          onCancel={onClose}
          submitting={create.isPending}
          saveLabel="Raise ticket"
        />
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {equipment ? (
            <p className="text-sm">
              <span className="font-semibold">{equipment.name}</span>{' '}
              <span className="text-muted-foreground font-mono text-xs">{equipment.assetId}</span>
              <span className="text-muted-foreground block text-xs">
                {equipment.locationPath ?? 'No location'}
              </span>
            </p>
          ) : (
            <>
              <TextField
                label="Find equipment"
                placeholder="Name, asset id, brand or serial"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <SelectField
                label="Equipment"
                required
                value={equipmentId}
                onChange={setEquipmentId}
                placeholder="Choose the machine"
                options={(options?.items ?? []).map((row) => ({
                  value: row.id,
                  label: `${row.assetId} · ${row.name}`,
                }))}
              />
            </>
          )}

          <SelectField
            label="Request type"
            value={kind}
            onChange={(next) => setKind(next as MaintenanceRequestKind)}
            options={Object.values(MaintenanceRequestKind)
              .filter((value) => value !== MaintenanceRequestKind.SCHEDULED)
              .map((value) => ({ value, label: MAINTENANCE_REQUEST_KIND_LABELS[value] }))}
            helperText="Scheduled services are raised by the preventive sweep, not by hand."
          />

          <SelectField
            label="What is wrong"
            value={category}
            onChange={setCategory}
            emptyLabel="Not sure"
            options={Object.values(ProblemCategory).map((value) => ({
              value,
              label: PROBLEM_CATEGORY_LABELS[value],
            }))}
            helperText="Safety and electrical faults open at critical priority automatically."
          />

          <TextField
            label="Describe it"
            multiline
            rows={3}
            placeholder="What is happening, in the words you would use on the floor"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={LIMITS.MAINTENANCE_DESCRIPTION_MAX}
          />

          <SelectField
            label="Priority"
            value={priority}
            onChange={setPriority}
            emptyLabel="Let the server decide"
            options={enumOptions(MaintenancePriority)}
          />

          {chosen !== null && chosen.openTicketCount > 0 && (
            <Alert>
              <AlertDescription>
                {chosen.name} already has {chosen.openTicketCount} open ticket
                {chosen.openTicketCount === 1 ? '' : 's'}. Add to the existing one if this is the
                same fault.
              </AlertDescription>
            </Alert>
          )}
        </FieldGroup>
      </form>
    </Modal>
  );
}
