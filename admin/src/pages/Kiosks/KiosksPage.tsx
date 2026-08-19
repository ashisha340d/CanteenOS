import { useState } from 'react';
import {
  MasterStatus,
  ReceiptTransport,
  type KioskDeviceDto,
  type KioskSkin,
} from '@menuboard/shared';
import {
  CopyIcon,
  ExternalLinkIcon,
  MonitorSmartphoneIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UsbIcon,
  WifiIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatGridSkeleton } from '../../components/ui/Skeletons';
import { useDeleteKioskDevice, useKioskDevices, useSettings } from '../../hooks/useAdmin';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { KioskDeviceModal } from './KioskDeviceModal';
import { KioskLookPanel } from './KioskLookPanel';
import { PortalSettings } from './PortalSettings';

/**
 * The self-service stands, and how the organisation wants them to look.
 *
 * Every stand in a hall used to be provisioned by walking to it, unlocking a hidden settings
 * screen and typing a menu code, a payee and a UPI ID into that one browser's local storage.
 * That is workable for one kiosk and indefensible for six: the settings could not be compared,
 * could not be audited, and re-pointing the hall at a festival menu meant six walks.
 *
 * This page is the replacement. A stand is a row; the tablet holds nothing but the code that
 * names it and the USB grant a browser will only give to a gesture made at the machine itself.
 */
export function KiosksPage(): JSX.Element {
  const devices = useKioskDevices();
  const settings = useSettings();
  const remove = useDeleteKioskDevice();
  const [editing, setEditing] = useState<KioskDeviceDto | null>(null);
  const [composing, setComposing] = useState(false);

  const skin = readSetting<KioskSkin>(settings.data, 'kiosk.skin', 'SANDALWOOD' as KioskSkin);

  if (devices.isLoading || settings.isLoading) return <StatGridSkeleton count={3} />;

  async function onDelete(device: KioskDeviceDto): Promise<void> {
    if (!window.confirm(`Remove the kiosk “${device.label}”? Any tablet still on it stops.`)) {
      return;
    }
    try {
      await remove.mutateAsync(device.id);
    } catch (err) {
      notify.fromError(err);
    }
  }

  const rows = devices.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Records"
        title="Self-service kiosks"
        subtitle="Every stand in the hall, and the look they all share. A tablet holds only the code that names it — everything else is set here."
        meta={
          rows.length > 0 ? (
            <Badge variant="secondary">
              {rows.length} {rows.length === 1 ? 'stand' : 'stands'}
            </Badge>
          ) : undefined
        }
        actions={
          <Button onClick={() => setComposing(true)}>
            <PlusIcon className="size-4" />
            New kiosk
          </Button>
        }
      />

      <div className="flex flex-col gap-10">
        <section>
          <h2 className="font-heading text-base font-semibold">Stands</h2>
          <p className="text-muted-foreground mt-0.5 mb-3 text-sm">
            The code is what a member of staff types into the tablet once. Everything beside it
            reaches the stand within a minute of being saved, with nobody walking over.
          </p>

          <KioskAppUrl />

          {rows.length === 0 ? (
            <EmptyState
              icon={<MonitorSmartphoneIcon className="size-6" />}
              title="No kiosk has been registered yet"
              description="Register a stand here, then open the kiosk on the tablet and enter its code once."
              action={{ label: 'New kiosk', onClick: () => setComposing(true) }}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((device) => (
                <DeviceCard
                  key={device.id}
                  device={device}
                  onEdit={() => setEditing(device)}
                  onDelete={() => void onDelete(device)}
                />
              ))}
            </div>
          )}
        </section>

        <KioskLookPanel settings={settings.data ?? []} skin={skin} />

        <section>
          <h2 className="font-heading text-base font-semibold">Settings</h2>
          <p className="text-muted-foreground mt-0.5 mb-3 text-sm">
            Portal-wide configuration. Each change saves on its own — there is no global save.
          </p>
          <PortalSettings settings={settings.data ?? []} />
        </section>
      </div>

      <KioskDeviceModal
        open={composing || editing !== null}
        editing={editing}
        onClose={() => {
          setComposing(false);
          setEditing(null);
        }}
      />
    </>
  );
}

/**
 * One stand. The heartbeat is the point of the card: an operator two floors from the hall has
 * no other way to tell a kiosk that is switched off from one that is switched on and broken.
 */
