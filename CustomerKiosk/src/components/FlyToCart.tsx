import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * The dish going into the basket.
 *
 * A kiosk in a hall is read at arm's length by somebody who is not looking at it very hard, and
 * the moment that most often goes wrong is the first tap: a guest presses a card, the total in
 * the bar at the bottom changes by a number they were not watching, and they press again. The
 * fix is not a bigger badge — it is showing the thing *travelling*, so the eye is carried from
 * where the tap happened to where the consequence landed.
 *
 * Implementation notes worth keeping:
 *
 * - The flying element is a fixed-position clone drawn outside the scroll container, not the
 *   card itself. Animating the card would drag the grid's layout around under the guest's
 *   finger while they are still deciding what to press next.
 * - Coordinates are read once, at launch, from `getBoundingClientRect`. Reading them per frame
 *   would fight the menu's own scrolling.
 * - The trail is capped and self-clearing. An unattended kiosk runs for a day; a list of past
 *   animations that is only ever appended to is a slow leak.
 * - `prefers-reduced-motion` is honoured by the stylesheet rather than here, which collapses
 *   the flight to a millisecond — the badge still updates, so nothing is lost but the motion.
 */

interface Flight {
  id: number;
  from: { x: number; y: number; size: number };
  to: { x: number; y: number };
  imageUrl: string | null;
  initial: string;
}

interface FlyToCartValue {
  /** Called with the element that was tapped; the destination is wherever the basket is. */
  launch: (origin: Element | null, item: { imageUrl: string | null; name: string }) => void;
  /** The basket registers itself here so the flight has somewhere to land. */
  setTarget: (element: HTMLElement | null) => void;
  /** Bumped on arrival, so the basket can react at the moment the dish reaches it. */
  arrivals: number;
}

const FlyToCartContext = createContext<FlyToCartValue | null>(null);

/** Long enough to be followed by eye, short enough not to gate the next tap. */
const FLIGHT_MS = 620;

export function FlyToCartProvider({ children }: { children: ReactNode }): JSX.Element {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [arrivals, setArrivals] = useState(0);
  const target = useRef<HTMLElement | null>(null);
  const nextId = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
    },
    [],
  );

  const setTarget = useCallback((element: HTMLElement | null) => {
    target.current = element;
  }, []);

  const launch = useCallback<FlyToCartValue['launch']>((origin, item) => {
    const basket = target.current;
    if (origin === null || basket === null) return;

    const from = origin.getBoundingClientRect();
    const to = basket.getBoundingClientRect();
    // A card that has been scrolled off-screen cannot be flown from — its rectangle is behind
    // the guest, and a puck sliding up from nowhere reads as a glitch rather than as feedback.
    if (from.bottom < 0 || from.top > window.innerHeight) return;

    const id = nextId.current;
    nextId.current += 1;

    setFlights((current) => [
      // Capped: a guest tapping fast should see the last few, not a hundred pucks queued up.
      ...current.slice(-4),
      {
        id,
        from: {
          x: from.left + from.width / 2,
          y: from.top + from.height / 2,
          size: Math.min(96, Math.max(48, from.width * 0.42)),
        },
        to: { x: to.left + to.width / 2, y: to.top + to.height / 2 },
        imageUrl: item.imageUrl,
        initial: item.name.trim().charAt(0),
      },
    ]);

    const timer = window.setTimeout(() => {
      setFlights((current) => current.filter((flight) => flight.id !== id));
      setArrivals((count) => count + 1);
    }, FLIGHT_MS);
    timers.current = [...timers.current.slice(-8), timer];
  }, []);

  return (
    <FlyToCartContext.Provider value={{ launch, setTarget, arrivals }}>
      {children}
      <div className="pointer-events-none fixed inset-0 z-50" aria-hidden>
        {flights.map((flight) => (
          <span
            key={flight.id}
            className="kiosk-flight absolute grid place-items-center overflow-hidden rounded-full bg-surface shadow-[var(--shadow-lift)] ring-1 ring-trim-soft"
            style={
              {
                width: flight.from.size,
                height: flight.from.size,
                left: flight.from.x - flight.from.size / 2,
                top: flight.from.y - flight.from.size / 2,
                '--fly-x': `${flight.to.x - flight.from.x}px`,
                '--fly-y': `${flight.to.y - flight.from.y}px`,
              } as React.CSSProperties
            }
          >
            {flight.imageUrl !== null ? (
              <img src={flight.imageUrl} alt="" className="size-full object-cover" />
            ) : (
              <span className="font-display text-2xl text-trim">{flight.initial}</span>
            )}
          </span>
        ))}
      </div>
    </FlyToCartContext.Provider>
  );
}

/**
 * Outside the provider this is a no-op rather than a throw, unlike `useCart`. The difference is
 * deliberate: a screen without a cart is broken, but a screen without an animation is a screen.
 */
export function useFlyToCart(): FlyToCartValue {
  return (
    useContext(FlyToCartContext) ?? {
      launch: () => undefined,
      setTarget: () => undefined,
      arrivals: 0,
    }
  );
}
