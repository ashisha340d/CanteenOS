import { useCallback, useState } from 'react';
import { Linking } from 'react-native';
import type { CallOutcome } from '@menuboard/shared';
import { CallStatus } from '@menuboard/shared';
import { equipmentErrorMessage, suppliersApi } from '../api/equipment';

/**
 * One-tap supplier contact, with the timeline entry the module depends on.
 *
 * Both paths log *before* the handset takes over, because that is the last moment this app is
 * in control: Android exposes its call log only under READ_CALL_LOG, which this app
 * deliberately does not request, and WhatsApp never reports back either. So a call is recorded
 * from the dial intent and refined afterwards by the short outcome the user taps, and a
 * WhatsApp message is recorded as sent once its deep link has been opened.
 *
 * The server composes the WhatsApp wording; the phone only opens the link it is handed, so the
 * message reads identically whether it came from here or from the portal.
 */

export interface SupplierContactTarget {
  equipmentId: string;
  ticketId?: string | null;
  supplierId?: string | null;
}

export interface SupplierContact {
  busy: boolean;
  error: string | null;
  /** Set once a dial intent has gone out, so the caller can ask how the call went. */
  pendingCallId: string | null;
  call: (target: SupplierContactTarget & { phoneNumber: string }) => Promise<void>;
  whatsapp: (target: SupplierContactTarget) => Promise<void>;
  recordOutcome: (outcome: CallOutcome) => Promise<void>;
  dismissOutcome: () => void;
  clearError: () => void;
}

export function useSupplierContact(): SupplierContact {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingCallId, setPendingCallId] = useState<string | null>(null);

  const call = useCallback(
    async (target: SupplierContactTarget & { phoneNumber: string }): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        const log = await suppliersApi.logCall({
          equipmentId: target.equipmentId,
          ticketId: target.ticketId ?? null,
          supplierId: target.supplierId ?? null,
          phoneNumber: target.phoneNumber,
        });
        await Linking.openURL(`tel:${target.phoneNumber}`);
        setPendingCallId(log.id);
      } catch (caught) {
        setError(equipmentErrorMessage(caught, 'The call could not be placed.'));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const whatsapp = useCallback(async (target: SupplierContactTarget): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const draft = await suppliersApi.whatsappDraft({
        equipmentId: target.equipmentId,
        ticketId: target.ticketId ?? null,
        supplierId: target.supplierId ?? null,
      });
      await Linking.openURL(draft.deepLink);
      await suppliersApi.logWhatsapp({
        equipmentId: target.equipmentId,
        ticketId: target.ticketId ?? null,
        supplierId: draft.supplierId,
      });
    } catch (caught) {
      setError(equipmentErrorMessage(caught, 'WhatsApp could not be opened.'));
    } finally {
      setBusy(false);
    }
  }, []);

  const recordOutcome = useCallback(
    async (outcome: CallOutcome): Promise<void> => {
      if (pendingCallId === null) return;
      const callId = pendingCallId;
      setPendingCallId(null);
      try {
        await suppliersApi.recordCallOutcome(callId, {
          outcome,
          status: outcome === 'NO_ANSWER' ? CallStatus.MISSED : CallStatus.CONNECTED,
        });
      } catch (caught) {
        setError(equipmentErrorMessage(caught, 'The call outcome was not saved.'));
      }
    },
    [pendingCallId],
  );

  return {
    busy,
    error,
    pendingCallId,
    call,
    whatsapp,
    recordOutcome,
    dismissOutcome: () => setPendingCallId(null),
    clearError: () => setError(null),
  };
}
