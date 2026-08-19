import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Delete, Loader2, LockKeyhole } from 'lucide-react';
import { ERROR_CODES } from '@menuboard/shared';
import { loginWithPin } from '../api/auth';
import { readErrorCode, readErrorMessage } from '../api/client';
import { readSessionUser } from '../api/session';

interface Props {
  onUnlock: () => void;
  onSignOut: () => void;
}

const PIN_LENGTH = 4;
const KEYPAD_ROWS: string[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

/**
 * The board's screen lock. The session underneath stays alive — the queue keeps refetching —
 * but nobody touches the screen until the signed-in user taps their MPIN back in. A correct
 * MPIN also rotates the tokens, which is harmless.
 */
export function LockScreen({ onUnlock, onSignOut }: Props): JSX.Element {
  const user = readSessionUser();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const unlock = useMutation({
    mutationFn: (pinValue: string) => loginWithPin(user?.username ?? '', pinValue),
    onSuccess: onUnlock,
    onError: (err) => {
      setPin('');
      if (readErrorCode(err) === ERROR_CODES.RATE_LIMITED) {
        setError(readErrorMessage(err, 'Too many failed attempts. Sign out and sign in again.'));
        return;
      }
      setError(readErrorMessage(err, 'MPIN not accepted. Try again.'));
    },
  });

  const pressKey = (key: string): void => {
    if (unlock.isPending) return;
    setError(null);
    const next = (pin + key).slice(0, PIN_LENGTH);
    setPin(next);
    if (next.length === PIN_LENGTH) unlock.mutate(next);
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 bg-canvas px-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-surface">
          <LockKeyhole className="size-8 text-ink-soft" />
        </div>
        <h1 className="text-2xl">{user?.name ?? 'Screen locked'}</h1>
        <p className="mt-1 text-lg text-ink-soft">Tap your MPIN to unlock the board</p>
      </div>

      {user === null ? (
        <p className="max-w-md text-center text-base text-danger">
          No signed-in user is remembered on this display. Sign out and sign in again.
        </p>
      ) : (
        <>
          <div className="flex gap-4">
            {Array.from({ length: PIN_LENGTH }, (_, i) => (
              <div
                key={i}
                className={`size-5 rounded-full ${i < pin.length ? 'bg-accent' : 'bg-surface-raised'}`}
              />
            ))}
          </div>

          {error !== null && <p className="max-w-md text-center text-base text-danger">{error}</p>}

          <div className="grid grid-cols-3 gap-4">
            {KEYPAD_ROWS.flat().map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => pressKey(key)}
                className="flex h-24 w-24 items-center justify-center rounded-lg bg-surface text-2xl numeric active:bg-surface-raised"
              >
                {key}
              </button>
            ))}
            <span />
            <button
              type="button"
              onClick={() => pressKey('0')}
              className="flex h-24 w-24 items-center justify-center rounded-lg bg-surface text-2xl numeric active:bg-surface-raised"
            >
              0
            </button>
            <button
              type="button"
              onClick={() => setPin(pin.slice(0, -1))}
              className="flex h-24 w-24 items-center justify-center rounded-lg bg-surface text-ink-soft active:bg-surface-raised"
              aria-label="Delete digit"
            >
              <Delete className="size-8" />
            </button>
          </div>

          {unlock.isPending && <Loader2 className="size-8 animate-spin text-ink-soft" />}
        </>
      )}

      <button type="button" onClick={onSignOut} className="text-base text-ink-soft underline">
        Sign out instead
      </button>
    </div>
  );
}
