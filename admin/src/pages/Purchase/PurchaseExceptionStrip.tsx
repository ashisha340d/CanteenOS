import { ExceptionSeverity, type PurchaseExceptionCode, type PurchaseExceptionDto } from '@menuboard/shared';
import { MARG_LABEL } from '../Pos/margChrome';

export interface PurchaseExceptionStripProps {
  exceptions: PurchaseExceptionDto[];
  acceptedCodes: PurchaseExceptionCode[];
  onToggleAccept: (code: PurchaseExceptionCode, accepted: boolean) => void;
  canOverride: boolean;
}

const CHIP: Record<string, string> = {
  [ExceptionSeverity.BLOCKING]: 'bg-[#a80000] text-white',
  [ExceptionSeverity.OVERRIDABLE]: 'bg-[#c47f00] text-black',
  [ExceptionSeverity.WARNING]: 'bg-[#c8d1ce] text-black',
  [ExceptionSeverity.INFO]: 'bg-[#c8d1ce] text-[#3c4b48]',
};

const ROW: Record<string, string> = {
  [ExceptionSeverity.BLOCKING]: 'text-[#a80000] font-bold',
  [ExceptionSeverity.OVERRIDABLE]: 'text-black',
  [ExceptionSeverity.WARNING]: 'text-[#3c4b48]',
  [ExceptionSeverity.INFO]: 'text-[#5f7370]',
};

/** Unresolved exceptions only: a resolved one is history, not something to act on. */
export function openExceptions(exceptions: PurchaseExceptionDto[]): PurchaseExceptionDto[] {
  return exceptions.filter((exception) => !exception.isResolved);
}

export function blockingExceptions(exceptions: PurchaseExceptionDto[]): PurchaseExceptionDto[] {
  return openExceptions(exceptions).filter(
    (exception) => exception.severity === ExceptionSeverity.BLOCKING,
  );
}

export function overridableExceptions(exceptions: PurchaseExceptionDto[]): PurchaseExceptionDto[] {
  return openExceptions(exceptions).filter(
    (exception) => exception.severity === ExceptionSeverity.OVERRIDABLE,
  );
}

/**
 * Exceptions sit on the document, one dense line each, immediately above the action bar —
 * where the operator's eye already is when reaching for SAVE.
 */
export function PurchaseExceptionStrip({
  exceptions,
  acceptedCodes,
  onToggleAccept,
  canOverride,
}: PurchaseExceptionStripProps): JSX.Element | null {
  const open = openExceptions(exceptions);
  if (open.length === 0) return null;

  const order: Record<string, number> = {
    [ExceptionSeverity.BLOCKING]: 0,
    [ExceptionSeverity.OVERRIDABLE]: 1,
    [ExceptionSeverity.WARNING]: 2,
    [ExceptionSeverity.INFO]: 3,
  };
  const sorted = open
    .slice()
    .sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

  return (
    <div className="max-h-[7.5rem] shrink-0 overflow-auto border-t border-[#7d9490] bg-[#e8ede9]">
      <div
        className={`sticky top-0 flex items-center gap-2 border-b border-[#7d9490] bg-[#dfe6e2] px-1.5 text-[11px] leading-[15px] font-bold ${MARG_LABEL}`}
      >
        <span>EXCEPTIONS ({open.length})</span>
      </div>
      {sorted.map((exception) => {
        const isOverridable = exception.severity === ExceptionSeverity.OVERRIDABLE;
        const accepted = acceptedCodes.includes(exception.code);
        return (
          <div
            key={exception.id}
            className={`flex items-center gap-2 px-1.5 text-[12px] leading-[16px] uppercase ${ROW[exception.severity] ?? ''}`}
          >
            <span
              className={`w-[5.5rem] shrink-0 px-1 text-center text-[11px] leading-[15px] font-bold ${CHIP[exception.severity] ?? ''}`}
            >
              {exception.severity}
            </span>
            <span className="w-[13rem] shrink-0 truncate">{exception.code}</span>
            <span className="min-w-0 flex-1 truncate">{exception.message}</span>
            {exception.expectedValue !== null && (
              <span className="shrink-0 tabular-nums">EXP {exception.expectedValue}</span>
            )}
            {exception.actualValue !== null && (
              <span className="shrink-0 tabular-nums">ACT {exception.actualValue}</span>
            )}
            {isOverridable && (
              <label className="flex shrink-0 items-center gap-1">
                <input
                  type="checkbox"
                  className="size-[12px] accent-[#2e6f6a]"
                  checked={accepted}
                  disabled={!canOverride}
                  onChange={(event) => onToggleAccept(exception.code, event.target.checked)}
                />
                <span className="text-[11px] font-bold">ACCEPT</span>
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}
