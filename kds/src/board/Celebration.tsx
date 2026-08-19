import { useEffect, useMemo, useState } from 'react';
import Lottie from 'lottie-react';
import celebrationAnimation from '../assets/celebration.json';

const PHRASES = [
  'Radhey Radhey',
  'Hari Bol',
  'Jai Jai Shree Krishna',
  'Shree Mat Sadguru Sarkar',
] as const;

const DISPLAY_MS = 4500;

/**
 * The all-clear moment: a burst of confetti and a rotating devotional phrase when the board
 * runs dry. Auto-dismisses — nobody at a counter should have to close a celebration.
 */
export function Celebration({ onDone }: { onDone: () => void }): JSX.Element {
  const phrase = useMemo(() => PHRASES[Math.floor(Math.random() * PHRASES.length)], []);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setVisible(false);
      onDone();
    }, DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  if (!visible) return <></>;

  return (
    <div className="kds-celebrate" role="status" aria-live="polite">
      <Lottie animationData={celebrationAnimation} loop={false} style={{ width: 480, maxWidth: '70vw' }} />
      <p className="kds-celebrate__phrase">{phrase}</p>
      <p className="kds-celebrate__sub">Board clear — every order served.</p>
    </div>
  );
}
