import { useState } from 'react';
import { BoardRole } from '@menuboard/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, SelectField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { SearchPickerField } from '../../components/SearchPickerField';
import { usersApi } from '../../api/users';
import { useUpsertBoardMember } from '../../hooks/useBoards';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';

const FORM_ID = 'add-member-form';

export function AddMemberModal({
  open,
  onClose,
  boardId,
}: {
  open: boolean;
  onClose: () => void;
  boardId: string;
}): JSX.Element {
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [userLabel, setUserLabel] = useState('');
  const [boardRole, setBoardRole] = useState<BoardRole>(BoardRole.MEMBER);
  const [error, setError] = useState<string | null>(null);
  const upsert = useUpsertBoardMember(boardId);

  const { data, isFetching } = useQuery({
    queryKey: ['user-picker', search],
    queryFn: () => usersApi.list({ search: search || undefined, page: 1, pageSize: 20 }),
    enabled: open,
  });

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!userId) {
      setError('Choose a user first.');
      return;
    }
    try {
      await upsert.mutateAsync({ userId, boardRole });
      onClose();
      setUserId(null);
      setUserLabel('');
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="board-add-member"
      title="Add board member"
      open={open}
      onClose={onClose}
      footer={
        <FormModalFooter
          formId={FORM_ID}
          onCancel={onClose}
          submitting={upsert.isPending}
          saveLabel="Add member"
          savingLabel="Adding…"
        />
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <SearchPickerField
            id="board-member-user"
            label="User"
            value={userId}
            displayValue={userLabel}
            options={(data?.items ?? []).map((u) => ({
              id: u.id,
              label: u.name,
              sublabel: `@${u.username}`,
            }))}
            loading={isFetching}
            onSearchChange={setSearch}
            onSelect={(opt) => {
              setUserId(opt.id);
              setUserLabel(`${opt.label} (${opt.sublabel})`);
            }}
            required
          />

          <SelectField
            label="Board role"
            value={boardRole}
            onChange={(v) => setBoardRole(v as BoardRole)}
            options={enumOptions(BoardRole)}
          />
        </FieldGroup>
      </form>
    </Modal>
  );
}
