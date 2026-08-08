import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/**
 * The Cancel/Save pair every record form ends with. Shared so the submit stays wired to the
 * form by id — the buttons live in the modal's footer, outside the `<form>` element — and so
 * the pending state looks the same in all ten of them.
 */
export function FormModalFooter({
  formId,
  onCancel,
  submitting,
  saveLabel = 'Save',
  savingLabel = 'Saving…',
  disabled,
}: {
  formId: string;
  onCancel: () => void;
  submitting?: boolean;
  saveLabel?: string;
  savingLabel?: string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <>
      <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
        Cancel
      </Button>
      <Button type="submit" form={formId} disabled={submitting || disabled}>
        {submitting && <Spinner data-icon="inline-start" />}
        {submitting ? savingLabel : saveLabel}
      </Button>
    </>
  );
}
