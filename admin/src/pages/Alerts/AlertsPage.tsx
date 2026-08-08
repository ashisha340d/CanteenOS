import { useEffect, useRef, useState } from 'react';
import { AlertSoundSlot, AlertType, UserRole, type UpdateAlertSettingRequest } from '@menuboard/shared';
import { CheckIcon, PauseIcon, PlayIcon, UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckboxField, NumberField, SelectField, SwitchField } from '@/components/form/fields';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatGridSkeleton } from '../../components/ui/Skeletons';
import { alertsApi } from '@/api/alerts';
import { useAlertSettings, useAlertSounds, useUpdateAlertSetting, useUploadAlertSound } from '../../hooks/useAlerts';
import { enumOptions, humanise } from '@/lib/options';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';

const SLOT_LABELS: Record<AlertSoundSlot, { title: string; description: string }> = {
  [AlertSoundSlot.NORMAL]: {
    title: 'New order arrival',
    description: 'Plays when a fresh order lands on the board.',
  },
  [AlertSoundSlot.WARNING]: {
    title: 'Order reminder',
    description: 'Plays for a delivery-warning or prep-call alarm.',
  },
  [AlertSoundSlot.CRITICAL]: {
    title: 'Critical order',
    description: 'Plays when an order is about to breach its required time.',
  },
};

const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  [AlertType.NEW_INCOMING]: 'New order arrival',
  [AlertType.DELIVERY_WARNING]: 'Delivery warning',
  [AlertType.CRITICAL_ALERT]: 'Critical order',
  [AlertType.PREP_CALL]: 'Prep call',
};

const TARGET_ROLE_OPTIONS = [UserRole.MANAGER, UserRole.USER, UserRole.EMPLOYEE, UserRole.ADMIN];

/**
 * Admin-uploaded buzzers for the three alarm sound slots, plus the four alarm triggers that
 * decide when each one fires. Every device downloads whatever is uploaded here and plays it
 * locally when the matching alarm goes off (backend/src/services/AlertService.ts).
 */
