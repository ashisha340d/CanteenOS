import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LIMITS, type MaintenanceTicketDto } from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usersApi } from '../../api/users';
import { useAssignTicket, useSuppliers } from '../../hooks/useEquipment';
import { readError } from '../../services/errorMessage';
import { notify } from '@/lib/notify';

const FORM_ID = 'assign-ticket-form';

/**
 * Handing the job over — to a colleague, to a supplier, or to a named technician of theirs.
 *
 * Giving a time turns the ticket into a scheduled visit rather than merely an assignment,
 * which is the distinction the floor actually cares about: somebody is coming at four.
 */
export function AssignTicketModal({
  open,
  onClose,
  ticket,
}: {
  open: boolean;
  onClose: () => void;
  ticket: MaintenanceTicketDto;
}): JSX.Element {
  const [assignedTo, setAssignedTo] = useState(ticket.assignedTo ?? '');
  const [supplierId, setSupplierId] = useState(ticket.supplierId ?? '');
  const [technicianName, setTechnicianName] = useState('');
  const [technicianPhone, setTechnicianPhone] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const assign = useAssignTicket();
  const { data: suppliers } = useSuppliers({ page: 1, pageSize: 100 });
  const { data: users } = useQuery({
    queryKey: ['maintenance-assignee-options'],
    queryFn: () => usersApi.list({ page: 1, pageSize: 200 }),
    enabled: open,
  });

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (assignedTo === '' && supplierId === '' && technicianName.trim() === '') {
      setError('Choose a person, a supplier, or name the technician.');
      return;
    }

    try {
      await assign.mutateAsync({
        id: ticket.id,
        body: {
          assignedTo: assignedTo === '' ? null : assignedTo,
          supplierId: supplierId === '' ? null : supplierId,
          technicianName: technicianName || null,
          technicianPhone: technicianPhone || null,
          scheduledAt: scheduledAt === '' ? null : new Date(scheduledAt).toISOString(),
          notes: notes || null,
        },
      });
      notify.success('Ticket assigned.');
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="assign-ticket"
      title={`Assign ${ticket.ticketNumber}`}
      open={open}
      onClose={onClose}
      footer={
        <FormModalFooter
          formId={FORM_ID}
          onCancel={onClose}
          submitting={assign.isPending}
          saveLabel="Assign"
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

          <SelectField
            label="Assign to"
            value={assignedTo}
            onChange={setAssignedTo}
            emptyLabel="Nobody in-house"
            options={(users?.items ?? []).map((user) => ({ value: user.id, label: user.name }))}
          />

          <SelectField
            label="Supplier"
            value={supplierId}
            onChange={setSupplierId}
            emptyLabel="No supplier"
            options={(suppliers?.items ?? []).map((supplier) => ({
              value: supplier.id,
              label: supplier.name,
            }))}
          />

          <TextField
            label="Technician name"
            helperText="Who the supplier is actually sending, when they have told you."
            value={technicianName}
            onChange={(event) => setTechnicianName(event.target.value)}
            maxLength={LIMITS.MAINTENANCE_TECHNICIAN_NAME_MAX}
          />

          <TextField
            label="Technician phone"
            type="tel"
            value={technicianPhone}
            onChange={(event) => setTechnicianPhone(event.target.value)}
            maxLength={LIMITS.SUPPLIER_PHONE_MAX}
          />

          <TextField
            label="Visit time"
            type="datetime-local"
            helperText="Giving a time moves the ticket to Technician Scheduled."
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
          />

          <TextField
            label="Notes"
            multiline
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={LIMITS.MAINTENANCE_NOTE_MAX}
          />
        </FieldGroup>
      </form>
    </Modal>
  );
}
