import { useState } from 'react';
import { BoardRole, type BoardMemberDto } from '@menuboard/shared';
import { useParams } from 'react-router-dom';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DeleteAction, RowActions } from '@/components/RowActions';
import { BackButton } from '../../components/BackButton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { ListToolbar } from '../../components/ListToolbar';
import { PageHeader } from '../../components/ui/PageHeader';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { StatusChip } from '../../components/StatusChip';
import {
  useBoard,
  useBoardMembers,
  useRemoveBoardMember,
  useUpsertBoardMember,
} from '../../hooks/useBoards';
import { notify } from '@/lib/notify';
import { AddMemberModal } from './AddMemberModal';

export function BoardMembersPage(): JSX.Element {
  const { boardId } = useParams<{ boardId: string }>();
  const { data: board } = useBoard(boardId);
  const { data: members, isLoading } = useBoardMembers(boardId);
  const [search, setSearch] = useState('');
  const [view, setView] = useViewMode('board-members');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<BoardMemberDto | null>(null);

  const upsert = useUpsertBoardMember(boardId ?? '');
  const remove = useRemoveBoardMember(boardId ?? '');

  const filtered = (members ?? []).filter((m) =>
    (m.userName ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  async function changeRole(member: BoardMemberDto, role: BoardRole): Promise<void> {
    try {
      await upsert.mutateAsync({ userId: member.userId, boardRole: role });
      notify.success('Role updated.');
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function confirmRemove(): Promise<void> {
    if (!removing) return;
    try {
      await remove.mutateAsync(removing.userId);
      notify.success('Member removed.');
      setRemoving(null);
    } catch (err) {
      notify.fromError(err);
      setRemoving(null);
    }
  }

  const columns: DataTableColumn<BoardMemberDto>[] = [
    {
      field: 'userName',
      headerName: 'Name',
      width: 220,
      valueGetter: (r) => r.userName ?? r.userId,
    },
    {
      field: 'boardRole',
      headerName: 'Board role',
      width: 180,
      // Inline editing is safe here: the mutation is a single idempotent upsert, and the
      // server refuses anything that would strip the board's last owner.
      renderCell: (r) => (
        <Select value={r.boardRole} onValueChange={(v) => void changeRole(r, v as BoardRole)}>
          <SelectTrigger size="sm" className="w-full" aria-label={`Board role for ${r.userName ?? r.userId}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {Object.values(BoardRole).map((role) => (
                <SelectItem key={role} value={role}>
                  {role}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      renderCell: (r) => <StatusChip status={r.status} />,
    },
    {
      field: 'joinedAt',
      headerName: 'Joined',
      width: 170,
      valueGetter: (r) => (r.joinedAt ? new Date(r.joinedAt).toLocaleDateString() : '—'),
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 90,
      sortable: false,
      align: 'right',
      alwaysVisible: true,
      renderCell: (r) => (
        <RowActions>
          <DeleteAction
            label={r.userName ?? r.userId}
            tooltip="Remove — refused if this is the board's last owner"
            onClick={() => setRemoving(r)}
          />
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        leading={<BackButton to="/boards" label="Back to Boards" />}
        eyebrow={board?.name ?? '…'}
        title="Members"
        subtitle={board?.description ?? 'Who can see and act on this board, and in what capacity.'}
      />

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        view={view}
        onViewChange={setView}
        page={1}
        pageSize={filtered.length || 1}
        total={filtered.length}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        onCreate={() => setAdding(true)}
        createLabel="Add member"
      />

      {view === 'table' ? (
        <DataTable
          gridId="board-members"
          columns={columns}
          rows={filtered}
          getRowId={(r) => r.id}
          loading={isLoading}
          filtered={search.trim() !== ''}
          emptyTitle="No members yet"
          emptyMessage="Add people so they can see this board and act on its orders."
          emptyAction={{ label: 'Add member', onClick: () => setAdding(true) }}
        />
      ) : (
        <EntityCardGrid
          rows={filtered}
          getRowId={(r) => r.id}
          loading={isLoading}
          filtered={search.trim() !== ''}
          emptyTitle="No members yet"
          emptyMessage="Add people so they can see this board and act on its orders."
          emptyAction={{ label: 'Add member', onClick: () => setAdding(true) }}
          renderCard={(r) => (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Avatar className="size-9 shrink-0">
                  <AvatarFallback>{(r.userName ?? '?').slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-[0.9375rem] leading-tight font-semibold">
                    {r.userName ?? r.userId}
                  </p>
                  <p className="text-muted-foreground text-xs leading-tight">{r.boardRole}</p>
                </div>
              </div>
              <StatusChip status={r.status} className="self-start" />
            </div>
          )}
        />
      )}

      {boardId && (
        <AddMemberModal open={adding} onClose={() => setAdding(false)} boardId={boardId} />
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove member"
        message={`Remove ${removing?.userName ?? 'this member'} from the board? This is refused if they are the last OWNER.`}
        confirmLabel="Remove"
        danger
        loading={remove.isPending}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}
