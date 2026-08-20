import { useRef } from 'react';
import { CheckIcon, DownloadIcon, RotateCcwIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  clearDesktopState,
  downloadSnapshot,
  readSnapshotFile,
  restoreDesktopSnapshot,
} from '@/services/desktopState';
import { ModulePage } from '@/components/ModulePage';
import { ChatSoundsCard, KdsAlarmSoundsCard } from '@/components/KdsAlarmSounds';
import { KdsAlarmTiming } from '@/components/KdsAlarmTiming';
import {
  DESKTOP_SKIN_HINT,
  DESKTOP_SKIN_LABEL,
  DESKTOP_SKIN_PREVIEW,
  DESKTOP_SKINS,
  SKIN_LABEL,
  TEXT_SIZE_LABEL,
  useTheme,
  type DesktopSkin,
  type TextSize,
  type ThemeSkin,
} from '@/theme/ThemeProvider';
import { notify } from '@/lib/notify';
import { RESET_ICONS_EVENT } from '../Dashboard/desktopIcons';
import './DesktopSettingsPage.css';

const CONTENT_SKINS: ThemeSkin[] = ['light', 'dark', 'brand'];
const TEXT_SIZES: TextSize[] = ['compact', 'default', 'large'];

/** A miniature of the desktop in a given skin: wallpaper, a window, and the status bar. */
function SkinPreview({ skin }: { skin: DesktopSkin }): JSX.Element {
  const p = DESKTOP_SKIN_PREVIEW[skin];
  return (
    <span className="skin-preview" style={{ background: p.bg }} aria-hidden>
      <span className="skin-preview__icons">
        <span className="skin-preview__icon" style={{ background: p.accent }} />
        <span className="skin-preview__icon" style={{ background: p.accent, opacity: 0.55 }} />
      </span>

      <span className="skin-preview__window" style={{ borderColor: p.border, background: p.body }}>
        <span
          className="skin-preview__titlebar"
          style={{
            background: `linear-gradient(180deg, ${p.chromeFrom} 0%, ${p.chromeTo} 100%)`,
            borderColor: p.border,
          }}
        >
          <span className="skin-preview__light" style={{ background: '#ff5f57' }} />
          <span className="skin-preview__light" style={{ background: '#febc2e' }} />
          <span className="skin-preview__light" style={{ background: '#28c840' }} />
        </span>
        <span className="skin-preview__lines">
          <span style={{ background: p.accent }} />
          <span style={{ background: p.border }} />
          <span style={{ background: p.border, width: '60%' }} />
        </span>
      </span>

      <span
        className="skin-preview__bar"
        style={{ background: p.bar, borderColor: p.border }}
      >
        <span className="skin-preview__task" style={{ background: p.accent }} />
      </span>
    </span>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-heading text-base font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function DesktopSettingsPage(): JSX.Element {
  return (
    <ModulePage
      moduleId="settings"
      eyebrow="Settings"
      title="Settings"
      subtitle="How this workstation looks, and what the counter boards sound like."
      defaultTab="appearance"
      tabs={[
        { key: 'appearance', label: 'Appearance', content: <AppearanceTab /> },
        { key: 'kds-sounds', label: 'KDS/CDS Sounds', content: <KdsSoundsTab /> },
        { key: 'chat', label: 'Chat & Messaging', content: <ChatMessagingTab /> },
      ]}
    />
  );
}

/** Skins, text size and icon layout — everything about how this workstation's desktop looks. */
function AppearanceTab(): JSX.Element {
  const { skin, setSkin, textSize, setTextSize, desktopSkin, setDesktopSkin } = useTheme();

  function resetIcons(): void {
    window.dispatchEvent(new CustomEvent(RESET_ICONS_EVENT));
    notify.success('Desktop icons back in their default places.');
  }

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Desktop skin"
        description="The wallpaper, window frames and status bar. Independent of what a window shows inside."
      >
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))]">
          {DESKTOP_SKINS.map((option) => {
            const active = option === desktopSkin;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setDesktopSkin(option)}
                aria-pressed={active}
                className={`skin-card ${active ? 'skin-card--active' : ''}`}
              >
                <SkinPreview skin={option} />
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">{DESKTOP_SKIN_LABEL[option]}</span>
                  {active && <CheckIcon className="text-primary size-3.5" />}
                </span>
                <span className="text-muted-foreground text-xs leading-snug">
                  {DESKTOP_SKIN_HINT[option]}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title="Window content"
        description="The theme pages are painted in. A dark desktop can still run light content, and the other way round."
      >
        <div className="flex flex-wrap gap-2">
          {CONTENT_SKINS.map((option) => (
            <Button
              key={option}
              variant={option === skin ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={option === skin}
              onClick={() => setSkin(option)}
            >
              {option === skin && <CheckIcon data-icon="inline-start" />}
              {SKIN_LABEL[option]}
            </Button>
          ))}
        </div>
      </Section>

      <Section
        title="Text size"
        description="Scales the whole interface from your browser's own font size, so it stays legible at a distance."
      >
        <div className="flex flex-wrap gap-2">
          {TEXT_SIZES.map((option) => (
            <Button
              key={option}
              variant={option === textSize ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={option === textSize}
              onClick={() => setTextSize(option)}
            >
              {option === textSize && <CheckIcon data-icon="inline-start" />}
              {TEXT_SIZE_LABEL[option]}
            </Button>
          ))}
        </div>
      </Section>

      <Section
        title="Desktop icons"
        description="Icons can be dragged anywhere on the desktop and stay where you leave them."
      >
        <div>
          <Button variant="outline" size="sm" onClick={resetIcons}>
            <RotateCcwIcon data-icon="inline-start" />
            Reset icon layout
          </Button>
        </div>
      </Section>

      <StateSection />
    </div>
  );
}

/**
 * The counter boards' voices: which file plays, when it fires, and how loud. Server-side
 * settings — one change here reaches every Service KDS, and the boards themselves cannot
 * change or silence any of it.
 */
function KdsSoundsTab(): JSX.Element {
  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Alarm sounds"
        description="The three alarms every Service KDS plays, in the order a line meets them: a new order landing, the attention call before a line is due, and the critical buzzer once it is late."
      >
        <KdsAlarmSoundsCard />
      </Section>

      <Section
        title="Timing & volume"
        description="When the attention and critical alarms fire, how often critical repeats, and how loud every board plays. A line's due time is its order time plus its prep time (per item on the Menu Master File, default below as fallback)."
      >
        <KdsAlarmTiming />
      </Section>
    </div>
  );
}

/**
 * The office-to-counter chat. Only the sounds are configurable: who may talk to a counter is
 * already answered by the POS capability, and the conversation itself has no settings worth
 * having — a message either reached the wall or it did not.
 */
function ChatMessagingTab(): JSX.Element {
  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Notification sounds"
        description="What plays when a message lands, and what plays when the office rings a counter's bell. Uploaded once here and used by every Service KDS and by this desktop. With nothing uploaded, both fall back to a built-in tone."
      >
        <ChatSoundsCard />
      </Section>
    </div>
  );
}

/**
 * Everything this workstation has learned about its operator — skins, text size, icon layout,
 * open windows, grid columns, view modes, modal geometry, POS preferences, module tabs — as
 * one file. Move it between machines, or wipe it and start clean.
 */
function StateSection(): JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null);

  async function onImport(file: File): Promise<void> {
    try {
      restoreDesktopSnapshot(await readSnapshotFile(file));
      // Pages read their preferences in initialisers, so a reload is the reliable reset —
      // cheaper than teaching every store about mid-session imports.
      window.location.reload();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'That file is not a Canteen OS state backup.');
    }
  }

  return (
    <Section
      title="State & backups"
      description="One snapshot covers the whole desktop: skins, icons, windows, tabs, grids and POS preferences."
    >
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={downloadSnapshot}>
          <DownloadIcon data-icon="inline-start" />
          Export state
        </Button>
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <UploadIcon data-icon="inline-start" />
          Import state…
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:bg-destructive/10"
          onClick={() => {
            if (!window.confirm('Reset every preference on this workstation? The desktop restarts empty.')) return;
            clearDesktopState();
            window.location.reload();
          }}
        >
          <Trash2Icon data-icon="inline-start" />
          Reset everything
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void onImport(file);
        }}
      />
    </Section>
  );
}
