import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { CheckboxField, FieldGroup, FieldRow, TextField } from '@/components/form/fields';
import { Modal } from '../../components/Modal/Modal';
import { SearchPickerField } from '../../components/SearchPickerField';
import { boardsApi } from '../../api/boards';
import { useGenerateBilling } from '../../hooks/useAdmin';
import { readError } from '../../services/errorMessage';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const FORM_ID = 'generate-billing-form';

/**
 * Billing generation is explicit, one-way and immutable (docs/TASK.md §6.4): this modal
 * requires an explicit confirmation of board + period before submitting, and never shows a
 * computed money total — there is no pricing in this system.
 */
export function GenerateBillingModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const [allBoards, setAllBoards] = useState(true);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [boardLabel, setBoardLabel] = useState('');
  const [boardSearch, setBoardSearch] = useState('');
  const [periodFrom, setPeriodFrom] = useState(todayIso());
  const [periodTo, setPeriodTo] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generate = useGenerateBilling();

  const { data: boardOptions, isFetching } = useQuery({
    queryKey: ['board-picker-billing', boardSearch],
    queryFn: () => boardsApi.list({ search: boardSearch || undefined, page: 1, pageSize: 20 }),
    enabled: open && !allBoards,
  });

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!confirmed) {
      setError('Confirm that you understand this action is permanent.');
      return;
    }
    try {
      await generate.mutateAsync({
        boardId: allBoards ? null : boardId,
        periodFrom,
        periodTo,
        notes: notes || null,
      });
      onClose();
      setConfirmed(false);
    } catch (err) {
      const readable = readError(err);
      setError(
        readable.code === 'CONFLICT'
          ? 'No completed orders were found in this period.'
          : readable.message,
      );
    }
  }

  return (
    <Modal
      id="generate-billing"
      title="Generate billing snapshot"
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={generate.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={generate.isPending}>
            {generate.isPending && <Spinner data-icon="inline-start" />}
            {generate.isPending ? 'Generating…' : 'Generate snapshot'}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Alert>
            <TriangleAlertIcon />
            <AlertDescription>
              This freezes an immutable snapshot of completed orders for the chosen board and
              period. Regenerating the same board and period later creates a new version — it
              never replaces this one.
            </AlertDescription>
          </Alert>

          <CheckboxField label="All boards" checked={allBoards} onCheckedChange={setAllBoards} />

          {!allBoards && (
            <SearchPickerField
              id="billing-board"
              label="Board"
              value={boardId}
              displayValue={boardLabel}
              options={(boardOptions?.items ?? []).map((b) => ({ id: b.id, label: b.name }))}
              loading={isFetching}
              onSearchChange={setBoardSearch}
              onSelect={(opt) => {
                setBoardId(opt.id);
                setBoardLabel(opt.label);
              }}
              required
            />
          )}

          <FieldRow>
            <TextField
              label="Period from"
              type="date"
              value={periodFrom}
              onChange={(e) => setPeriodFrom(e.target.value)}
              required
            />
            <TextField
              label="Period to"
              type="date"
              value={periodTo}
              onChange={(e) => setPeriodTo(e.target.value)}
              required
            />
          </FieldRow>

          <TextField
            label="Notes (optional)"
            multiline
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <CheckboxField
            label="I understand this is permanent"
            helperText={`This generates an immutable billing snapshot for ${
              allBoards ? 'all boards' : boardLabel || 'the selected board'
            } covering ${periodFrom} to ${periodTo}.`}
            checked={confirmed}
            onCheckedChange={setConfirmed}
          />
        </FieldGroup>
      </form>
    </Modal>
  );
}
