import type { ElementType, ReactNode } from 'react';
import { useLanguage } from '../i18n';
import type { StringKey } from '../i18n/strings';

/**
 * A label that may be two labels.
 *
 * In `BOTH` mode every guest-facing string appears twice, and the second line is *not* a
 * footnote: it is set at nine-tenths the size in soft ink, close enough under the first to
 * read as one bilingual label rather than as a translation somebody bolted on. That is the
 * whole reason `t`/`ts` return two strings instead of one joined with a slash — a joined
 * string cannot take the leading Devanagari needs, and it wraps in the wrong place.
 *
 * Everything guest-facing goes through this or through `Dual`. A screen that renders `t(...)`
 * alone is a screen that silently drops half the hall's readers when the mode changes.
 */

interface BilingualProps {
  /** Key looked up in both tables. */
  k: StringKey;
  values?: Record<string, string | number>;
  as?: ElementType;
  className?: string;
  /** Applied to the second line; defaults to a smaller, softer version of the first. */
  secondaryClassName?: string;
}

export function Bilingual({
  k,
  values,
  as: Tag = 'span',
  className = '',
  secondaryClassName = 'mt-0.5 block text-[0.86em] text-ink-soft',
}: BilingualProps): JSX.Element {
  const { t, ts, primaryLang, secondaryLang } = useLanguage();
  const second = ts(k, values);

  return (
    <Tag className={className} lang={primaryLang}>
      {t(k, values)}
      {second !== null && (
        <span className={secondaryClassName} lang={secondaryLang}>
          {second}
        </span>
      )}
    </Tag>
  );
}

interface DualProps {
  /** The English column of a Menu Master row. */
  english: string;
  /** Its Hindi column, when the catalogue has one. */
  hindi: string | null | undefined;
  as?: ElementType;
  className?: string;
  secondaryClassName?: string;
}

/** The same, for a value that came out of the catalogue rather than the string table. */
export function Dual({
  english,
  hindi,
  as: Tag = 'span',
  className = '',
  secondaryClassName = 'mt-0.5 block text-[0.86em] text-ink-soft',
}: DualProps): JSX.Element {
  const { pick, picks, primaryLang, secondaryLang } = useLanguage();
  const second = picks(english, hindi);

  return (
    <Tag className={className} lang={primaryLang}>
      {pick(english, hindi)}
      {second !== null && (
        <span className={secondaryClassName} lang={secondaryLang}>
          {second}
        </span>
      )}
    </Tag>
  );
}

/** For a label that is already a pair of strings — a button that also carries an icon, say. */
export function DualInline({
  primary,
  secondary,
  className = '',
}: {
  primary: ReactNode;
  secondary: string | null;
  className?: string;
}): JSX.Element {
  const { primaryLang, secondaryLang } = useLanguage();
  return (
    <span className={`inline-flex flex-col items-center leading-tight ${className}`}>
      <span lang={primaryLang}>{primary}</span>
      {secondary !== null && (
        <span className="text-[0.8em] opacity-80" lang={secondaryLang}>
          {secondary}
        </span>
      )}
    </span>
  );
}
