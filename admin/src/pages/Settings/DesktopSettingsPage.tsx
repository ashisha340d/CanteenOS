import { useEffect, useRef, useState } from 'react';
import { CheckIcon, DownloadIcon, RotateCcwIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  clearDesktopState,
  downloadSnapshot,
  readSnapshotFile,
  restoreDesktopSnapshot,
} from '@/services/desktopState';
import { ModulePage } from '@/components/ModulePage';
import { ChatSoundsCard, KdsAlarmSoundsCard } from '@/components/KdsAlarmSounds';
import { KdsAlarmTiming } from '@/components/KdsAlarmTiming';
import { SearchPickerField } from '@/components/SearchPickerField';
import { WIDGETS } from '@/components/widgets/registry';
import {
  addHostWidget,
  DESKTOP_HOST,
  removeHostWidget,
  resetHost,
  useHostWidgets,
} from '@/components/widgets/widgetState';
import { useLocationSearch } from '@/hooks/useEnvironment';
import {
  describeLocation,
  saveLocation,
  useWorkstationLocation,
} from '@/services/workstationLocation';
import {
  DESKTOP_SKIN_HINT,
  DESKTOP_SKIN_LABEL,
  DESKTOP_SKIN_PREVIEW,
  DESKTOP_SKINS,
  FONT_CHOICES,
  FONT_HINT,
  FONT_LABEL,
  ICON_SET_HINT,
  ICON_SET_LABEL,
  ICON_SETS,
  SKIN_LABEL,
  TEXT_SIZE_LABEL,
  useTheme,
  type DesktopSkin,
  type FontChoice,
  type IconSet,
  type TextSize,
  type ThemeSkin,
} from '@/theme/ThemeProvider';
import { notify } from '@/lib/notify';
import { RESET_ICONS_EVENT } from '../Dashboard/desktopIcons';
import './DesktopSettingsPage.css';

const CONTENT_SKINS: ThemeSkin[] = ['light', 'dark', 'brand'];
const TEXT_SIZES: TextSize[] = ['compact', 'default', 'large'];

/** Long enough that typing "Coimbatore" is one lookup rather than ten. */
const SEARCH_DEBOUNCE_MS = 300;

/** Coordinates identify a place; two spellings of one town are the same selection. */
function locationId(latitude: number, longitude: number): string {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

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

      <LocationSection />

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

      <TypefaceSection />
      <IconSetSection />
      <WidgetSection />
      <StateSection />
    </div>
  );
}

/**
 * Where this workstation is. Two features depend on it and neither can guess: the weather
 * widget needs coordinates, and the holiday calendar needs a country. Placed immediately
 * before Text size because both are answers about *this machine* rather than about the
 * product, and an operator setting one up almost always sets the other.
 */
function LocationSection(): JSX.Element {
  const location = useWorkstationLocation();
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const results = useLocationSearch(query);
  const suggestions = results.data ?? [];

  return (
    <Section
      title="Location"
      description="Used by the weather widget and by the holiday calendar. Nothing else reads it, and it never leaves this workstation."
    >
      <div className="max-w-md">
        <SearchPickerField
          id="workstation-location"
          label="Canteen location"
          value={location === null ? null : locationId(location.latitude, location.longitude)}
          displayValue={location === null ? '' : describeLocation(location)}
          options={suggestions.map((place) => ({
            id: locationId(place.latitude, place.longitude),
            label: place.region === null ? place.name : `${place.name}, ${place.region}`,
            sublabel: `${place.country} · ${place.timezone}`,
          }))}
          loading={results.isFetching}
          onSearchChange={setTyped}
          onSelect={(option) => {
            const picked = suggestions.find(
              (place) => locationId(place.latitude, place.longitude) === option.id,
            );
            if (picked === undefined) return;
            // The geocoder's own id is deliberately not stored: coordinates, country and
            // timezone are all anything downstream asks for, and they outlive the provider.
            const place = {
              name: picked.name,
              region: picked.region,
              country: picked.country,
              countryCode: picked.countryCode,
              latitude: picked.latitude,
              longitude: picked.longitude,
              timezone: picked.timezone,
            };
            saveLocation(place);
            notify.success(`Location set to ${describeLocation(place)}.`);
          }}
          onClear={() => {
            saveLocation(null);
            notify.success('Location cleared.');
          }}
        />
        {results.isError && (
          <p className="text-destructive mt-1.5 text-xs">
            The place lookup could not be reached. It needs internet access from this
            workstation.
          </p>
        )}
      </div>
    </Section>
  );
}

