import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrCodeProps {
  value: string;
  /** Rendered size in CSS pixels; the bitmap is drawn at twice this for retina tablets. */
  size?: number;
  className?: string;
  alt: string;
}

/**
 * A QR code drawn locally.
 *
 * Deliberately not an image service: the kiosk has to keep working when the hall's internet
 * does not, and a payment code fetched from a third party would also hand that party the
 * payee's VPA and every bill amount.
 *
 * The one place in the kiosk that ignores the skin. Dark modules on a light field are what
 * every phone camera reads first try; an inverted code is a coin-flip on older Android
 * scanners, and the screen a guest is trying to pay at is the wrong place to spend that. In
 * the dark skin the resulting white plaque is not a mistake — a lit panel is exactly what a
 * scan target should look like in an unlit hall.
 */
export function QrCode({ value, size = 260, className = '', alt }: QrCodeProps): JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, {
      width: size * 2,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#141414ff', light: '#ffffffff' },
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl(null);
      });
    return () => {
      active = false;
    };
  }, [value, size]);

  return (
    <span
      className={`grid place-items-center overflow-hidden rounded-md bg-white ${className}`}
      style={{ width: size, height: size }}
    >
      {dataUrl !== null ? (
        <img src={dataUrl} alt={alt} width={size} height={size} className="animate-fade size-full" />
      ) : (
        <span className="size-full animate-pulse bg-canvas-deep" aria-hidden />
      )}
    </span>
  );
}
