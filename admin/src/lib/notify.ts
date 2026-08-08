import { toast } from 'sonner';
import { readError } from '@/services/errorMessage';

/**
 * One place to raise a transient message.
 *
 * Replaces the per-page `useState` + `<Snackbar>` pairs the portal used to carry: those
 * stacked badly when two fired at once, could not be raised from outside a component, and
 * meant every page re-implemented the same two pieces of state. Durations match the previous
 * behaviour — successes clear quickly, errors linger long enough to be read.
 */

const SUCCESS_MS = 3000;
const ERROR_MS = 6000;

export const notify = {
  success: (message: string): void => void toast.success(message, { duration: SUCCESS_MS }),
  info: (message: string): void => void toast.info(message, { duration: SUCCESS_MS }),
  warning: (message: string): void => void toast.warning(message, { duration: ERROR_MS }),
  error: (message: string): void => void toast.error(message, { duration: ERROR_MS }),

  /** Unwraps an API error into the same human-readable text the pages showed before. */
  fromError: (error: unknown): void => {
    toast.error(readError(error).message, { duration: ERROR_MS });
  },
};
