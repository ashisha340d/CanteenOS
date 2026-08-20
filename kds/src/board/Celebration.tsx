import { useEffect, useMemo, useState } from 'react';
import Lottie from 'lottie-react';
import celebrationAnimation from '../assets/celebration.json';
import { CELEBRATION_PHRASES, useT } from '../i18n';
import './celebration.css';

/**
 * The all-clear runs as three acts rather than one fade, because a moment that only appears and
 * disappears reads as a popup — and the board clearing is the best thing that happens all shift.
 *
 *   enter   the wall dims, a shockwave goes out, confetti fires, the phrase lands
 *   hold    the phrase breathes and the light drifts; the counter gets to look at it
 *   leave   everything lifts and dissolves, and the board is handed back
 *
 * Four and a bit seconds end to end. Long enough to feel like an event, short enough that a
 * counter watching the door does not start waiting for it to be over.
 */
const ENTER_MS = 900;
const HOLD_MS = 2_600;
const LEAVE_MS = 700;

type Act = 'enter' | 'hold' | 'leave';

/** How many sparks fly out. Enough to fill the arc, few enough to stay sharp on a wall screen. */
const SPARKS = 14;

/**
 * The all-clear moment: everything served, nothing waiting.
 *
 * Gone *immediately* if an order arrives in the meantime — a celebration covering a fresh
 * ticket is worse than no celebration, so the board's own arrival cancels it outright rather
 * than letting it play out its remaining seconds.
 */
export function Celebration({
  onDone,
  interrupted = false,
}: {
  onDone: () => void;
  /** An order landed while this was on screen. Clear out of the way at once. */
  interrupted?: boolean;
}): JSX.Element {
  const t = useT();
  const phrase = useMemo(
    () => CELEBRATION_PHRASES[Math.floor(Math.random() * CELEBRATION_PHRASES.length)],
    [],
  );
  const [visible, setVisible] = useState(true);
  const [act, setAct] = useState<Act>('enter');

  useEffect(() => {
    const toHold = window.setTimeout(() => setAct('hold'), ENTER_MS);
    const toLeave = window.setTimeout(() => setAct('leave'), ENTER_MS + HOLD_MS);
    const toDone = window.setTimeout(() => {
      setVisible(false);
      onDone();
    }, ENTER_MS + HOLD_MS + LEAVE_MS);
    return () => {
      window.clearTimeout(toHold);
      window.clearTimeout(toLeave);
      window.clearTimeout(toDone);
    };
  }, [onDone]);

  // An arriving order does not get an exit animation: it wants the wall now.
  useEffect(() => {
    if (!interrupted) return;
    setVisible(false);
    onDone();
  }, [interrupted, onDone]);

  if (!visible) return <></>;

  return (
    <div className={`kds-celebrate kds-celebrate--${act}`} role="status" aria-live="polite">
      {/* Layer 1: the light. A slow aurora behind everything, and two rings thrown outward
          from the centre on the first beat — the visual thump the moment needs to land. */}
      <div className="kds-celebrate__aurora" aria-hidden="true" />
      <div className="kds-celebrate__shock" aria-hidden="true" />
      <div className="kds-celebrate__shock kds-celebrate__shock--late" aria-hidden="true" />

      {/* Layer 2: sparks, thrown along evenly spaced angles so the burst reads as radial
          rather than random. The angle and a per-spark delay are the only things that differ,
          which keeps this to one keyframe instead of fourteen. */}
      <div className="kds-celebrate__sparks" aria-hidden="true">
        {Array.from({ length: SPARKS }, (_, index) => (
          <span
            key={index}
            style={
              {
                '--angle': `${(360 / SPARKS) * index}deg`,
                '--delay': `${index * 26}ms`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <Lottie
        animationData={celebrationAnimation}
        loop={false}
        className="kds-celebrate__lottie"
        style={{ width: 460, maxWidth: '64vw' }}
      />

      {/* Layer 3: the words. The phrase rises into place and a highlight sweeps across it once
          it has settled, which is what makes it read as celebratory rather than merely large. */}
      <div className="kds-celebrate__words">
        <p className="kds-celebrate__phrase" data-text={phrase}>
          {phrase}
        </p>
        <p className="kds-celebrate__sub">
          <span className="kds-celebrate__tick" aria-hidden="true" />
          {t.boardClear}
        </p>
      </div>
    </div>
  );
}
