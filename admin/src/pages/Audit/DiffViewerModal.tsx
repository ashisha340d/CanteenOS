import type { AuditLogDto } from '@menuboard/shared';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Modal } from '../../components/Modal/Modal';

function Json({ value }: { value: unknown }): JSX.Element {
  return (
    <pre className="bg-muted max-h-80 overflow-auto rounded-md p-3 font-mono text-xs">
      {value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">{label}:</span> {children}
    </p>
  );
}

export function DiffViewerModal({
  entry,
  onClose,
}: {
  entry: AuditLogDto | null;
  onClose: () => void;
}): JSX.Element {
  return (
    <Modal
      id="audit-diff"
      title={entry ? `${entry.action} — ${entry.entityType}` : 'Audit entry'}
      open={Boolean(entry)}
      onClose={onClose}
      minWidth={640}
      minHeight={420}
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      {entry && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <Fact label="Actor">
              {entry.actorName ?? entry.actorId ?? 'System'} ({entry.actorRole ?? '—'})
            </Fact>
            <Fact label="When">{new Date(entry.createdAt).toLocaleString()}</Fact>
            <Fact label="Entity">
              {entry.entityType} {entry.entityId}
            </Fact>
            <Fact label="IP">{entry.ip ?? '—'}</Fact>
          </div>

          <Separator />

          {/* Side by side where there is room, stacked on a phone — two 40%-width JSON
              columns are unreadable on a narrow screen. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="min-w-0">
              <h3 className="mb-1.5 text-sm font-medium">Before</h3>
              <Json value={entry.before} />
            </div>
            <div className="min-w-0">
              <h3 className="mb-1.5 text-sm font-medium">After</h3>
              <Json value={entry.after} />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
