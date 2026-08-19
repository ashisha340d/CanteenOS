import { useEffect, useState } from 'react';
import {
  KioskLanguageMode,
  KioskRecommendationMode,
  KioskSkin,
  type SettingDto,
} from '@menuboard/shared';
import { CheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectField } from '@/components/form/fields';
import { useUpdateSetting } from '../../hooks/useAdmin';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';

/**
 * How the whole hall looks, decided once.
 *
 * These four settings also appear on the Settings page, where they sit as rows in a list of
 * dotted keys. That is the right home for them as *configuration*; it is a poor home for them
 * as a *design decision*, because choosing between four palettes from a dropdown labelled
 * `kiosk.skin` means an operator picks blind and then walks to a stand to see what they did.
 * Here the same settings sit next to a preview that repaints as they are chosen.
 *
 * Both surfaces write the same keys through the same endpoint, so neither is a copy of the
 * other's state — this panel just puts the decision where the consequence is visible.
 */

const SKIN_PALETTES: Record<KioskSkin, { canvas: string; surface: string; ink: string; accent: string; trim: string; line: string }> = {
  SANDALWOOD: {
    canvas: '#faf6ef',
    surface: '#fffdf9',
    ink: '#1e1913',
    accent: '#c2571a',
    trim: '#c9a227',
    line: '#e9e0d0',
  },
  TULSI: {
    canvas: '#f7f8f4',
    surface: '#fdfefb',
    ink: '#161d18',
    accent: '#2f6b45',
    trim: '#9a8f4a',
    line: '#e0e5db',
  },
  KASHI: {
    canvas: '#12141c',
    surface: '#1a1d27',
    ink: '#ecebf3',
    accent: '#dba849',
    trim: '#d4b86a',
    line: '#2b2f3d',
  },
  SATTVA: {
    canvas: '#f6f6f4',
    surface: '#ffffff',
    ink: '#17181a',
    accent: '#2c2e31',
    trim: '#a3a099',
    line: '#e4e4e1',
  },
};

const SKIN_NAMES: Record<KioskSkin, { title: string; note: string }> = {
  SANDALWOOD: { title: 'Sandalwood', note: 'Warm ivory, one saffron accent. The default.' },
  TULSI: { title: 'Tulsi', note: 'Cool ivory and green. Calmer under daylight-white lighting.' },
  KASHI: { title: 'Kashi', note: 'Indigo and lamp-gold, for an evening hall.' },
  SATTVA: { title: 'Sattva', note: 'Near-monochrome paper and graphite. The most austere.' },
};

const LANGUAGE_LABELS: Record<KioskLanguageMode, string> = {
  EN: 'English only',
  HI: 'हिंदी only',
  BOTH: 'Both, one under the other',
};

const RECOMMENDATION_LABELS: Record<KioskRecommendationMode, string> = {
  OFF: 'Never suggest anything',
  DRINKS: 'Offer a drink only',
  SWEETS: 'Offer a sweet only',
  BOTH: 'Offer a drink, or a sweet',
};

interface KioskLookPanelProps {
  settings: SettingDto[];
  skin: KioskSkin;
}

