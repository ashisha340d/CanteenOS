import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';

const FORM_ID = 'cleaning-reason-form';

/**
 * Capturing a written reason — cancelling a task, skipping a step.
 *
 * A `window.prompt` would have done the job and was what this replaced, but the portal has one
 * Modal standard and every other reason-capture flow follows it. A browser prompt is also
 * unstyled, unlabelled, untranslatable and blocks the whole tab, which is a poor way to collect
 * a sentence that ends up in a hygiene record.
 */
export function ReasonModal({
  open,
  title,
  description,
  placeholder,
  confirmLabel = 'Save',
  maxLength,
  submitting,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  placeholder?: string;
  confirmLabel?: string;
  maxLength: number;
  submitting?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Cleared on every open, so a reason typed for one step never leaks onto the next.
  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);

  function onSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (reason.trim() === '') {
      setError('A reason is required.');
      return;
    }
    onConfirm(reason.trim());
  }

  return (
    <Modal
      id="cleaning-reason"
      title={title}
      {...(description !== undefined ? { description } : {})}
      open={open}
      onClose={onClose}
      footer={
        <FormModalFooter
          formId={FORM_ID}
          onCancel={onClose}
          submitting={submitting}
          saveLabel={confirmLabel}
        />
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit}>
        <FieldGroup>
          {error !== null && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <TextField
            label="Reason"
            required
            multiline
            rows={3}
            autoFocus
            placeholder={placeholder}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={maxLength}
          />
        </FieldGroup>
      </form>
    </Modal>
  );
}