function DeviceCard({
  device,
  onEdit,
  onDelete,
}: {
  device: KioskDeviceDto;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const live = isRecent(device.lastSeenAt);
  const inactive = device.status !== MasterStatus.ACTIVE;

  return (
    <article
      className={cn(
        'bg-card flex flex-col gap-3 rounded-xl border p-4 transition-colors',
        inactive && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{device.label}</p>
          <p className="text-muted-foreground mt-0.5 font-mono text-xs">{device.code}</p>
        </div>
        <span
          className={cn(
            'mt-1 inline-flex shrink-0 items-center gap-1.5 text-xs',
            live ? 'text-tone-success' : 'text-muted-foreground',
          )}
          title={
            device.lastSeenAt === null
              ? 'No tablet has ever opened this kiosk'
              : `Last seen ${new Date(device.lastSeenAt).toLocaleString()}`
          }
        >
          <span
            className={cn(
              'size-2 rounded-full',
              live ? 'bg-tone-success motion-safe:animate-pulse' : 'bg-muted-foreground/40',
            )}
          />
          {live ? 'Live' : device.lastSeenAt === null ? 'Never seen' : 'Idle'}
        </span>
      </div>

      <dl className="grid gap-1 text-xs">
        <Row label="Shows as">{device.outletName}</Row>
        <Row label="Menu">{device.menuName ?? device.menuCode}</Row>
        <Row label="Station">{device.stationName ?? '—'}</Row>
        <Row label="Pays to">
          <span className="font-mono">{device.upiVpa === '' ? '—' : device.upiVpa}</span>
        </Row>
      </dl>

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
          {device.receiptTransport === ReceiptTransport.USB ? (
            <UsbIcon className="size-3.5" />
          ) : (
            <WifiIcon className="size-3.5" />
          )}
          {device.receiptTransport === ReceiptTransport.USB
            ? 'Its own USB printer'
            : 'Counter printer'}
          {device.categoryOrder.length > 0 && <span>· sorted</span>}
        </span>
        <span className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${device.label}`}>
            <PencilIcon className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            aria-label={`Remove ${device.label}`}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </span>
      </div>
    </article>
  );
}

/**
 * The kiosk web app's own URL, to open on a tablet and check.
 *
 * Provisioning a stand still ends with a human at the tablet: this URL loads the setup screen,
 * where staff type the kiosk code registered above once. There is one kiosk app, not one per
 * stand, so this is a single link rather than something per `DeviceCard` — Digital Menu Boards
 * has a per-screen URL because each screen already names itself in the query string; a kiosk
 * names itself only after the tablet asks.
 */
function KioskAppUrl(): JSX.Element {
  const url = kioskAppUrl();

  return (
    <div className="bg-muted/40 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">Kiosk app</p>
        <p className="text-muted-foreground truncate font-mono text-xs">{url}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="ghost" onClick={() => void copyUrl(url)}>
          <CopyIcon className="size-3.5" />
          Copy URL
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <a href={url} target="_blank" rel="noreferrer" aria-label="Open the kiosk app">
            <ExternalLinkIcon className="size-3.5" />
            Open to check
          </a>
        </Button>
      </div>
    </div>
  );
}

/**
 * `VITE_KIOSK_APP_URL` is baked in at build time, same reasoning as `VITE_API_BASE_URL` in
 * `api/client.ts`: a hard-coded `localhost` only works when the admin UI itself was opened
 * from `localhost`, and swaps to the admin UI's own hostname on a LAN or Tailscale address so
 * this link works from wherever the portal was opened. `5180` is the kiosk app's documented
 * dev port (docs/AGENTS.md); a deployment that hosts it elsewhere sets the env var.
 */
const DEFAULT_KIOSK_APP_PORT = 5180;
function kioskAppUrl(): string {
  const configured = import.meta.env.VITE_KIOSK_APP_URL as string | undefined;
  if (configured) return configured;
  return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_KIOSK_APP_PORT}`;
}

async function copyUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    notify.success('URL copied');
  } catch {
    notify.error(`Could not copy. The URL is ${url}`);
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{children}</dd>
    </div>
  );
}

/**
 * A kiosk polls its profile once a minute, so anything seen inside three is a stand that is on.
 * The window is deliberately loose: a tablet that missed one poll over hall wifi is not news.
 */
function isRecent(stamp: string | null): boolean {
  if (stamp === null) return false;
  return Date.now() - Date.parse(stamp) < 3 * 60_000;
}

function readSetting<T>(
  settings: { key: string; value: unknown }[] | undefined,
  key: string,
  fallback: T,
): T {
  const found = settings?.find((setting) => setting.key === key);
  return found === undefined ? fallback : (found.value as T);
}