export function KioskLookPanel({ settings, skin }: KioskLookPanelProps): JSX.Element {
  const update = useUpdateSetting();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);

  useEffect(() => {
    setDraft(Object.fromEntries(settings.map((setting) => [setting.key, setting.value])));
  }, [settings]);

  async function save(key: string, value: unknown): Promise<void> {
    setDraft((current) => ({ ...current, [key]: value }));
    try {
      await update.mutateAsync({ key, value });
      setSavedKey(key);
      window.setTimeout(() => setSavedKey((current) => (current === key ? null : current)), 1800);
    } catch (err) {
      notify.fromError(err);
    }
  }

  const chosenSkin = (draft['kiosk.skin'] as KioskSkin | undefined) ?? skin;
  const language = (draft['kiosk.language_mode'] as KioskLanguageMode | undefined) ?? 'BOTH';
  const greeting = typeof draft['kiosk.greeting'] === 'string' ? draft['kiosk.greeting'] : '';
  const greetingHi =
    typeof draft['kiosk.greeting_hi'] === 'string' ? draft['kiosk.greeting_hi'] : '';
  const recommendations =
    (draft['kiosk.recommendations'] as KioskRecommendationMode | undefined) ?? 'BOTH';

  const greetingDirty = isDirty(settings, 'kiosk.greeting', greeting);
  const greetingHiDirty = isDirty(settings, 'kiosk.greeting_hi', greetingHi);

  return (
    <section>
      <h2 className="font-heading text-base font-semibold">The look of the hall</h2>
      <p className="text-muted-foreground mt-0.5 mb-3 text-sm">
        One choice, obeyed by every stand. The tablets pick a change up within a minute — nobody
        walks over to reload one.
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-5">
          <div>
            <p className="mb-2 text-sm font-medium">Skin</p>
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              {(Object.keys(SKIN_PALETTES) as KioskSkin[]).map((option) => (
                <SkinSwatch
                  key={option}
                  skin={option}
                  selected={chosenSkin === option}
                  saved={savedKey === 'kiosk.skin' && chosenSkin === option}
                  onSelect={() => void save('kiosk.skin', option)}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Language"
              helperText="BOTH is a deliberate third setting, not a fallback — it renders every label twice."
              value={language}
              onChange={(next) => void save('kiosk.language_mode', next)}
              options={(Object.keys(LANGUAGE_LABELS) as KioskLanguageMode[]).map((mode) => ({
                value: mode,
                label: LANGUAGE_LABELS[mode],
              }))}
            />
            <SelectField
              label="Suggestions before payment"
              helperText="Every suggestion is one more tap between a guest and their food."
              value={recommendations}
              onChange={(next) => void save('kiosk.recommendations', next)}
              options={(Object.keys(RECOMMENDATION_LABELS) as KioskRecommendationMode[]).map(
                (mode) => ({ value: mode, label: RECOMMENDATION_LABELS[mode] }),
              )}
            />
          </div>

          <div>
            <p className="text-sm font-medium">Greeting</p>
            <p className="text-muted-foreground mt-0.5 mb-2 text-xs">
              Shown while the menu loads and again over the token. Leave both blank for none.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <span className="flex flex-1 items-center gap-2">
                <Input
                  aria-label="Greeting in Latin script"
                  placeholder="Radhe Radhe"
                  maxLength={40}
                  value={greeting}
                  onChange={(e) => setDraft({ ...draft, 'kiosk.greeting': e.target.value })}
                />
                <SaveChip
                  dirty={greetingDirty}
                  saved={savedKey === 'kiosk.greeting'}
                  onSave={() => void save('kiosk.greeting', greeting)}
                />
              </span>
              <span className="flex flex-1 items-center gap-2">
                <Input
                  aria-label="Greeting in Devanagari"
                  lang="hi"
                  placeholder="राधे राधे"
                  maxLength={40}
                  value={greetingHi}
                  onChange={(e) => setDraft({ ...draft, 'kiosk.greeting_hi': e.target.value })}
                />
                <SaveChip
                  dirty={greetingHiDirty}
                  saved={savedKey === 'kiosk.greeting_hi'}
                  onSave={() => void save('kiosk.greeting_hi', greetingHi)}
                />
              </span>
            </div>
          </div>
        </div>

        <KioskPreview
          skin={chosenSkin}
          language={language}
          greeting={greeting}
          greetingHi={greetingHi}
        />
      </div>
    </section>
  );
}

function SaveChip({
  dirty,
  saved,
  onSave,
}: {
  dirty: boolean;
  saved: boolean;
  onSave: () => void;
}): JSX.Element {
  return (
    <span className="flex w-[68px] shrink-0 justify-end">
      {saved ? (
        <span className="text-tone-success flex items-center gap-1 text-xs font-medium">
          <CheckIcon className="size-4" />
          Saved
        </span>
      ) : (
        dirty && (
          <Button type="button" size="sm" onClick={onSave}>
            Save
          </Button>
        )
      )}
    </span>
  );
}

/** A skin is a palette, so the swatch is the palette rather than a name and a radio button. */
function SkinSwatch({
  skin,
  selected,
  saved,
  onSelect,
}: {
  skin: KioskSkin;
  selected: boolean;
  saved: boolean;
  onSelect: () => void;
}): JSX.Element {
  const palette = SKIN_PALETTES[skin];
  const meta = SKIN_NAMES[skin];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'group overflow-hidden rounded-xl border text-left transition-[border-color,box-shadow]',
        selected ? 'border-primary ring-primary/25 ring-2' : 'hover:border-muted-foreground/40',
      )}
    >
      <span
        className="flex h-16 items-end gap-1.5 p-2.5"
        style={{ backgroundColor: palette.canvas }}
      >
        <span
          className="h-8 flex-1 rounded-md"
          style={{ backgroundColor: palette.surface, border: `1px solid ${palette.line}` }}
        />
        <span className="size-6 rounded-full" style={{ backgroundColor: palette.accent }} />
        <span className="size-3 rotate-45" style={{ backgroundColor: palette.trim }} />
      </span>
      <span className="block px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {meta.title}
          {saved && <CheckIcon className="text-tone-success size-3.5" />}
        </span>
        <span className="text-muted-foreground mt-0.5 block text-xs leading-snug">
          {meta.note}
        </span>
      </span>
    </button>
  );
}

