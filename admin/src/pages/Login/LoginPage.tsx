import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { CheckboxField, FieldGroup, TextField } from '@/components/form/fields';
import { AuthLayout } from '../../layouts/AuthLayout';
import { useAuth } from '../../services/AuthContext';
import { readError } from '../../services/errorMessage';

export function LoginPage(): JSX.Element {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(identifier.trim(), password, rememberMe);
      navigate('/', { replace: true });
    } catch (err) {
      setError(readError(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (user?.mustChangePassword) {
    navigate('/change-password', { replace: true });
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
            required
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <CheckboxField
            label="Remember me on this device"
            checked={rememberMe}
            onCheckedChange={setRememberMe}
          />

          <Button type="submit" size="lg" disabled={submitting} className="w-full">
            {submitting && <Spinner data-icon="inline-start" />}
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </FieldGroup>
      </form>
    </AuthLayout>
  );
}