/**
 * The typeface everything is set in. Each card is rendered in the face it offers — a font
 * picker that lists names in one font is asking the reader to imagine the answer.
 */
function TypefaceSection(): JSX.Element {
  const { font, setFont } = useTheme();

  return (
    <Section
      title="Font"
      description="Applies to every screen, window, table and form in the portal. Ten faces chosen for long shifts and dense figures."
    >
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))]">
        {FONT_CHOICES.map((option) => {
          const active = option === font;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setFont(option as FontChoice)}
              aria-pressed={active}
              className={`skin-card ${active ? 'skin-card--active' : ''}`}
              style={{ fontFamily: `var(--font-stack-${option})` }}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-sm font-semibold">{FONT_LABEL[option]}</span>
                {active && <CheckIcon className="text-primary size-3.5 shrink-0" />}
              </span>
              {/* Digits and a rupee sign, because that is what this portal mostly renders. */}
              <span className="text-base tabular-nums">₹1,24,650.00 · 09:45 · 128 kg</span>
              <span className="text-muted-foreground text-xs leading-snug">
                {FONT_HINT[option]}
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

/** Six ways to draw the desktop icons, each previewed in its own set. */
function IconSetSection(): JSX.Element {
  const { iconSet, setIconSet } = useTheme();

  function resetIcons(): void {
    window.dispatchEvent(new CustomEvent(RESET_ICONS_EVENT));
    notify.success('Desktop icons and group boxes back to their defaults.');
  }

  return (
    <Section
      title="Desktop icons"
      description="Icons can be dragged anywhere, grouped into boxes drawn on the desktop, and arranged from the desktop's right-click menu."
    >
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr))]">
        {ICON_SETS.map((option) => {
          const active = option === iconSet;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setIconSet(option as IconSet)}
              aria-pressed={active}
              className={`skin-card icon-set--${option} ${active ? 'skin-card--active' : ''}`}
            >
              <span className="icon-preview" aria-hidden>
                {['#5b4ff5', '#0e9f6e', '#d08511'].map((accent) => (
                  <span
                    key={accent}
                    className="icon-preview__tile"
                    style={{ ['--icon-accent' as string]: accent }}
                  />
                ))}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-sm font-semibold">{ICON_SET_LABEL[option]}</span>
                {active && <CheckIcon className="text-primary size-3.5" />}
              </span>
              <span className="text-muted-foreground text-xs leading-snug">
                {ICON_SET_HINT[option]}
              </span>
            </button>
          );
        })}
      </div>

      <div>
        <Button variant="outline" size="sm" onClick={resetIcons}>
          <RotateCcwIcon data-icon="inline-start" />
          Reset icons & groups
        </Button>
      </div>
    </Section>
  );
}

/** Which cards the desktop carries. The same list the desktop's right-click menu offers. */
function WidgetSection(): JSX.Element {
  const shown = useHostWidgets(DESKTOP_HOST);

  return (
    <Section
      title="Desktop widgets"
      description="Cards that float above the desktop. Each one can be dragged to any corner, resized, rolled up, and stays where it was left."
    >
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))]">
        {WIDGETS.map((widget) => {
          const active = shown.includes(widget.id);
          return (
            <label
              key={widget.id}
              className="hover:bg-accent/40 flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5"
            >
              <Checkbox
                checked={active}
                onCheckedChange={(next) => {
                  if (next === true) addHostWidget(DESKTOP_HOST, widget.id);
                  else removeHostWidget(DESKTOP_HOST, widget.id);
                }}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="flex shrink-0" style={{ color: widget.accent }}>
                    <widget.Icon className="size-3.5" />
                  </span>
                  {widget.label}
                </span>
                <span className="text-muted-foreground mt-0.5 block text-xs leading-snug">
                  {widget.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            resetHost(DESKTOP_HOST);
            notify.success('Desktop widgets cleared.');
          }}
        >
          <RotateCcwIcon data-icon="inline-start" />
          Clear all widgets
        </Button>
      </div>
    </Section>
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