/**
 * The kiosk, small.
 *
 * Painted from the same hex values the kiosk's own `index.css` defines for each skin. That is a
 * duplication and worth naming: the alternative is shipping the kiosk's stylesheet into the
 * portal's bundle to render a 300-pixel picture, and a preview that is only ever a preview is
 * the cheaper of the two wrongs. The values are the tokens' *seed* colours — anything a skin
 * derives at runtime is not reproduced here, and this makes no claim to be a screenshot.
 */
function KioskPreview({
  skin,
  language,
  greeting,
  greetingHi,
}: {
  skin: KioskSkin;
  language: KioskLanguageMode;
  greeting: string;
  greetingHi: string;
}): JSX.Element {
  const palette = SKIN_PALETTES[skin];
  const showEnglish = language !== 'HI';
  const showHindi = language !== 'EN';

  return (
    <aside
      className="overflow-hidden rounded-xl border transition-colors duration-500"
      style={{ backgroundColor: palette.canvas, borderColor: palette.line }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: `1px solid ${palette.line}` }}
      >
        <span>
          {showEnglish && (
            <span className="block text-sm font-semibold" style={{ color: palette.ink }}>
              North Hall Counter
            </span>
          )}
          {showHindi && (
            <span
              className="block text-xs"
              lang="hi"
              style={{ color: palette.ink, opacity: 0.62 }}
            >
              उत्तर भवन काउंटर
            </span>
          )}
        </span>
        <span className="size-6 rounded-full" style={{ backgroundColor: palette.accent }} />
      </div>

      <div className="px-4 py-4">
        {(greeting !== '' || greetingHi !== '') && (
          <p className="mb-3 text-center">
            {showHindi && greetingHi !== '' && (
              <span
                className="block text-base font-medium"
                lang="hi"
                style={{ color: palette.accent }}
              >
                {greetingHi}
              </span>
            )}
            {showEnglish && greeting !== '' && (
              <span
                className="block text-xs tracking-[0.18em] uppercase"
                style={{ color: palette.trim }}
              >
                {greeting}
              </span>
            )}
          </p>
        )}

        <div className="mb-3 flex gap-1.5 overflow-hidden">
          {['All', 'Thali', 'Drinks'].map((chip, index) => (
            <span
              key={chip}
              className="rounded-full px-2.5 py-1 text-[11px] whitespace-nowrap"
              style={
                index === 0
                  ? { backgroundColor: palette.accent, color: palette.canvas }
                  : {
                      backgroundColor: palette.surface,
                      color: palette.ink,
                      border: `1px solid ${palette.line}`,
                    }
              }
            >
              {chip}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              className="block h-14 rounded-lg"
              style={{ backgroundColor: palette.surface, border: `1px solid ${palette.line}` }}
            />
          ))}
        </div>

        <span
          className="mt-3 block rounded-full py-2 text-center text-xs font-medium"
          style={{ backgroundColor: palette.accent, color: palette.canvas }}
        >
          Review order
        </span>
      </div>
    </aside>
  );
}

function isDirty(settings: SettingDto[], key: string, value: unknown): boolean {
  const stored = settings.find((setting) => setting.key === key)?.value;
  return JSON.stringify(stored ?? '') !== JSON.stringify(value);
}
