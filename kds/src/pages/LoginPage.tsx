import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Delete, Loader2 } from 'lucide-react';
import { ERROR_CODES } from '@menuboard/shared';
import { loginWithPassword, loginWithPin } from '../api/auth';
import { readErrorCode, readErrorMessage } from '../api/client';

interface Props {
  onLoggedIn: () => void;
}

const PIN_LENGTH = 4;
const KEYPAD_ROWS: string[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

export function LoginPage({ onLoggedIn }: Props): JSX.Element {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [step, setStep] = useState<'credentials' | 'pin'>('credentials');
  const [passwordMode, setPasswordMode] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const passwordLogin = useMutation({
    mutationFn: () => loginWithPassword(identifier.trim(), password),
    onSuccess: onLoggedIn,
    onError: (err) => setError(readErrorMessage(err, 'Could not sign in. Check the connection.')),
  });

  const pinLogin = useMutation({
    mutationFn: (pinValue: string) => loginWithPin(identifier.trim(), pinValue),
    onSuccess: onLoggedIn,
    onError: (err) => {
      const code = readErrorCode(err);
      setPin('');
      if (code === ERROR_CODES.RATE_LIMITED) {
        // Locked out of MPIN for a while — the password step is the only way in.
        setError(readErrorMessage(err, 'Too many failed attempts. Sign in with your password.'));
        setStep('credentials');
        setPasswordMode(true);
        return;
      }
      // Wrong PIN, or no PIN configured for this account at all.
      setError(
        readErrorMessage(err, 'MPIN not accepted. Try again or sign in with your password.'),
      );
    },
  });

  const submitCredentials = (): void => {
    setError(null);
    if (passwordMode) {
      passwordLogin.mutate();
    } else {
      setStep('pin');
    }
  };

  const pressKey = (key: string): void => {
    if (pinLogin.isPending) return;
    setError(null);
    const next = (pin + key).slice(0, PIN_LENGTH);
    setPin(next);
    if (next.length === PIN_LENGTH) pinLogin.mutate(next);
  };

  const busy = passwordLogin.isPending;

  if (step === 'pin') {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-8 bg-canvas px-6">
        <div className="text-center">
          <p className="text-lg text-ink-soft">Signing in as</p>
          <h1 className="text-2xl">{identifier}</h1>
        </div>

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
          <button
            type="button"
            onClick={() => {
              setStep('credentials');
              setPin('');
              setError(null);
            }}
            className="flex h-24 w-24 items-center justify-center rounded-lg bg-surface text-ink-soft active:bg-surface-raised"
            aria-label="Back"
          >
            <ArrowLeft className="size-8" />
          </button>
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

        {pinLogin.isPending && <Loader2 className="size-8 animate-spin text-ink-soft" />}

        <button
          type="button"
          onClick={() => {
            setStep('credentials');
            setPasswordMode(true);
            setPin('');
            setError(null);
          }}
          className="text-base text-ink-soft underline"
        >
          Use password instead
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 bg-canvas px-6">
      <div className="text-center">
        <h1 className="text-3xl">Service KDS</h1>
        <p className="mt-2 text-lg text-ink-soft">Staff sign-in</p>
      </div>

      <form
        className="flex w-full max-w-md flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (identifier.trim() !== '' && (!passwordMode || password !== '')) submitCredentials();
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="text-base text-ink-soft">Username</span>
          <input
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            autoComplete="username"
            className="rounded-lg bg-surface px-5 py-4 text-xl outline-none focus:ring-2 focus:ring-accent"
          />
        </label>

        {passwordMode && (
          <label className="flex flex-col gap-2">
            <span className="text-base text-ink-soft">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="rounded-lg bg-surface px-5 py-4 text-xl outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
        )}

        {error !== null && <p className="text-center text-base text-danger">{error}</p>}

        <button
          type="submit"
          disabled={busy || identifier.trim() === '' || (passwordMode && password === '')}
          className="flex items-center justify-center gap-3 rounded-lg bg-accent py-5 text-xl text-on-accent disabled:opacity-50"
        >
          {busy && <Loader2 className="size-6 animate-spin" />}
          {passwordMode ? 'Sign in' : 'Continue'}
        </button>

        <button
          type="button"
          onClick={() => {
            setPasswordMode(!passwordMode);
            setError(null);
          }}
          className="text-base text-ink-soft underline"
        >
          {passwordMode ? 'Use MPIN instead' : 'Use password instead'}
        </button>
      </form>
    </div>
  );
}
