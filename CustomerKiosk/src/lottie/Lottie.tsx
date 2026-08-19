import { useEffect, useRef } from 'react';
import lottie, { type AnimationItem } from 'lottie-web/build/player/lottie_light';
import { LOTTIE, type LottieName } from './animations';

interface LottieMarkProps {
  name: LottieName;
  /** Rendered edge length in CSS pixels; the artwork is square and scales to it. */
  size: number;
  loop?: boolean;
  className?: string;
  /** Announced to screen readers; omit for a mark that only decorates. */
  label?: string;
  onComplete?: () => void;
}

/**
 * A Lottie mark, tinted by the skin.
 *
 * Three deliberate choices. The *light* player is imported rather than the full build: the
 * kiosk needs the SVG renderer and nothing else, and the expression engine it drops is a
 * third of the bytes on a tablet that reloads over hall wifi. The animation data is generated
 * locally rather than fetched, so a slow morning on the hall's connection cannot leave a
 * loader that never appears. And the whole mark inherits `currentColor` through
 * `.lottie-tint`, so one file serves four skins instead of four files serving one each.
 */
export function LottieMark({
  name,
  size,
  loop = true,
  className = '',
  label,
  onComplete,
}: LottieMarkProps): JSX.Element {
  const host = useRef<HTMLSpanElement>(null);
  // Kept in a ref so a re-render that changes only `onComplete` does not restart the mark
  // half-way through — a success animation that replays looks like a second success.
  const complete = useRef(onComplete);
  complete.current = onComplete;

  useEffect(() => {
    const container = host.current;
    if (container === null) return;

    let animation: AnimationItem | null = lottie.loadAnimation({
      container,
      renderer: 'svg',
      loop,
      autoplay: true,
      animationData: LOTTIE[name](),
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: false },
    });

    const finished = (): void => complete.current?.();
    animation.addEventListener('complete', finished);

    return () => {
      animation?.removeEventListener('complete', finished);
      animation?.destroy();
      animation = null;
    };
  }, [name, loop]);

  return (
    <span
      ref={host}
      className={`lottie-tint block ${className}`}
      style={{ width: size, height: size }}
      role={label === undefined ? 'presentation' : 'img'}
      aria-label={label}
      aria-hidden={label === undefined}
    />
  );
}
