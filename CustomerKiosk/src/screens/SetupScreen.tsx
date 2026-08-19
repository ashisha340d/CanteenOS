import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangleIcon,
  CheckIcon,
  LockIcon,
  MonitorSmartphoneIcon,
  PrinterIcon,
  RefreshCwIcon,
  UsbIcon,
} from 'lucide-react';
import type {
  BillingIdentity,
  KioskDeviceSummaryDto,
  KioskProfileDto,
  ReceiptColumns,
} from '@menuboard/shared';
import { useLanguage } from '../i18n';
import { listKioskDevices, signIn } from '../api/kiosk';
import { readErrorMessage } from '../api/client';
import { writeDeviceBinding, type KioskDeviceBinding } from '../config/device';
import { hasSession } from '../api/session';
import {
  describePrinter,
  pairedPrinter,
  requestPrinter,
  testSlipBytes,
  usbSupported,
} from '../print';
import { printOverUsb } from '../print/usb';
import { Action } from '../components/Buttons';
import { MandirPanel } from '../components/Mandir';
import { LotusMark } from '../components/Marks';

interface SetupScreenProps {
  existing: KioskDeviceBinding | null;
  /**
   * Forces the password step even though the tablet already holds a session. Set when an
   * already-provisioned kiosk is reopened for settings: the device stands in a public hall,
   * and a long press must not be enough to re-point it at a different stand.
   */
  requireSignIn?: boolean;
  /** What the Admin Portal has decided, shown here read-only so staff can see it took effect. */
  profile: KioskProfileDto | null;
  onReady: (binding: KioskDeviceBinding) => void;
  onCancel?: () => void;
}

/**
 * Provisioning, for staff — and it is now one question.
 *
 * This screen used to be the whole configuration of a stand: a menu, a station, a display name
 * in two scripts, a payee, a VPA. All of that has moved to the `kiosk_devices` registry in the
 * Admin Portal, where it can be compared across a hall, audited, and changed from a desk. What
 * is left here is the one thing a desk cannot answer — *which stand is this tablet standing at*
 * — and the one thing a browser will not let a desk do: hand over a USB printer, which requires
 * a gesture made on the machine the printer is plugged into.
 *
 * The side panel is not decoration for its own sake. This is the only screen in the kiosk a
 * member of staff waits at rather than moves through, and a full-bleed form on a 27-inch panel
 * is a form floating in a field of nothing.
 */
