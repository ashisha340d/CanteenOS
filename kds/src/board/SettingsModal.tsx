import { LockKeyhole, X } from 'lucide-react';
import type { DisplaySettingsApi, KdsDensity, KdsSkin } from '../config/displaySettings';

interface Props {
  display: DisplaySettingsApi;
  outOfStation: boolean;
  onToggleOutOfStation: () => void;
  onLock: () => void;
  onChangeStation: () => void;
  onSignOut: () => void;
  onClose: () => void;
}

const SKINS: { id: KdsSkin; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
];

const DENSITIES: { id: KdsDensity; label: string }[] = [
  { id: 'compact', label: 'Compact' },
  { id: 'default', label: 'Default' },
  { id: 'light', label: 'Light' },
];

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
  const { settings, update } = display;

  return (
    <div className="kds-settings__backdrop" onClick={onClose}>
      <div
        className="kds-settings__panel"
        role="dialog"
        aria-label="Display settings"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="kds-settings__head">
          <h2>Display settings</h2>
          <button type="button" className="kds-topbar__btn" onClick={onClose} aria-label="Close settings">
            <X className="size-4" />
          </button>
        </div>

        <div className="kds-settings__body">
          <div>
            <span className="kds-settings__label">Background</span>
            <div className="kds-settings__options" role="radiogroup" aria-label="Background skin">
              {SKINS.map((skin) => (
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
            <span className="kds-settings__label">Text font</span>
            <div className="kds-settings__options" role="radiogroup" aria-label="Text size">
              {DENSITIES.map((density) => (
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
            <span className="kds-settings__label">Card size</span>
            <div className="kds-settings__slider">
              <input
                type="range"
                min={0.8}
                max={1.5}
                step={0.05}
                value={settings.cardScale}
                onChange={(event) => update({ cardScale: Number(event.target.value) })}
                aria-label="Card size"
              />
              <output>{Math.round(settings.cardScale * 100)}%</output>
            </div>
          </div>

          <div>
            <span className="kds-settings__label">Out-of-station detection</span>
            <div className="kds-settings__options">
              {IDLE_CHOICES.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className={`kds-settings__option ${settings.idleAwayMinutes === minutes ? 'kds-settings__option--active' : ''}`}
                  onClick={() => update({ idleAwayMinutes: minutes })}
                >
                  {minutes === 0 ? 'Off' : `${minutes} min`}
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
                {outOfStation ? 'Back at station' : 'Step away now'}
              </button>
            </div>
          </div>

          <div className="kds-settings__divider" />

          <div className="kds-settings__row">
            <button type="button" className="kds-topbar__btn" onClick={onLock}>
              <LockKeyhole className="size-4" /> Lock screen
            </button>
            <button type="button" className="kds-topbar__btn" onClick={onChangeStation}>
              Change station
            </button>
            <button type="button" className="kds-topbar__btn" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
