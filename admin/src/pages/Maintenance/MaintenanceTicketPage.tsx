import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Capability,
  MAINTENANCE_ACTIVITY_LABELS,
  MAINTENANCE_TICKET_STATUS_LABELS,
  MaintenanceTicketStatus,
  PROBLEM_CATEGORY_LABELS,
  canTransitionMaintenanceStatus,
} from '@menuboard/shared';
import { CheckCircle2Icon, MessageCircleIcon, PhoneIcon, UserPlusIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSkeleton } from '@/components/ui/Skeletons';
import { TextField } from '@/components/form/fields';
import { BackButton } from '../../components/BackButton';
import { useAuth } from '../../services/AuthContext';
import {
  useAddTicketNote,
  useChangeTicketStatus,
  useLogCall,
  useLogWhatsapp,
  useMaintenanceTicket,
  useWhatsappDraft,
} from '../../hooks/useEquipment';
import { notify } from '@/lib/notify';
import { TONE_CHIP_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { formatDateTime, PRIORITY_TONE, TICKET_STATUS_TONE } from '../Equipment/equipmentTone';
import { AssignTicketModal } from './AssignTicketModal';
import { CompleteTicketModal } from './CompleteTicketModal';

/** The rungs a manager moves a ticket through by hand; the rest happen as a side effect. */
const MANUAL_STATUSES: readonly MaintenanceTicketStatus[] = [
  MaintenanceTicketStatus.ACKNOWLEDGED,
  MaintenanceTicketStatus.SUPPLIER_CONTACTED,
  MaintenanceTicketStatus.UNDER_MAINTENANCE,
  MaintenanceTicketStatus.WAITING_FOR_PARTS,
  MaintenanceTicketStatus.VERIFIED,
  MaintenanceTicketStatus.CLOSED,
  MaintenanceTicketStatus.CANCELLED,
];

/**
 * One ticket, its timeline and everything anybody can do to it.
 *
 * The status buttons are drawn from `canTransitionMaintenanceStatus` in shared — the same
 * function the server enforces — so a button that is shown always works and a move that is
 * refused is never offered.
 */
export function MaintenanceTicketPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasCapability } = useAuth();
  const canAssign = hasCapability(Capability.MAINTENANCE_ASSIGN);
  const canApprove = hasCapability(Capability.MAINTENANCE_APPROVE);
  const canClose = hasCapability(Capability.MAINTENANCE_CLOSE);
  const canWork = hasCapability(Capability.MAINTENANCE_CREATE);
  const canContact = hasCapability(Capability.SUPPLIER_CONTACT);

  const [note, setNote] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [completing, setCompleting] = useState(false);

  const { data: ticket, isLoading } = useMaintenanceTicket(id);
  const changeStatus = useChangeTicketStatus();
  const addNote = useAddTicketNote();
  const whatsappDraft = useWhatsappDraft();
  const logWhatsapp = useLogWhatsapp();
  const logCall = useLogCall();

  if (isLoading || ticket === undefined) return <PageSkeleton />;

  const terminal =
    ticket.status === MaintenanceTicketStatus.CLOSED ||
    ticket.status === MaintenanceTicketStatus.CANCELLED;

  function allowed(status: MaintenanceTicketStatus): boolean {
    if (ticket === undefined) return false;
    if (!canTransitionMaintenanceStatus(ticket.status, status)) return false;
    if (status === MaintenanceTicketStatus.VERIFIED) return canApprove;
    if (status === MaintenanceTicketStatus.CLOSED || status === MaintenanceTicketStatus.CANCELLED) {
      return canClose;
    }
    return canAssign;
  }

  async function moveTo(status: MaintenanceTicketStatus): Promise<void> {
    if (ticket === undefined) return;
    try {
      await changeStatus.mutateAsync({ id: ticket.id, body: { status } });
      notify.success(`Now ${MAINTENANCE_TICKET_STATUS_LABELS[status].toLowerCase()}.`);
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function submitNote(): Promise<void> {
    if (ticket === undefined || note.trim() === '') return;
    try {
      await addNote.mutateAsync({ id: ticket.id, note: note.trim() });
      setNote('');
      notify.success('Note added.');
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function onCall(): Promise<void> {
    if (ticket === undefined) return;
    const number = ticket.supplierPhone ?? ticket.supplierWhatsapp ?? null;
    if (number === null) {
      notify.warning('No supplier phone number is on record for this asset.');
      return;
    }
    try {
      await logCall.mutateAsync({
        equipmentId: ticket.equipmentId,
        ticketId: ticket.id,
        supplierId: ticket.supplierId,
        phoneNumber: number,
      });
      window.location.href = `tel:${number}`;
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function onWhatsapp(): Promise<void> {
    if (ticket === undefined) return;
    try {
      const draft = await whatsappDraft.mutateAsync({
        equipmentId: ticket.equipmentId,
        ticketId: ticket.id,
      });
      window.open(draft.deepLink, '_blank', 'noopener');
      await logWhatsapp.mutateAsync({ equipmentId: ticket.equipmentId, ticketId: ticket.id });
      notify.success(`Message opened for ${draft.supplierName}.`);
    } catch (err) {
      notify.fromError(err);
    }
  }

  return (
    <>
      <PageHeader
        leading={<BackButton to="/maintenance" label="Maintenance" />}
        eyebrow={ticket.ticketNumber}
        title={ticket.title}
        subtitle={`${ticket.assetId ?? ''} · ${ticket.equipmentName ?? ''} · ${ticket.locationPath ?? 'No location'}`}
        meta={
          <span className="flex items-center gap-2">
            <span
              className={cn(
                'rounded-sm border px-2 py-1 text-xs font-semibold',
                TONE_CHIP_CLASS[PRIORITY_TONE[ticket.priority]],
              )}
            >
              {ticket.priority}
            </span>
            <span
              className={cn(
                'rounded-sm border px-2 py-1 text-xs font-semibold',
                TONE_CHIP_CLASS[TICKET_STATUS_TONE[ticket.status]],
              )}
            >
              {MAINTENANCE_TICKET_STATUS_LABELS[ticket.status]}
            </span>
          </span>
        }
        actions={
          <>
            {canContact && (
              <>
                <Button variant="outline" onClick={() => void onCall()} disabled={logCall.isPending}>
                  <PhoneIcon data-icon="inline-start" />
                  Call supplier
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void onWhatsapp()}
                  disabled={whatsappDraft.isPending}
                >
                  {whatsappDraft.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <MessageCircleIcon data-icon="inline-start" />
                  )}
                  WhatsApp
                </Button>
              </>
            )}
            {canAssign && !terminal && (
              <Button variant="outline" onClick={() => setAssigning(true)}>
                <UserPlusIcon data-icon="inline-start" />
                Assign
              </Button>
            )}
            {canWork && !terminal && ticket.status !== MaintenanceTicketStatus.RESOLVED && (
              <Button onClick={() => setCompleting(true)}>
                <CheckCircle2Icon data-icon="inline-start" />
                Complete
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="bg-card rounded-xl border p-4">
            <h2 className="font-heading mb-2 text-sm font-semibold">What was reported</h2>
            <p className="text-sm whitespace-pre-line">
              {ticket.description ?? 'No description was given.'}
            </p>
            {(ticket.problems ?? []).map((problem) => (
              <div key={problem.id} className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline">{PROBLEM_CATEGORY_LABELS[problem.category]}</Badge>
                {problem.aiSuggestedCategory !== null &&
                  problem.aiSuggestedCategory !== problem.category && (
                    <span className="text-muted-foreground text-xs">
                      AI proposed {PROBLEM_CATEGORY_LABELS[problem.aiSuggestedCategory]} —
                      corrected by the reporter
                    </span>
                  )}
              </div>
            ))}

            {(ticket.attachments ?? []).length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {(ticket.attachments ?? []).map((attachment) => (
                  <li key={attachment.id}>
                    <a
                      href={attachment.url}
                      target="_blank"
                      rel="noreferrer"
                      className="focus-ring bg-muted block size-20 overflow-hidden rounded-md border"
                      title={attachment.transcript ?? attachment.fileName}
                    >
                      {attachment.kind === 'PHOTO' ? (
                        <img src={attachment.url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-muted-foreground grid h-full place-items-center p-1 text-center text-[10px]">
                          {attachment.kind}
                        </span>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!terminal && (
            <section className="bg-card rounded-xl border p-4">
              <h2 className="font-heading mb-2 text-sm font-semibold">Move it along</h2>
              <div className="flex flex-wrap gap-2">
                {MANUAL_STATUSES.filter(allowed).map((status) => (
                  <Button
                    key={status}
                    variant={status === MaintenanceTicketStatus.CANCELLED ? 'outline' : 'secondary'}
                    size="sm"
                    disabled={changeStatus.isPending}
                    onClick={() => void moveTo(status)}
                  >
                    {MAINTENANCE_TICKET_STATUS_LABELS[status]}
                  </Button>
                ))}
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                Rungs may be skipped — contacting the supplier the moment a fault lands does not
                require acknowledging it first.
              </p>
            </section>
          )}

          <section className="bg-card rounded-xl border p-4">
            <h2 className="font-heading mb-2 text-sm font-semibold">Timeline</h2>
            {(ticket.activities ?? []).length === 0 ? (
              <EmptyState title="Nothing recorded yet" />
            ) : (
              <ol className="divide-border divide-y">
                {(ticket.activities ?? []).map((entry) => (
                  <li key={entry.id} className="py-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-medium">{entry.summary}</span>
                      <Badge variant="outline">{MAINTENANCE_ACTIVITY_LABELS[entry.type]}</Badge>
                      <span className="text-muted-foreground ml-auto text-xs">
                        {formatDateTime(entry.createdAt)}
                      </span>
                    </div>
                    {entry.detail !== null && (
                      <p className="text-muted-foreground mt-1 text-xs whitespace-pre-line">
                        {entry.detail}
                      </p>
                    )}
                    <p className="text-muted-foreground mt-1 text-xs">
                      {entry.actorName ?? 'System'}
                    </p>
                  </li>
                ))}
              </ol>
            )}

            {canWork && !terminal && (
              <div className="mt-3 flex items-end gap-2">
                <TextField
                  label="Add a note"
                  className="flex-1"
                  placeholder="Rang them, no answer — trying again after lunch"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={note.trim() === '' || addNote.isPending}
                  onClick={() => void submitNote()}
                >
                  Add
                </Button>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="bg-card rounded-xl border p-4 text-sm">
            <h2 className="font-heading mb-3 text-sm font-semibold">Details</h2>
            <dl className="space-y-2">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Reported by</dt>
                <dd className="text-right">{ticket.reportedByName ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Reported</dt>
                <dd className="text-right">{formatDateTime(ticket.reportedAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Assigned to</dt>
                <dd className="text-right">{ticket.assignedToName ?? 'Nobody yet'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Supplier</dt>
                <dd className="text-right">{ticket.supplierName ?? 'None linked'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Scheduled visit</dt>
                <dd className="text-right">{formatDateTime(ticket.scheduledAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Resolved</dt>
                <dd className="text-right">{formatDateTime(ticket.resolvedAt)}</dd>
              </div>
              {ticket.partsRequired !== null && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Parts</dt>
                  <dd className="text-right">{ticket.partsRequired}</dd>
                </div>
              )}
              {ticket.costAmount !== null && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Cost</dt>
                  <dd className="text-right tabular-nums">{ticket.costAmount.toLocaleString()}</dd>
                </div>
              )}
            </dl>

            {ticket.resolutionNotes !== null && (
              <p className="text-muted-foreground mt-3 border-t pt-3 text-xs whitespace-pre-line">
                {ticket.resolutionNotes}
              </p>
            )}

            <Button
              variant="outline"
              size="sm"
              className="mt-4 w-full"
              onClick={() => navigate(`/equipment/assets/${ticket.equipmentId}`)}
            >
              Open the equipment
            </Button>
          </section>
        </aside>
      </div>

      <AssignTicketModal open={assigning} onClose={() => setAssigning(false)} ticket={ticket} />
      <CompleteTicketModal open={completing} onClose={() => setCompleting(false)} ticket={ticket} />
    </>
  );
}