export function SetupScreen({
  existing,
  requireSignIn = false,
  profile,
  onReady,
  onCancel,
}: SetupScreenProps): JSX.Element {
  const { t } = useLanguage();
  const [signedIn, setSignedIn] = useState(hasSession() && !requireSignIn);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(existing?.code ?? null);

  const devices = useQuery({
    queryKey: ['kiosk-devices'],
    queryFn: listKioskDevices,
    enabled: signedIn,
    // An operator registering the stand in the portal while a member of staff waits at the
    // tablet should not have to explain that somebody needs to reload the browser.
    refetchInterval: 20_000,
  });

  // A tablet bound to a stand that has since been deleted or deactivated must not sit on a
  // greyed-out selection nobody can act on; the choice is dropped and the picker is honest.
  const rows = devices.data ?? [];
  const stale =
    existing !== null && rows.length > 0 && !rows.some((row) => row.code === existing.code);

  useEffect(() => {
    if (stale) setChosen(null);
  }, [stale]);

  const submitSignIn = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(identifier.trim(), password);
      setPassword('');
      setSignedIn(true);
    } catch (caught) {
      setError(readErrorMessage(caught, t('error.offline')));
    } finally {
      setBusy(false);
    }
  };

  const launch = (): void => {
    if (chosen === null) return;
    const binding: KioskDeviceBinding = { code: chosen };
    writeDeviceBinding(binding);
    onReady(binding);
  };

  return (
    <div className="grid min-h-full grid-cols-1 bg-canvas lg:grid-cols-[minmax(0,1fr)_38%]">
      <div className="flex items-center justify-center px-6 py-12">
        <div className="animate-emerge w-full max-w-2xl rounded-lg border border-line bg-surface p-9 shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-3.5">
            <span className="grid size-11 place-items-center rounded-full border border-trim-soft text-trim">
              <LotusMark className="size-6" />
            </span>
            <div>
              <h1 className="font-display text-2xl tracking-[-0.015em]">{t('setup.title')}</h1>
              <p className="text-sm text-ink-soft">{t('setup.body')}</p>
            </div>
          </div>

          {error !== null && (
            <p className="mt-6 rounded-sm border border-danger/30 bg-danger-tint px-4 py-3 text-sm text-danger">
              {error}
            </p>
          )}

          {stale && (
            <p className="mt-6 flex items-start gap-2.5 rounded-sm border border-trim-soft bg-accent-tint px-4 py-3 text-sm text-ink-soft">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-trim" />
              {t('setup.unknownDevice')}
            </p>
          )}

          {!signedIn ? (
            <form onSubmit={submitSignIn} className="mt-7 grid gap-4">
              <Field label={t('setup.identifier')}>
                <input
                  className={INPUT}
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  autoComplete="username"
                  required
                />
              </Field>
              <Field label={t('setup.password')}>
                <input
                  className={INPUT}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </Field>
              <div className="mt-2 flex items-center justify-between gap-4">
                <p className="flex items-center gap-2 text-xs text-ink-faint">
                  <LockIcon className="size-3.5" />
                  Kiosk sessions can read the menu and take payment. Nothing else.
                </p>
                <Action type="submit" disabled={busy}>
                  {busy ? t('setup.signingIn') : t('setup.signIn')}
                </Action>
              </div>
            </form>
          ) : (
            <div className="mt-7 grid gap-6">
              <DevicePicker
                devices={rows}
                loading={devices.isLoading}
                chosen={chosen}
                onChoose={setChosen}
                onRefresh={() => void devices.refetch()}
              />

              <PrinterSection profile={profile} />

              {profile !== null && <ManagedSummary profile={profile} />}

              <div className="flex items-center justify-end gap-3">
                {onCancel !== undefined && (
                  <Action variant="ghost" onClick={onCancel}>
                    {t('setup.close')}
                  </Action>
                )}
                <Action size="lg" onClick={launch} disabled={chosen === null}>
                  {t('setup.launch')}
                </Action>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Hidden below `lg`: on a tablet held in portrait the form needs the whole width, and a
          panel squeezed into a quarter of it is a stripe rather than a picture. */}
      <MandirPanel className="hidden lg:block" />
    </div>
  );
}

/**
 * Which stand this is, as a list of stands rather than as a text field.
 *
 * A typed code is a typo waiting to happen at six in the morning, and a wrong code binds a
 * tablet to another hall's payee. The registry is small enough to show whole.
 */
