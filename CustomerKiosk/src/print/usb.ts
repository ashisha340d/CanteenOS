/**
 * The kiosk's own printer, over WebUSB.
 *
 * This is the fast path and the reason it exists. `window.print()` opens a modal the guest
 * cannot dismiss, waits on a system spooler, and re-rasterises an HTML page into a bitmap the
 * printer then draws line by line — on a thermal roll that is several seconds of visible
 * grinding with a dialog sitting over the screen. A bulk transfer of ESC/POS bytes is one
 * write to a device the browser already holds open: the receipt starts before the guest has
 * looked up from the token.
 *
 * The permission model suits an unattended device better than it looks. A member of staff
 * pairs the printer once, on the setup screen, in response to their own click; the grant is
 * remembered per origin and survives reloads and power cycles, so nobody is ever asked again.
 * `navigator.usb.getDevices()` is how a device that was paired last month is found today.
 */

/** USB class 7 is "Printer" — the filter every ESC/POS roll printer answers to. */
const PRINTER_CLASS = 0x07;

export class UsbPrinterError extends Error {}

export function usbSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
}

/** A printer this origin has already been granted, or null. Never prompts. */
export async function pairedPrinter(): Promise<USBDevice | null> {
  if (!usbSupported()) return null;
  const devices = await navigator.usb.getDevices();
  return devices.find(isPrinter) ?? devices[0] ?? null;
}

/**
 * Opens the browser's device chooser. Must be called from a user gesture, which is why it
 * lives behind a button on the setup screen and is never reached from the guest flow.
 */
export async function requestPrinter(): Promise<USBDevice> {
  if (!usbSupported()) {
    throw new UsbPrinterError('This browser cannot reach a USB printer');
  }
  return navigator.usb.requestDevice({ filters: [{ classCode: PRINTER_CLASS }] });
}

/**
 * Writes one ESC/POS job and lets go of the device.
 *
 * The interface is claimed for the duration of the job rather than held open for the life of
 * the page: a kiosk that keeps an exclusive claim blocks every other process on the tablet
 * from the printer, and a browser tab that is discarded while holding one leaves the device
 * unusable until it is unplugged.
 */
export async function printOverUsb(device: USBDevice, payload: Uint8Array): Promise<number> {
  if (!device.opened) await device.open();

  try {
    if (device.configuration === null) await device.selectConfiguration(1);

    const endpoint = findBulkOut(device);
    if (endpoint === null) {
      throw new UsbPrinterError('That device has no printer endpoint');
    }

    await device.claimInterface(endpoint.interfaceNumber);
    try {
      // Copied into a plain ArrayBuffer: WebUSB refuses a view that might be backed by shared
      // memory, and the encoder makes no promise about which kind it returns.
      const frame = new Uint8Array(payload);
      const result = await device.transferOut(endpoint.endpointNumber, frame);
      if (result.status !== 'ok') {
        throw new UsbPrinterError(`The printer rejected the job (${result.status})`);
      }
      return result.bytesWritten;
    } finally {
      await device.releaseInterface(endpoint.interfaceNumber).catch(() => undefined);
    }
  } finally {
    // Closing is best-effort: a printer unplugged mid-job throws here, and that failure must
    // not replace the real one the caller needs to see.
    await device.close().catch(() => undefined);
  }
}

interface BulkOut {
  interfaceNumber: number;
  endpointNumber: number;
}

function isPrinter(device: USBDevice): boolean {
  if (device.configuration === null) return true;
  return device.configuration.interfaces.some(
    (candidate) => candidate.alternate.interfaceClass === PRINTER_CLASS,
  );
}

/**
 * The one bulk OUT endpoint on the printer interface. Composite devices — a printer with a
 * card reader, or a label printer exposing a vendor interface alongside the standard one —
 * present several, and writing ESC/POS to the wrong one silently prints nothing.
 */
function findBulkOut(device: USBDevice): BulkOut | null {
  const configuration = device.configuration;
  if (configuration === null) return null;

  const ordered = [...configuration.interfaces].sort((a, b) => {
    const aPrinter = a.alternate.interfaceClass === PRINTER_CLASS ? 0 : 1;
    const bPrinter = b.alternate.interfaceClass === PRINTER_CLASS ? 0 : 1;
    return aPrinter - bPrinter;
  });

  for (const candidate of ordered) {
    const endpoint = candidate.alternate.endpoints.find(
      (option) => option.direction === 'out' && option.type === 'bulk',
    );
    if (endpoint !== undefined) {
      return { interfaceNumber: candidate.interfaceNumber, endpointNumber: endpoint.endpointNumber };
    }
  }
  return null;
}

/** A short slip staff can print from the setup screen to prove the pairing works. */
export function describePrinter(device: USBDevice): string {
  const name = device.productName ?? 'USB printer';
  const maker = device.manufacturerName;
  return maker === undefined || maker === '' ? name : `${maker} ${name}`;
}