export function AlertsPage(): JSX.Element {
  const { data: sounds, isLoading: soundsLoading } = useAlertSounds();
  const { data: settings, isLoading: settingsLoading } = useAlertSettings();

  if (soundsLoading || settingsLoading || !sounds || !settings) {
    return (
      <>
        <PageHeader title="Alerts" subtitle="Alarm sounds and when each one fires." />
        <StatGridSkeleton count={3} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Alerts" subtitle="Alarm sounds and when each one fires." />
      <div className="flex max-w-[880px] flex-col gap-8">
        <section>
          <h2 className="font-heading text-base font-semibold">Alarm sounds</h2>
          <p className="text-muted-foreground mt-0.5 mb-3 text-sm">
            Upload the audio file each buzzer plays. Uploading again replaces the slot.
          </p>
          <div className="bg-card overflow-hidden rounded-xl border">
            {Object.values(AlertSoundSlot).map((slot, index) => {
              const sound = sounds.find((s) => s.slot === slot) ?? null;
              return (
                <SoundRow key={slot} slot={slot} sound={sound} bordered={index > 0} />
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="font-heading text-base font-semibold">Alarm triggers</h2>
          <p className="text-muted-foreground mt-0.5 mb-3 text-sm">
            Who is alerted, how far ahead, and whether the alarm keeps repeating until it is
            acknowledged.
          </p>
          <div className="flex flex-col gap-4">
            {Object.values(AlertType).map((alertType) => {
              const setting = settings.find((s) => s.alertType === alertType) ?? null;
              if (!setting) return null;
              return <TriggerCard key={alertType} alertType={alertType} setting={setting} />;
            })}
          </div>
        </section>
      </div>
    </>
  );
}

function SoundRow({
  slot,
  sound,
  bordered,
}: {
  slot: AlertSoundSlot;
  sound: { fileName: string | null; updatedAt: string } | null;
  bordered: boolean;
}): JSX.Element {
  const upload = useUploadAlertSound();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (audioRef.current?.src) URL.revokeObjectURL(audioRef.current.src);
    };
  }, []);

  async function onFileChosen(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      notify.fromError(new Error('Choose an audio file'));
      return;
    }
    try {
      await upload.mutateAsync({ slot, file });
      notify.success(`${SLOT_LABELS[slot].title} sound updated.`);
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function togglePlay(): Promise<void> {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    try {
      setLoadingAudio(true);
      const blob = await alertsApi.fetchSoundBlob(slot);
      const url = URL.createObjectURL(blob);
      if (audioRef.current?.src) URL.revokeObjectURL(audioRef.current.src);
      const audio = audioRef.current ?? new Audio();
      audio.src = url;
      audio.onended = () => setPlaying(false);
      audioRef.current = audio;
      await audio.play();
      setPlaying(true);
    } catch (err) {
      notify.fromError(err);
    } finally {
      setLoadingAudio(false);
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-4',
        bordered && 'border-t',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{SLOT_LABELS[slot].title}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{SLOT_LABELS[slot].description}</p>
        <p className="text-muted-foreground mt-1 truncate font-mono text-xs">
          {sound?.fileName ?? 'No file uploaded — vibration only'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={togglePlay}
          disabled={!sound?.fileName || loadingAudio}
        >
          {playing ? <PauseIcon data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
          {playing ? 'Stop' : 'Play'}
        </Button>
        <Button
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending}
        >
          <UploadIcon data-icon="inline-start" />
          Upload
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={onFileChosen}
        />
      </div>
    </div>
  );
}

function TriggerCard({
  alertType,
  setting,
}: {
  alertType: AlertType;
  setting: {
    enabled: boolean;
    leadMinutes: number;
    sound: AlertSoundSlot;
    repeatUntilAck: boolean;
    repeatEverySeconds: number;
    targetRoles: UserRole[];
  };
}): JSX.Element {
  const update = useUpdateAlertSetting();
  const [draft, setDraft] = useState(setting);
  const [saved, setSaved] = useState(false);

  useEffect(() => setDraft(setting), [setting]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(setting);
  const isImmediate = alertType === AlertType.NEW_INCOMING;

  async function save(): Promise<void> {
    const body: UpdateAlertSettingRequest = {
      enabled: draft.enabled,
      leadMinutes: draft.leadMinutes,
      sound: draft.sound,
      repeatUntilAck: draft.repeatUntilAck,
      repeatEverySeconds: draft.repeatEverySeconds,
      targetRoles: draft.targetRoles,
    };
    try {
      await update.mutateAsync({ alertType, body });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      notify.fromError(err);
    }
  }

  function toggleRole(role: UserRole, checked: boolean): void {
    setDraft((prev) => ({
      ...prev,
      targetRoles: checked
        ? [...prev.targetRoles, role]
        : prev.targetRoles.filter((r) => r !== role),
    }));
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>{ALERT_TYPE_LABELS[alertType]}</CardTitle>
            <CardDescription>
              {isImmediate ? 'Fires immediately on arrival.' : 'A time-based alarm scheduled ahead of the order.'}
            </CardDescription>
          </div>
          <Badge variant={draft.enabled ? 'secondary' : 'outline'}>
            {draft.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <SwitchField
          label="Enabled"
          checked={draft.enabled}
          onCheckedChange={(checked) => setDraft((prev) => ({ ...prev, enabled: checked }))}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {!isImmediate && (
            <NumberField
              label="Lead time (minutes)"
              value={draft.leadMinutes}
              min={0}
              max={1440}
              onChange={(e) => setDraft((prev) => ({ ...prev, leadMinutes: Number(e.target.value) }))}
            />
          )}
          <SelectField
            label="Sound"
            value={draft.sound}
            onChange={(value) => setDraft((prev) => ({ ...prev, sound: value as AlertSoundSlot }))}
            options={enumOptions(AlertSoundSlot).map((o) => ({
              ...o,
              label: SLOT_LABELS[o.value as AlertSoundSlot].title,
            }))}
          />
        </div>

        <SwitchField
          label="Repeat until acknowledged"
          checked={draft.repeatUntilAck}
          onCheckedChange={(checked) => setDraft((prev) => ({ ...prev, repeatUntilAck: checked }))}
        />

        {draft.repeatUntilAck && (
          <NumberField
            label="Repeat every (seconds)"
            value={draft.repeatEverySeconds}
            min={10}
            onChange={(e) => setDraft((prev) => ({ ...prev, repeatEverySeconds: Number(e.target.value) }))}
            helperText="Minimum 10 seconds."
          />
        )}

        <div>
          <p className="mb-2 text-sm font-medium">Who is alerted</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TARGET_ROLE_OPTIONS.map((role) => (
              <CheckboxField
                key={role}
                label={humanise(role)}
                checked={draft.targetRoles.includes(role)}
                onCheckedChange={(checked) => toggleRole(role, checked)}
              />
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          {saved ? (
            <span className="text-tone-success flex items-center gap-1 text-xs font-medium motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95">
              <CheckIcon className="size-4" />
              Saved
            </span>
          ) : (
            dirty && (
              <Button size="sm" onClick={save} disabled={update.isPending}>
                Save
              </Button>
            )
          )}
        </div>
      </CardContent>
    </Card>
  );
}
