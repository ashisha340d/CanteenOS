import { useCallback, useEffect, useRef, useState } from 'react';

export interface ModalGeometry {
  x: number;
  y: number;
  width: number;
  /**
   * `null` means "as tall as the content needs", capped by the viewport. A fixed default made
   * every dialog the same height, so a three-field form opened with a large empty gap above
   * its footer. Dragging the resize handle replaces it with a concrete height.
   */
  height: number | null;
}

/*
 * `v2`: opening a dialog persists its geometry immediately, so every dialog a user had ever
 * opened carried the old fixed 640px default. Versioning the key retires those so the
 * content-sized default above actually takes effect; a genuine resize re-persists at once.
 */
const GEOMETRY_PREFIX = 'menuboard.admin.modal.geometry.v2.';
const FORM_PREFIX = 'menuboard.admin.modal.form.';

/** Roughly where a content-sized dialog will end up, used to centre it before it has a height. */
const ASSUMED_HEIGHT = 420;

function defaultGeometry(): ModalGeometry {
  const width = Math.min(720, Math.round(window.innerWidth * 0.6));
  return {
    x: Math.round((window.innerWidth - width) / 2),
    y: Math.max(16, Math.round((window.innerHeight - ASSUMED_HEIGHT) / 2 - 20)),
    width,
    height: null,
  };
}

/** Persists a modal's on-screen position and size per modal id, restored on next open. */
export function useModalGeometry(modalId: string): {
  geometry: ModalGeometry;
  setGeometry: (next: ModalGeometry) => void;
} {
  const key = GEOMETRY_PREFIX + modalId;
  const [geometry, setGeometryState] = useState<ModalGeometry>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as ModalGeometry;
    } catch {
      // fall through to default
    }
    return defaultGeometry();
  });

  const setGeometry = useCallback(
    (next: ModalGeometry) => {
      setGeometryState(next);
      localStorage.setItem(key, JSON.stringify(next));
    },
    [key],
  );

  return { geometry, setGeometry };
}

/**
 * Persists in-progress form values for a modal so an accidental close (backdrop click,
 * navigation) does not lose the user's input. Call `clear()` after a successful submit.
 */
export function usePersistedFormState<T extends object>(
  modalId: string,
  initial: T,
  active: boolean,
): { value: T; setValue: (next: T) => void; clear: () => void } {
  const key = FORM_PREFIX + modalId;
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const [value, setValueState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return { ...initialRef.current, ...(JSON.parse(raw) as T) };
    } catch {
      // ignore malformed persisted state
    }
    return initialRef.current;
  });

  useEffect(() => {
    if (!active) return;
    try {
      const raw = localStorage.getItem(key);
      const restored = raw ? ({ ...initialRef.current, ...(JSON.parse(raw) as T) } as T) : initialRef.current;
      setValueState(restored);
    } catch {
      setValueState(initialRef.current);
    }
    // Only re-run when the modal transitions to active, or targets a different persistence key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key]);

  const setValue = useCallback(
    (next: T) => {
      setValueState(next);
      localStorage.setItem(key, JSON.stringify(next));
    },
    [key],
  );

  const clear = useCallback(() => {
    localStorage.removeItem(key);
  }, [key]);

  return { value, setValue, clear };
}
