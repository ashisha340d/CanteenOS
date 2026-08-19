import { useLanguage } from '../i18n';
import { LottieMark } from '../lottie/Lottie';

interface GreetingProps {
  /** `kiosk.greeting` — the Latin form, e.g. "Radhe Radhe". */
  greeting: string;
  /** `kiosk.greeting_hi` — the Devanagari form, e.g. "राधे राधे". */
  greetingHi: string;
  /** The mark is dropped where the greeting is a caption on something else. */
  mark?: boolean;
  size?: number;
  className?: string;
}

/**
 * How the hall greets a guest.
 *
 * The words are a setting rather than a string-table entry, and the distinction matters: "राधे
 * राधे" is right at a Vaishnava temple and wrong at a hospital canteen running the same
 * software, so it is not the developer's to hard-code. What *is* hard-coded is that the
 * greeting is shown at all, and where — at the top of the menu while it loads, and again over
 * the token once the order is placed. Those two moments are the ones where a guest is waiting
 * with nothing to read.
 *
 * The Devanagari line leads when the hall is showing Hindi at all, which is the opposite of
 * every other bilingual pair in the kiosk. A greeting is not information to be scanned — it is
 * the thing being said, and at Mangarh it is said in Hindi.
 *
 * Renders nothing when both settings are blank. A hall that does not greet its guests gets
 * silence rather than an empty ornament, and the surrounding layout closes up around it.
 */
export function Greeting({
  greeting,
  greetingHi,
  mark = true,
  size = 72,
  className = '',
}: GreetingProps): JSX.Element | null {
  const { mode } = useLanguage();

  const latin = greeting.trim();
  const devanagari = greetingHi.trim();
  const showLatin = mode !== 'HI' && latin !== '';
  const showDevanagari = mode !== 'EN' && devanagari !== '';

  if (!showLatin && !showDevanagari) return null;

  return (
    <div className={`flex flex-col items-center ${className}`}>
      {mark && <LottieMark name="radhe" size={size} className="text-trim" />}

      {showDevanagari && (
        <p
          className="animate-greet font-display text-2xl leading-tight text-accent"
          lang="hi"
          // The words are the organisation's own and may be in any script; announcing them
          // once is right, announcing the same phrase twice in two scripts is not.
          aria-label={latin === '' ? undefined : latin}
        >
          {devanagari}
        </p>
      )}

      {showLatin && (
        <p
          className={`animate-greet text-2xs text-trim uppercase ${showDevanagari ? 'mt-1' : ''}`}
          aria-hidden={showDevanagari}
        >
          {latin}
        </p>
      )}
    </div>
  );
}
