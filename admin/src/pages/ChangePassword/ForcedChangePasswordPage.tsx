import { useState } from 'react';
import { LIMITS } from '@menuboard/shared';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { FieldGroup, TextField } from '@/components/form/fields';
import { authApi } from '../../api/auth';
import { AuthLayout } from '../../layouts/AuthLayout';
import { useAuth } from '../../services/AuthContext';
import { readError } from '../../services/errorMessage';

/**
 * The only screen in the portal with real client-side validation — everywhere else the server
 * is the sole authority and errors come back through `readError`. Because the rules already
 * existed here, they are expressed with Zod rather than hand-rolled `if` statements; the two
 * rules and their exact wording are unchanged, they simply now land under the field that
 * caused them instead of in a banner above the form.
 */
const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z
      .string()
      .min(LIMITS.PASSWORD_MIN, `Password must be at least ${LIMITS.PASSWORD_MIN} characters.`),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'The new password and confirmation do not match.',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

/**
 * Gates the whole app until `mustChangePassword` is false (docs/TASK.md §6.2). Every seeded
 * account starts here on first login.
 */
export function ForcedChangePasswordPage(): JSX.Element {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: FormValues): Promise<void> {
    setError(null);
    try {
      await authApi.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      // The backend revokes all sessions on password change; the current access token from
      // login is still valid for this response cycle, so update local state directly and
      // send the user back through login for a clean new session.
      if (user) setUser({ ...user, mustChangePassword: false });
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <AuthLayout title="You must set a new password before continuing">
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <p className="text-muted-foreground text-sm">
            Signed in as <strong className="text-foreground font-medium">{user?.username}</strong>.
            This account was created with a temporary password that must be changed before you can
            use the Admin Portal.
          </p>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Could not change password</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <TextField
            label="Current (temporary) password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            error={errors.currentPassword?.message}
            {...register('currentPassword')}
          />
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            error={errors.newPassword?.message}
            helperText={`At least ${LIMITS.PASSWORD_MIN} characters.`}
            {...register('newPassword')}
          />
          <TextField
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            required
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />

          <Button type="submit" size="lg" disabled={isSubmitting} className="w-full">
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {isSubmitting ? 'Updating…' : 'Set new password and sign in again'}
          </Button>
        </FieldGroup>
      </form>
    </AuthLayout>
  );
}
