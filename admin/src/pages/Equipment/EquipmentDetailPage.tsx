import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Capability,
  EQUIPMENT_DOCUMENT_TYPE_LABELS,
  EQUIPMENT_STATUS_LABELS,
  EQUIPMENT_SUPPLIER_ROLE_LABELS,
  EquipmentDocumentType,
  EquipmentSupplierRole,
  MAINTENANCE_ACTIVITY_LABELS,
  MAINTENANCE_TICKET_STATUS_LABELS,
  type EquipmentSupplierRole as EquipmentSupplierRoleType,
} from '@menuboard/shared';
import {
  ArrowRightLeftIcon,
  FileTextIcon,
  MessageCircleIcon,
  PencilIcon,
  PhoneIcon,
  TriangleAlertIcon,
  UploadIcon,
  WrenchIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SelectField } from '@/components/form/fields';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSkeleton } from '@/components/ui/Skeletons';
import { BackButton } from '../../components/BackButton';
import { useAuth } from '../../services/AuthContext';
import {
  useAddEquipmentDocument,
  useEquipment,
  useEquipmentActivity,
  useEquipmentStatusHistory,
  useLogCall,
  useLogWhatsapp,
  useRemoveEquipmentSupplier,
  useSetEquipmentSupplier,
  useSuppliers,
  useUploadEquipmentMedia,
  useWhatsappDraft,
} from '../../hooks/useEquipment';
import { notify } from '@/lib/notify';
import { TONE_CHIP_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { ReportProblemModal } from '../Maintenance/ReportProblemModal';
import {
  dueLabel,
  EQUIPMENT_STATUS_TONE,
  formatDate,
  formatDateTime,
  TICKET_STATUS_TONE,
  WARRANTY_TONE,
} from './equipmentTone';
import { EquipmentFormModal } from './EquipmentFormModal';
import { EquipmentMoveModal, EquipmentStatusModal } from './EquipmentStatusModal';

function Detail({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs tracking-[0.04em] uppercase">{label}</dt>
      <dd className="mt-0.5 truncate text-sm">{value}</dd>
    </div>
  );
}

/**
 * The equipment profile — one screen that answers "what is this, where is it, is it working,
 * who fixes it, and what has happened to it".
 *
 * The action row is the point of the page: reporting a problem, ringing the supplier and
 * sending them the details are one tap each, because that is what somebody standing next to a
 * broken machine needs.
 */
export function EquipmentDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasCapability } = useAuth();
  const canEdit = hasCapability(Capability.EQUIPMENT_EDIT);
  const canMove = hasCapability(Capability.EQUIPMENT_MANAGE_LOCATION);
  const canReport = hasCapability(Capability.EQUIPMENT_REPORT_PROBLEM);
  const canUpload = hasCapability(Capability.EQUIPMENT_UPLOAD_DOCUMENT);
  const canContact = hasCapability(Capability.SUPPLIER_CONTACT);
  const canManageSuppliers = hasCapability(Capability.SUPPLIER_MANAGE);

  const [editing, setEditing] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [docType, setDocType] = useState<EquipmentDocumentType>(EquipmentDocumentType.WARRANTY);
  const [supplierRole, setSupplierRole] = useState<EquipmentSupplierRoleType>(
    EquipmentSupplierRole.MAINTENANCE,
  );
  const [supplierId, setSupplierId] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const { data: equipment, isLoading } = useEquipment(id);
  const { data: activity } = useEquipmentActivity(id);
  const { data: statusHistory } = useEquipmentStatusHistory(id);
  const { data: suppliers } = useSuppliers({ page: 1, pageSize: 100 });
  const upload = useUploadEquipmentMedia();
  const addDocument = useAddEquipmentDocument();
  const setLink = useSetEquipmentSupplier();
  const removeLink = useRemoveEquipmentSupplier();
  const whatsappDraft = useWhatsappDraft();
  const logWhatsapp = useLogWhatsapp();
  const logCall = useLogCall();

  if (isLoading || equipment === undefined) return <PageSkeleton />;

  const defaultSupplier = (equipment.suppliers ?? [])[0] ?? null;

  async function onUploadDocument(file: File): Promise<void> {
    if (equipment === undefined) return;
    try {
      const media = await upload.mutateAsync({ file, title: file.name });
      await addDocument.mutateAsync({
        id: equipment.id,
        body: { mediaId: media.id, docType, title: file.name, applyWarranty: true },
      });
      notify.success('Document attached.');
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function onCall(): Promise<void> {
    if (equipment === undefined || defaultSupplier === null) return;
    const number = defaultSupplier.phone ?? defaultSupplier.whatsapp;
    if (number === null) {
      notify.warning(`${defaultSupplier.supplierName} has no phone number on record.`);
      return;
    }
    try {
      await logCall.mutateAsync({
        equipmentId: equipment.id,
        supplierId: defaultSupplier.supplierId,
        phoneNumber: number,
      });
      window.location.href = `tel:${number}`;
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function onWhatsapp(): Promise<void> {
    if (equipment === undefined) return;
    try {
      const draft = await whatsappDraft.mutateAsync({ equipmentId: equipment.id });
      window.open(draft.deepLink, '_blank', 'noopener');
      await logWhatsapp.mutateAsync({ equipmentId: equipment.id });
      notify.success(`Message opened for ${draft.supplierName}.`);
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function onSetSupplier(): Promise<void> {
    if (equipment === undefined || supplierId === '') return;
    try {
      await setLink.mutateAsync({
        id: equipment.id,
        body: { supplierId, role: supplierRole, isDefault: (equipment.suppliers ?? []).length === 0 },
      });
      setSupplierId('');
      notify.success('Supplier linked.');
    } catch (err) {
      notify.fromError(err);
    }
  }

  return (
    <>
      <PageHeader
        leading={<BackButton to="/equipment/assets" label="Equipment" />}
        eyebrow={equipment.assetId}
        title={equipment.name}
        subtitle={equipment.locationPath ?? 'No location recorded'}
        meta={
          <span
            className={cn(
              'rounded-sm border px-2 py-1 text-xs font-semibold',
              TONE_CHIP_CLASS[EQUIPMENT_STATUS_TONE[equipment.status]],
            )}
          >
            {EQUIPMENT_STATUS_LABELS[equipment.status]}
          </span>
        }
        actions={
          <>
            {canReport && (
              <Button variant="destructive" onClick={() => setReportOpen(true)}>
                <TriangleAlertIcon data-icon="inline-start" />
                Report problem
              </Button>
            )}
            {canContact && defaultSupplier !== null && (
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
            {canEdit && (
              <Button variant="outline" onClick={() => setStatusOpen(true)}>
                <WrenchIcon data-icon="inline-start" />
                Status
              </Button>
            )}
            {canMove && (
              <Button variant="outline" onClick={() => setMoveOpen(true)}>
                <ArrowRightLeftIcon data-icon="inline-start" />
                Move
              </Button>
            )}
            {canEdit && (
              <Button onClick={() => setEditing(true)}>
                <PencilIcon data-icon="inline-start" />
                Edit
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="bg-muted aspect-square overflow-hidden rounded-xl border">
          {equipment.imageUrl !== null ? (
            <img src={equipment.imageUrl} alt={equipment.name} className="h-full w-full object-cover" />
          ) : (
            <div className="text-muted-foreground grid h-full place-items-center text-xs">
              No photo
            </div>
          )}
        </div>

        <dl className="bg-card grid grid-cols-2 gap-4 rounded-xl border p-4 sm:grid-cols-3 xl:grid-cols-4">
          <Detail label="Asset ID" value={equipment.assetId} />
          <Detail label="Category" value={equipment.categoryName ?? '—'} />
          <Detail label="Brand" value={equipment.brand ?? '—'} />
          <Detail label="Model" value={equipment.model ?? '—'} />
          <Detail label="Serial" value={equipment.serialNumber ?? '—'} />
          <Detail label="Manufacturer" value={equipment.manufacturer ?? '—'} />
          <Detail label="Purchased" value={formatDate(equipment.purchaseDate)} />
          <Detail label="Installed" value={formatDate(equipment.installationDate)} />
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs tracking-[0.04em] uppercase">Warranty</dt>
            <dd className="mt-0.5">
              <span
                className={cn(
                  'inline-flex rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                  TONE_CHIP_CLASS[WARRANTY_TONE[equipment.warrantyStatus]],
                )}
              >
                {equipment.warrantyStatus === 'UNKNOWN'
                  ? 'Not recorded'
                  : formatDate(equipment.warrantyExpiry)}
              </span>
            </dd>
          </div>
          <Detail label="Next service" value={dueLabel(equipment.maintenanceDaysUntilDue)} />
          <Detail label="Last service" value={formatDate(equipment.lastMaintenanceAt)} />
          <Detail
            label="Open tickets"
            value={
              equipment.openTicketCount === 0
                ? 'None'
                : `${equipment.openTicketCount} (${equipment.criticalTicketCount} critical)`
            }
          />
          <Detail label="QR payload" value={equipment.qrCode ?? '—'} />
        </dl>
      </div>

      <Tabs defaultValue="maintenance">
        <TabsList>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="maintenance" className="space-y-6">
          <section>
            <h2 className="font-heading mb-2 text-sm font-semibold">Open tickets</h2>
            {(equipment.openTickets ?? []).length === 0 ? (
              <EmptyState title="Nothing open" description="No maintenance is outstanding on this asset." />
            ) : (
              <ul className="divide-border bg-card divide-y rounded-xl border">
                {(equipment.openTickets ?? []).map((ticket) => (
                  <li key={ticket.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/maintenance/tickets/${ticket.id}`)}
                      className="focus-ring hover:bg-accent/50 flex w-full items-center gap-3 p-3 text-left"
                    >
                      <span className="text-muted-foreground font-mono text-xs">
                        {ticket.ticketNumber}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{ticket.title}</span>
                      <span
                        className={cn(
                          'rounded-sm border px-1.5 py-0.5 text-[0.7188rem] leading-none font-semibold',
                          TONE_CHIP_CLASS[TICKET_STATUS_TONE[ticket.status]],
                        )}
                      >
                        {MAINTENANCE_TICKET_STATUS_LABELS[ticket.status]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-heading mb-2 text-sm font-semibold">Preventive schedules</h2>
            {(equipment.schedules ?? []).length === 0 ? (
              <EmptyState
                title="No schedule"
                description="Add one from the Maintenance schedules page to have the server raise the service ticket itself."
              />
            ) : (
              <ul className="divide-border bg-card divide-y rounded-xl border">
                {(equipment.schedules ?? []).map((schedule) => (
                  <li key={schedule.id} className="flex items-center gap-3 p-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{schedule.title}</span>
                      <span className="text-muted-foreground block text-xs">
                        Every {schedule.frequency.toLowerCase().replace(/_/g, ' ')} · last done{' '}
                        {formatDate(schedule.lastPerformedAt)}
                      </span>
                    </span>
                    <Badge variant={(schedule.daysUntilDue ?? 0) < 0 ? 'destructive' : 'outline'}>
                      {dueLabel(schedule.daysUntilDue)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-heading mb-2 text-sm font-semibold">Warranties</h2>
            {(equipment.warranties ?? []).length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No warranty recorded. Attach the warranty card under Documents and the server reads
                the dates off it.
              </p>
            ) : (
              <ul className="divide-border bg-card divide-y rounded-xl border">
                {(equipment.warranties ?? []).map((warranty) => (
                  <li key={warranty.id} className="flex items-center gap-3 p-3 text-sm">
                    <span className="min-w-0 flex-1 truncate">{warranty.provider ?? 'Warranty'}</span>
                    <span className="text-muted-foreground text-xs">
                      {formatDate(warranty.startDate)} → {formatDate(warranty.expiryDate)}
                    </span>
                    {!warranty.isActive && <Badge variant="secondary">Superseded</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabsContent>

        <TabsContent value="suppliers" className="space-y-4">
          {(equipment.suppliers ?? []).length === 0 ? (
            <EmptyState
              title="No supplier linked"
              description="Link one so Call and WhatsApp reach the right people without anybody looking up a number."
            />
          ) : (
            <ul className="divide-border bg-card divide-y rounded-xl border">
              {(equipment.suppliers ?? []).map((link) => (
                <li key={link.id} className="flex flex-wrap items-center gap-3 p-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{link.supplierName}</span>
                    <span className="text-muted-foreground block text-xs">
                      {EQUIPMENT_SUPPLIER_ROLE_LABELS[link.role]} ·{' '}
                      {link.contactPerson ?? 'No contact person'} · {link.phone ?? 'No phone'}
                    </span>
                  </span>
                  {link.isDefault && <Badge>Default</Badge>}
                  {canManageSuppliers && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        removeLink
                          .mutateAsync({ id: equipment.id, role: link.role })
                          .then(() => notify.success('Supplier unlinked.'))
                          .catch((err: unknown) => notify.fromError(err));
                      }}
                    >
                      Unlink
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canManageSuppliers && (
            <div className="bg-card grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_200px_auto] sm:items-end">
              <SelectField
                label="Supplier"
                value={supplierId}
                onChange={setSupplierId}
                placeholder="Choose a supplier"
                options={(suppliers?.items ?? []).map((supplier) => ({
                  value: supplier.id,
                  label: supplier.name,
                }))}
              />
              <SelectField
                label="Role"
                value={supplierRole}
                onChange={(next) => setSupplierRole(next as EquipmentSupplierRoleType)}
                options={Object.values(EquipmentSupplierRole).map((value) => ({
                  value,
                  label: EQUIPMENT_SUPPLIER_ROLE_LABELS[value],
                }))}
              />
              <Button onClick={() => void onSetSupplier()} disabled={supplierId === '' || setLink.isPending}>
                Link supplier
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          {canUpload && (
            <div className="bg-card grid gap-3 rounded-xl border p-4 sm:grid-cols-[240px_auto] sm:items-end">
              <SelectField
                label="Document type"
                value={docType}
                onChange={(next) => setDocType(next as EquipmentDocumentType)}
                options={Object.values(EquipmentDocumentType).map((value) => ({
                  value,
                  label: EQUIPMENT_DOCUMENT_TYPE_LABELS[value],
                }))}
              />
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void onUploadDocument(file);
                  }}
                />
                <Button
                  variant="outline"
                  disabled={upload.isPending || addDocument.isPending}
                  onClick={() => fileRef.current?.click()}
                >
                  {upload.isPending || addDocument.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <UploadIcon data-icon="inline-start" />
                  )}
                  Attach document
                </Button>
              </div>
            </div>
          )}

          {(equipment.documents ?? []).length === 0 ? (
            <EmptyState
              title="No documents"
              description="Warranty cards, invoices, installation reports and service reports live here."
            />
          ) : (
            <ul className="divide-border bg-card divide-y rounded-xl border">
              {(equipment.documents ?? []).map((document) => (
                <li key={document.id} className="flex items-center gap-3 p-3">
                  <FileTextIcon className="text-muted-foreground size-4 shrink-0" />
                  <a
                    href={document.url}
                    target="_blank"
                    rel="noreferrer"
                    className="focus-ring min-w-0 flex-1 truncate text-sm hover:underline"
                  >
                    {document.title ?? document.fileName}
                  </a>
                  <Badge variant="outline">{EQUIPMENT_DOCUMENT_TYPE_LABELS[document.docType]}</Badge>
                  <span className="text-muted-foreground text-xs">
                    {formatDate(document.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="timeline">
          {(activity ?? []).length === 0 ? (
            <EmptyState title="Nothing has happened yet" />
          ) : (
            <ol className="divide-border bg-card divide-y rounded-xl border">
              {(activity ?? []).map((entry) => (
                <li key={entry.id} className="p-3">
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
                    {entry.actorRole !== null ? ` · ${entry.actorRole}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>

        <TabsContent value="history">
          {(statusHistory ?? []).length === 0 ? (
            <EmptyState title="No status changes recorded" />
          ) : (
            <ol className="divide-border bg-card divide-y rounded-xl border">
              {(statusHistory ?? []).map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                  <span>
                    {entry.fromStatus === null
                      ? EQUIPMENT_STATUS_LABELS[entry.toStatus]
                      : `${EQUIPMENT_STATUS_LABELS[entry.fromStatus]} → ${EQUIPMENT_STATUS_LABELS[entry.toStatus]}`}
                  </span>
                  {entry.note !== null && (
                    <span className="text-muted-foreground text-xs">{entry.note}</span>
                  )}
                  <span className="text-muted-foreground ml-auto text-xs">
                    {entry.changedByName ?? 'System'} · {formatDateTime(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
      </Tabs>

      <EquipmentFormModal open={editing} onClose={() => setEditing(false)} editing={equipment} />
      <EquipmentStatusModal
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        equipment={equipment}
      />
      <EquipmentMoveModal open={moveOpen} onClose={() => setMoveOpen(false)} equipment={equipment} />
      <ReportProblemModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        equipment={equipment}
      />
    </>
  );
}
