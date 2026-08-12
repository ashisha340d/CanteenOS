import { useEffect, useState } from 'react';
import { FingerprintIcon, KeyRoundIcon, Trash2Icon } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { TextField } from '@/components/form/fields';
import { notify } from '@/lib/notify';
import { readError } from '@/services/errorMessage';
import {
  usePasskeys,
  usePinStatus,
  useRegisterPasskey,
  useRemovePasskey,
  useRemovePin,
  useSetPin,
} from '@/hooks/useSecurity';

export function SecuritySettingsPage(): JSX.Element {
  const { data: pinStatus, isLoading: pinStatusLoading } = usePinStatus();
  const { data: passkeysData, isLoading: passkeysLoading } = usePasskeys();
  const setPin = useSetPin();
  const removePin = useRemovePin();
  const registerPasskey = useRegisterPasskey();
  const removePasskey = useRemovePasskey();

  const [pinSet, setPinSet] = useState(pinStatus?.hasPin ?? false);
  const [pinCurrentPassword, setPinCurrentPassword] = useState('');

  useEffect(() => {
    if (pinStatus !== undefined) {
      setPinSet(pinStatus.hasPin);
    }
  }, [pinStatus]);
  const [pinValue, setPinValue] = useState('');

  const [showRemovePin, setShowRemovePin] = useState(false);
  const [removePinPassword, setRemovePinPassword] = useState('');

  const [registerPassword, setRegisterPassword] = useState('');
  const [registerDeviceName, setRegisterDeviceName] = useState('');

  const [removingPasskeyId, setRemovingPasskeyId] = useState<string | null>(null);
  const [removePasskeyPassword, setRemovePasskeyPassword] = useState('');

  async function onSetPin(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!/^\d{4}$/.test(pinValue)) {
      notify.error('PIN must be exactly 4 digits.');
      return;
    }
    try {
      await setPin.mutateAsync({ currentPassword: pinCurrentPassword, pin: pinValue });
      notify.success('PIN saved.');
      setPinSet(true);
      setPinCurrentPassword('');
      setPinValue('');
    } catch (err) {
      notify.error(readError(err).message);
    }
  }

  async function onRemovePin(): Promise<void> {
    try {
      await removePin.mutateAsync({ currentPassword: removePinPassword });
      notify.success('PIN removed.');
      setPinSet(false);
      setShowRemovePin(false);
      setRemovePinPassword('');
    } catch (err) {
      notify.error(readError(err).message);
    }
  }

  async function onRegisterPasskey(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    try {
      await registerPasskey.mutateAsync({
        currentPassword: registerPassword,
        deviceName: registerDeviceName,
      });
      notify.success('Passkey registered.');
      setRegisterPassword('');
      setRegisterDeviceName('');
    } catch (err) {
      notify.error(readError(err).message);
    }
  }

  async function onRemovePasskey(credentialId: string): Promise<void> {
    try {
      await removePasskey.mutateAsync({
        credentialId,
        currentPassword: removePasskeyPassword,
      });
      notify.success('Passkey removed.');
      setRemovingPasskeyId(null);
      setRemovePasskeyPassword('');
    } catch (err) {
      notify.error(readError(err).message);
    }
  }

  if (pinStatusLoading || pinStatus === undefined) {
    return (
      <div className="flex max-w-[720px] flex-col gap-8">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Security</h1>
          <p className="text-muted-foreground mt-1 text-sm">Loading security settings…</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Spinner className="size-4" />
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-[720px] flex-col gap-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Security</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage fast sign-in methods for your account.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-4" />
            PIN
          </CardTitle>
          <CardDescription>
            Sign in quickly with a 4-digit code on this device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!pinSet ? (
            <form onSubmit={onSetPin}>
              <FieldGroup>
                <TextField
                  label="Current password"
                  type="password"
                  autoComplete="current-password"
                  value={pinCurrentPassword}
                  onChange={(e) => setPinCurrentPassword(e.target.value)}
                  disabled={setPin.isPending}
                  required
                />
                <TextField
                  label="4-digit PIN"
                  type="password"
                  inputMode="numeric"
                  pattern="\d*"
                  maxLength={4}
                  autoComplete="off"
                  value={pinValue}
                  onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  disabled={setPin.isPending}
                  required
                />
                <Button type="submit" disabled={setPin.isPending}>
                  {setPin.isPending && <Spinner data-icon="inline-start" />}
                  {setPin.isPending ? 'Saving…' : 'Save PIN'}
                </Button>
              </FieldGroup>
            </form>
          ) : (
            <FieldGroup>
              <Field>
                <FieldLabel>PIN is configured</FieldLabel>
                <FieldDescription>
                  You can sign in with your 4-digit PIN on this device.
                </FieldDescription>
              </Field>
              {!showRemovePin ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowRemovePin(true)}
                  disabled={removePin.isPending}
                >
                  Remove PIN
                </Button>
              ) : (
                <div className="flex flex-col gap-3">
                  <TextField
                    label="Current password"
                    type="password"
                    autoComplete="current-password"
                    value={removePinPassword}
                    onChange={(e) => setRemovePinPassword(e.target.value)}
                    disabled={removePin.isPending}
                    required
                  />
                  <div className="flex gap-3">
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={onRemovePin}
                      disabled={removePin.isPending || !removePinPassword}
                    >
                      {removePin.isPending && <Spinner data-icon="inline-start" />}
                      {removePin.isPending ? 'Removing…' : 'Confirm remove PIN'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowRemovePin(false);
                        setRemovePinPassword('');
                      }}
                      disabled={removePin.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </FieldGroup>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FingerprintIcon className="size-4" />
            Passkeys
          </CardTitle>
          <CardDescription>
            Use a passkey to sign in without a password.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <form onSubmit={onRegisterPasskey}>
            <FieldGroup>
              <TextField
                label="Current password"
                type="password"
                autoComplete="current-password"
                value={registerPassword}
                onChange={(e) => setRegisterPassword(e.target.value)}
                disabled={registerPasskey.isPending}
                required
              />
              <TextField
                label="Device name"
                placeholder="e.g. MacBook Pro"
                value={registerDeviceName}
                onChange={(e) => setRegisterDeviceName(e.target.value)}
                disabled={registerPasskey.isPending}
              />
              <Button type="submit" disabled={registerPasskey.isPending || !registerPassword}>
                {registerPasskey.isPending && <Spinner data-icon="inline-start" />}
                {registerPasskey.isPending ? 'Registering…' : 'Register passkey'}
              </Button>
            </FieldGroup>
          </form>

          <div className="border-t" />

          {passkeysLoading ? (
            <div className="flex items-center gap-2 text-sm">
              <Spinner className="size-4" />
              Loading passkeys…
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {(passkeysData?.passkeys ?? []).length === 0 && (
                <p className="text-muted-foreground text-sm">No passkeys registered.</p>
              )}
              {(passkeysData?.passkeys ?? []).map((passkey) => (
                <div
                  key={passkey.id}
                  className="flex flex-col gap-3 rounded-lg border px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {passkey.deviceName || 'Unnamed device'}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Added {new Date(passkey.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {removingPasskeyId !== passkey.id && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRemovingPasskeyId(passkey.id);
                          setRemovePasskeyPassword('');
                        }}
                        disabled={registerPasskey.isPending}
                      >
                        <Trash2Icon data-icon="inline-start" />
                        Remove
                      </Button>
                    )}
                  </div>

                  {removingPasskeyId === passkey.id && (
                    <div className="flex flex-col gap-3">
                      <TextField
                        label="Current password"
                        type="password"
                        autoComplete="current-password"
                        value={removePasskeyPassword}
                        onChange={(e) => setRemovePasskeyPassword(e.target.value)}
                        disabled={removePasskey.isPending}
                        required
                      />
                      <div className="flex gap-3">
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => onRemovePasskey(passkey.credentialId)}
                          disabled={removePasskey.isPending || !removePasskeyPassword}
                        >
                          {removePasskey.isPending && <Spinner data-icon="inline-start" />}
                          {removePasskey.isPending ? 'Removing…' : 'Confirm remove'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setRemovingPasskeyId(null);
                            setRemovePasskeyPassword('');
                          }}
                          disabled={removePasskey.isPending}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
