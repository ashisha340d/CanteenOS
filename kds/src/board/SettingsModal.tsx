import { LockKeyhole, X } from 'lucide-react';
import {
  CARD_SCALE_MAX,
  CARD_SCALE_MIN,
  type DisplaySettingsApi,
  type KdsDensity,
  type KdsSkin,
} from '../config/displaySettings';
import { useT } from '../i18n';
import { LanguageSwitch } from '../components/LanguageSwitch';

interface Props {
  display: DisplaySettingsApi;
  outOfStation: boolean;
  onToggleOutOfStation: () => void;
  onLock: () => void;
  onChangeStation: () => void;
  onSignOut: () => void;
  onClose: () => void;
}

const IDLE_CHOICES = [0, 2, 5, 10, 15];

/** The display's own settings — every choice lands on this station only and survives reloads. */
export function SettingsModal({
  display,
  outOfStation,
  onToggleOutOfStation,
  onLock,
  onChangeStation,
  onSignOut,
  onClose,
}: Props): JSX.Element {
  const t = useT();
  const { settings, update } = display;

  /* Built here rather than at module scope: the labels come from the dictionary, and the
     dictionary is only known once the screen's language is. */
  const skins: { id: KdsSkin; label: string }[] = [
    { id: 'light', label: t.skinLight },
    { id: 'dark', label: t.skinDark },
    { id: 'system', label: t.skinSystem },
  ];
  const densities: { id: KdsDensity; label: string }[] = [
    { id: 'compact', label: t.densityCompact },
    { id: 'default', label: t.densityDefault },
    { id: 'light', label: t.densityLight },
  ];

  return (
    <div className="kds-settings__backdrop" onClick={onClose}>
      <div
        className="kds-settings__panel"
        role="dialog"
        aria-label={t.displaySettings}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="kds-settings__head">
          <h2>{t.displaySettings}</h2>
          <button type="button" className="kds-topbar__btn" onClick={onClose} aria-label={t.close}>
            <X className="size-4" />
          </button>
        </div>

        <div className="kds-settings__body">
          {/* First, because it is the setting that changes every other word on this panel. */}
          <div>
            <span className="kds-settings__label">{t.language}</span>
            <LanguageSwitch />
          </div>

          <div>
            <span className="kds-settings__label">{t.background}</span>
            <div className="kds-settings__options" role="radiogroup" aria-label={t.background}>
              {skins.map((skin) => (
                <button
                  key={skin.id}
                  type="button"
                  role="radio"
                  aria-checked={settings.skin === skin.id}
                  className={`kds-settings__option ${settings.skin === skin.id ? 'kds-settings__option--active' : ''}`}
                  onClick={() => update({ skin: skin.id })}
                >
                  {skin.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="kds-settings__label">{t.textSize}</span>
            <div className="kds-settings__options" role="radiogroup" aria-label={t.textSize}>
              {densities.map((density) => (
                <button
                  key={density.id}
                  type="button"
                  role="radio"
                  aria-checked={settings.density === density.id}
                  className={`kds-settings__option ${settings.density === density.id ? 'kds-settings__option--active' : ''}`}
                  onClick={() => update({ density: density.id })}
                >
                  {density.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="kds-settings__label">{t.cardSize}</span>
            <div className="kds-settings__slider">
              <input
                type="range"
                min={CARD_SCALE_MIN}
                max={CARD_SCALE_MAX}
                step={0.05}
                value={settings.cardScale}
                onChange={(event) => update({ cardScale: Number(event.target.value) })}
                aria-label={t.cardSize}
              />
              <output>{Math.round(settings.cardScale * 100)}%</output>
            </div>
          </div>

          <div>
            <span className="kds-settings__label">{t.outOfStationDetection}</span>
            <div className="kds-settings__options">
              {IDLE_CHOICES.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className={`kds-settings__option ${settings.idleAwayMinutes === minutes ? 'kds-settings__option--active' : ''}`}
                  onClick={() => update({ idleAwayMinutes: minutes })}
                >
                  {minutes === 0 ? t.off : t.minutesShort(minutes)}
                </button>
              ))}
            </div>
            <div className="kds-settings__options" style={{ marginTop: 8 }}>
              <button
                type="button"
                className={`kds-settings__option ${outOfStation ? 'kds-settings__option--active' : ''}`}
                aria-pressed={outOfStation}
                onClick={onToggleOutOfStation}
              >
                {outOfStation ? t.backAtStation : t.stepAwayNow}
              </button>
            </div>
          </div>

          <div className="kds-settings__divider" />

          <div className="kds-settings__row">
            <button type="button" className="kds-topbar__btn" onClick={onLock}>
              <LockKeyhole className="size-4" /> {t.lockScreen}
            </button>
            <button type="button" className="kds-topbar__btn" onClick={onChangeStation}>{t.changeStation}</button>
            <button type="button" className="kds-topbar__btn" onClick={onSignOut}>{t.signOut}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
