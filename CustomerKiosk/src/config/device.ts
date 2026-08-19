/**
 * What this particular tablet is — which is now one string.
 *
 * This file used to hold the whole provisioning of a stand: its menu, its station, the payee
 * its QR named, the printer it drove. All of that has moved into the `kiosk_devices` registry
 * and is edited in the Admin Portal, because a hall runs several stands and settings that live
 * in four browsers' local storage cannot be compared, cannot be audited, and cannot be changed
 * without walking to each one.
 *
 * What is left is the only thing that genuinely belongs to the device: the *code* of the stand
 * it is standing at. The WebUSB grant is the other local thing, and it is not stored here at
 * all — the browser holds it, keyed to the origin, because a permission to touch hardware is
 * not something an application should be able to write down.
 */

const STORAGE_KEY = 'menuboard.kiosk.device';
/** What earlier builds wrote. Read once, for the code, then replaced. */
const LEGACY_KEY = 'menuboard.kiosk.device';

export interface KioskDeviceBinding {
  /** `kiosk_devices.code` — what the server resolves into everything else. */
  code: string;
}

export function readDeviceBinding(): KioskDeviceBinding | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<KioskDeviceBinding> & { menuCode?: string };
    if (typeof parsed.code === 'string' && parsed.code.trim() !== '') {
      return { code: parsed.code.trim() };
    }
    // A tablet provisioned before the registry existed holds a menu code and a payee rather
    // than a kiosk code. There is nothing to migrate it to — no row exists for it — so it is
    // treated as unprovisioned and staff pick the stand once. Deliberate: inventing a row from
    // a browser's local storage would let a tablet register a payee nobody approved.
    return null;
  } catch {
    return null;
  }
}

export function writeDeviceBinding(binding: KioskDeviceBinding): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(binding));
}

export function clearDeviceBinding(): void {
  localStorage.removeItem(LEGACY_KEY);
}

/**
 * No payment gateway is integrated (MENUBOARD_SPEC.md §3d). While this is on, the payment
 * screen says so on screen and offers staff an explicit "payment received" control instead of
 * pretending a bank confirmed anything.
 */
export const DEMO_PAYMENT = import.meta.env.VITE_KIOSK_DEMO_PAYMENT !== 'false';

/** How long the guest has to answer the "still ordering?" prompt before the kiosk resets. */
export const IDLE_RESET_AFTER_MS = 20_000;
/** How long the finished bill stays up before the kiosk returns to the menu. */
export const RECEIPT_HOLD_MS = 24_000;
/** How often the kiosk re-reads its profile, so a change in the portal reaches the hall. */
export const PROFILE_POLL_MS = 60_000;