function DevicePicker({
  devices,
  loading,
  chosen,
  onChoose,
  onRefresh,
}: {
  devices: KioskDeviceSummaryDto[];
  loading: boolean;
  chosen: string | null;
  onChoose: (code: string) => void;
  onRefresh: () => void;
}): JSX.Element {
  const { t } = useLanguage();

  return (
    <fieldset className="rounded-md border border-line bg-canvas p-5">
      <legend className="flex items-center gap-2 px-2 text-2xs text-ink-faint uppercase">
        <MonitorSmartphoneIcon className="size-3.5" />
        {t('setup.pick')}
      </legend>

      {loading ? (
        <p className="py-4 text-center text-sm text-ink-faint">{t('menu.loading')}</p>
      ) : devices.length === 0 ? (
        <div className="py-4 text-center">
          <p className="text-sm font-medium">{t('setup.noDevices')}</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-ink-faint">{t('setup.noDevicesBody')}</p>
          <Action variant="quiet" className="mt-3" onClick={onRefresh}>
            <RefreshCwIcon className="size-4" />
            {t('setup.reload')}
          </Action>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-ink-faint">{t('setup.pickBody')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {devices.map((device) => (
              <button
                key={device.id}
                type="button"
                onClick={() => onChoose(device.code)}
                className={`press flex min-h-16 flex-col items-start justify-center gap-0.5 rounded-sm border px-4 py-3 text-left ${
                  chosen === device.code
                    ? 'border-accent bg-accent-tint text-accent'
                    : 'border-line bg-surface hover:border-accent/40'
                }`}
              >
                <span className="flex w-full items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-base">{device.label}</span>
                  {chosen === device.code && <CheckIcon className="size-4 shrink-0" />}
                </span>
                <span className="numeric truncate text-2xs tracking-[0.12em] text-ink-faint uppercase">
                  {device.code}
                  {device.stationName !== null && ` · ${device.stationName}`}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </fieldset>
  );
}

/**
 * Pairing the printer.
 *
 * WebUSB only opens its chooser in response to a click, which is exactly right here and
 * exactly wrong in the guest flow — so the one gesture that grants the tablet its printer
 * happens once, on this screen, by a member of staff. The grant is remembered per origin and
 * survives reloads and power cycles, so nobody is asked again.
 *
 * Note what is *not* here any more: the choice of transport. That is a field on the stand's row
 * in the Admin Portal, because which printer a counter uses is an operations decision and not
 * something a tablet should be able to disagree with the office about.
 */
function PrinterSection({ profile }: { profile: KioskProfileDto | null }): JSX.Element {
  const { t } = useLanguage();
  const [device, setDevice] = useState<USBDevice | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const supported = usbSupported();

  useEffect(() => {
    void pairedPrinter().then(setDevice);
  }, []);

  const pair = async (): Promise<void> => {
    setStatus(null);
    try {
      setDevice(await requestPrinter());
    } catch (error) {
      // A staff member closing the chooser is not a failure worth shouting about.
      if (error instanceof DOMException && error.name === 'NotFoundError') return;
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const test = async (): Promise<void> => {
    if (device === null) return;
    setStatus(null);
    try {
      const identity: BillingIdentity = {
        legalName: profile?.legalName ?? 'MenuBoard',
        addressLine: profile?.addressLine ?? '',
        gstin: profile?.gstin ?? '',
        footer: profile?.receiptFooter ?? '',
      };
      const bytes = testSlipBytes(identity, (profile?.receiptColumns ?? 48) as ReceiptColumns);
      await printOverUsb(device, bytes);
      setStatus(t('print.done'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <fieldset className="rounded-md border border-line bg-canvas p-5">
      <legend className="flex items-center gap-2 px-2 text-2xs text-ink-faint uppercase">
        <PrinterIcon className="size-3.5" />
        {t('setup.printer')}
      </legend>

      <p className="text-xs text-ink-faint">{t('setup.printerBody')}</p>

      {!supported ? (
        <p className="mt-3 text-xs text-ink-faint">{t('setup.printerUsbUnsupported')}</p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {device !== null ? (
            <span className="flex items-center gap-2 text-xs text-veg">
              <CheckIcon className="size-4" />
              {describePrinter(device)}
            </span>
          ) : (
            <span className="text-xs text-ink-faint">{t('setup.printerUsbPaired')}: —</span>
          )}
          <Action variant="quiet" onClick={() => void pair()}>
            <UsbIcon className="size-4" />
            {t('setup.printerUsb')}
          </Action>
          {device !== null && (
            <Action variant="ghost" onClick={() => void test()}>
              {t('setup.printerTest')}
            </Action>
          )}
        </div>
      )}

      {status !== null && <p className="mt-3 text-xs text-ink-soft">{status}</p>}
    </fieldset>
  );
}

/** What the Admin Portal owns, shown so staff can confirm the tablet picked it up. */
function ManagedSummary({ profile }: { profile: KioskProfileDto }): JSX.Element {
  const { t } = useLanguage();
  const rows: [string, string][] = [
    ['Stand', profile.device === null ? '—' : `${profile.device.label} (${profile.device.code})`],
    ['Menu', profile.device?.menuName ?? profile.device?.menuCode ?? '—'],
    ['Pays to', profile.device?.upiVpa === '' ? '—' : (profile.device?.upiVpa ?? '—')],
    ['Printer', profile.device?.receiptTransport ?? '—'],
    ['Skin', profile.skin],
    ['Language', profile.languageMode],
    ['Legal name', profile.legalName],
    ['GSTIN', profile.gstin === '' ? '—' : profile.gstin],
    ['Suggestions', profile.recommendations],
    ['Bill on WhatsApp', profile.whatsappBillEnabled ? 'On' : 'Off'],
  ];

  return (
    <div className="rounded-md border border-line bg-canvas p-5">
      <p className="text-2xs text-ink-faint uppercase">{t('setup.managed')}</p>
      <p className="mt-1 text-xs text-ink-soft">{t('setup.managedBody')}</p>
      <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 text-xs">
            <dt className="text-ink-faint">{label}</dt>
            <dd className="truncate text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const INPUT =
  'h-12 w-full rounded-sm border border-line bg-canvas px-3.5 text-base text-ink outline-none transition-colors focus:border-accent';

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="grid gap-1.5">
      <span className="text-2xs text-ink-faint uppercase">{label}</span>
      {children}
    </label>
  );
}
