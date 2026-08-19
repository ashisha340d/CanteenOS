import { useEffect, useRef, useState } from 'react';
import { AlertSoundSlot } from '@menuboard/shared';
import {
  BellRingIcon,
  PauseIcon,
  PlayIcon,
  SirenIcon,
  UploadIcon,
  Volume2Icon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAlertSounds, useUploadAlertSound } from '../hooks/useAlerts';
import { alertsApi } from '../api/alerts';
import { notify } from '@/lib/notify';

/** The three board voices, in the order they fire during a line's life. */
export const KDS_SOUNDS: { slot: AlertSoundSlot; title: string; description: string; icon: JSX.Element }[] = [
  {
    slot: AlertSoundSlot.KDS_NEW,
    title: 'New order arrives',
    description: 'Sounds once the moment a fresh order lands on a counter board.',
    icon: <BellRingIcon className="size-4" />,
  },
  {
    slot: AlertSoundSlot.KDS_ATTENTION,
    title: 'Attention — due soon',
    description: 'Sounds once per line, the configured time before that line is due.',
    icon: <Volume2Icon className="size-4" />,
  },
  {
    slot: AlertSoundSlot.KDS_CRITICAL,
    title: 'Critical — past due',
    description: 'Sounds when a line passes its due time, then repeats at the set interval.',
    icon: <SirenIcon className="size-4" />,
  },
];

/** One board voice: what it is for, the file behind it, and replace / preview. */
export function KdsSoundRow({
  entry,
  bordered,
}: {
  entry: { slot: AlertSoundSlot; title: string; description: string; icon: JSX.Element };
  bordered: boolean;
}): JSX.Element {
  const { data: sounds } = useAlertSounds();
  const upload = useUploadAlertSound();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);

  const sound = sounds?.find((s) => s.slot === entry.slot) ?? null;

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
      notify.error('Choose an audio file.');
      return;
    }
    try {
      await upload.mutateAsync({ slot: entry.slot, file });
      notify.success(`${entry.title} sound updated.`);
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
      setBusy(true);
      const blob = await alertsApi.fetchSoundBlob(entry.slot);
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
      setBusy(false);
    }
  }

  return (
    <div
      className={`flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-4 ${
        bordered ? 'border-t' : ''
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          {entry.icon}
          {entry.title}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">{entry.description}</p>
        <p className="text-muted-foreground mt-1 truncate font-mono text-xs">
          {sound?.fileName ?? 'No file — the board falls back to its built-in beep'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={togglePlay} disabled={!sound?.fileName || busy}>
          {playing ? <PauseIcon data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
          {playing ? 'Stop' : 'Play'}
        </Button>
        <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={upload.isPending}>
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

/** The three upload rows as one card — used by the KDS & CDS tab and the Settings window. */
export function KdsAlarmSoundsCard(): JSX.Element {
  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      {KDS_SOUNDS.map((entry, index) => (
        <KdsSoundRow key={entry.slot} entry={entry} bordered={index > 0} />
      ))}
    </div>
  );
}
