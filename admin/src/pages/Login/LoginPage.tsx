import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FingerprintIcon, KeyRoundIcon } from 'lucide-react';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { startAuthentication } from '@simplewebauthn/browser';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { CheckboxField, FieldGroup, TextField } from '@/components/form/fields';
import { authApi } from '@/api/auth';
import { getDeviceId } from '@/services/session';
import { AuthLayout } from '../../layouts/AuthLayout';
import { useAuth } from '../../services/AuthContext';
import { readError } from '../../services/errorMessage';

type LoginMode = 'password' | 'pin';

export function LoginPage(): JSX.Element {
  const { login, loginWithPin, setAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<LoginMode>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user?.mustChangePassword) {
    navigate('/change-password', { replace: true });
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (mode === 'pin') {
        if (!/^\d{4}$/.test(pin)) {
          setError('PIN must be exactly 4 digits.');
          return;
        }
        await loginWithPin(identifier.trim(), pin, rememberMe);
      } else {
        await login(identifier.trim(), password, rememberMe);
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(readError(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function onPasskey(): Promise<void> {
    const id = identifier.trim();
    if (!id) {
      setError('Enter your username, phone or email to use a passkey.');
      return;
    }
    setError(null);
    setSubmitting(true);

    try {
      const { options } = await authApi.getPasskeyLoginOptions(id);
      const assertion = await startAuthentication({
        optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
      });
      const response = await authApi.loginWithPasskey({
        response: assertion as unknown as Record<string, unknown>,
        deviceId: getDeviceId(),
        clientType: 'ADMIN',
        rememberMe,
      });
      setAuthenticated(response, rememberMe);
      navigate('/', { replace: true });
    } catch (err) {
      setError(readError(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  function switchToPin(): void {
    setMode('pin');
    setPassword('');
    setPin('');
    setError(null);
  }

  function switchToPassword(): void {
    setMode('password');
    setPin('');
    setPassword('');
    setError(null);
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to continue to the Admin Portal.">
      <form onSubmit={onSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Could not sign in</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <TextField
            label="Username, phone or email"
            autoFocus
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            disabled={submitting}
            required
          />

          {mode === 'pin' ? (
            <TextField
              label="4-digit PIN"
              type="password"
              inputMode="numeric"
              pattern="\d*"
              maxLength={4}
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              disabled={submitting}
              required
            />
          ) : (
            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              required
            />
          )}

          <CheckboxField
            label="Remember me on this device"
            checked={rememberMe}
            onCheckedChange={setRememberMe}
            disabled={submitting}
          />

          <Button type="submit" size="lg" disabled={submitting} className="w-full">
            {submitting && <Spinner data-icon="inline-start" />}
            {mode === 'pin' ? (submitting ? 'Signing in…' : 'Sign in with PIN') : (submitting ? 'Signing in…' : 'Sign in')}
          </Button>

          {mode === 'pin' && (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={switchToPassword}
              disabled={submitting}
              className="w-full"
            >
              Use password instead
            </Button>
          )}

          {mode === 'password' && (
            <div className="flex flex-col gap-3">
              <div className="relative flex items-center py-2">
                <div className="grow border-t" />
                <span className="text-muted-foreground px-3 text-xs font-medium uppercase tracking-wider">
                  Fast sign-in
                </span>
                <div className="grow border-t" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={switchToPin}
                  disabled={submitting}
                >
                  <KeyRoundIcon data-icon="inline-start" />
                  Sign in with PIN
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={onPasskey}
                  disabled={!identifier.trim() || submitting}
                >
                  <FingerprintIcon data-icon="inline-start" />
                  Sign in with passkey
                </Button>
              </div>

              {!identifier.trim() && (
                <p className="text-muted-foreground text-center text-xs">
                  Enter your identifier above to use a passkey.
                </p>
              )}
            </div>
          )}
        </FieldGroup>
      </form>
    </AuthLayout>
  );
}
