import { useWindowManager, type ManagedWindow } from '@/services/WindowManager';
import './CaptionControls.css';

/*
 * Minimise / maximise / close, drawn the way Windows draws them: a row of flat rectangles
 * flush into the top-right corner, no gap between them, each lighting up on hover — and close
 * going red.
 *
 * The glyphs are hand-drawn rather than taken from the icon set, because these three marks are
 * a fixed vocabulary: a bare line, an empty square, two overlapping squares, a cross. An icon
 * library's minus and X are drawn to sit inside text, with a heavier stroke and rounder caps,
 * and at 10px that difference is the whole difference between "a title bar" and "some buttons".
 */

const STROKE = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1,
};

function Glyph({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <svg className="os-cap__glyph" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

const MinimiseGlyph = (): JSX.Element => (
  <Glyph>
    <path d="M0 5.5h10" {...STROKE} />
  </Glyph>
);

const MaximiseGlyph = (): JSX.Element => (
  <Glyph>
    <rect x="0.5" y="0.5" width="9" height="9" rx="0.75" {...STROKE} />
  </Glyph>
);

/** Two squares, the front one offset down-left — the shape that means "give it back its size". */
const RestoreGlyph = (): JSX.Element => (
  <Glyph>
    <path d="M2.5 2.5v-1a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" {...STROKE} />
    <rect x="0.5" y="2.5" width="7" height="7" rx="0.75" {...STROKE} />
  </Glyph>
);

const CloseGlyph = (): JSX.Element => (
  <Glyph>
    <path d="M0.7 0.7 9.3 9.3M9.3 0.7 0.7 9.3" {...STROKE} />
  </Glyph>
);

export function CaptionControls({
  win,
  /**
   * The maximised window docks its caption into the app bar, where the row is shorter than a
   * title bar. Same buttons, tighter metrics — not a different control.
   */
  docked = false,
}: {
  win: ManagedWindow;
  docked?: boolean;
}): JSX.Element {
  const { minimize, maximize, close } = useWindowManager();

  return (
    <div
      className={`os-cap ${docked ? 'os-cap--docked' : ''}`}
      // The title bar maximises on double-click; a double-click that lands on a button is
      // aimed at the button, and must not also toggle the window underneath it.
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="os-cap__btn"
        aria-label={`Minimise ${win.title}`}
        title="Minimise"
        onClick={() => minimize(win.id)}
      >
        <MinimiseGlyph />
      </button>

      {/* Full-screen appliances (POS, display screens) have no floating size to go back to,
          so they are never offered the control at all. */}
      {!win.alwaysMaximized && (
        <button
          type="button"
          className="os-cap__btn"
          aria-label={win.maximized ? `Restore ${win.title}` : `Maximise ${win.title}`}
          title={win.maximized ? 'Restore down' : 'Maximise'}
          onClick={() => maximize(win.id)}
        >
          {win.maximized ? <RestoreGlyph /> : <MaximiseGlyph />}
        </button>
      )}

      <button
        type="button"
        className="os-cap__btn os-cap__btn--close"
        aria-label={`Close ${win.title}`}
        title="Close"
        onClick={() => close(win.id)}
      >
        <CloseGlyph />
      </button>
    </div>
  );
}
