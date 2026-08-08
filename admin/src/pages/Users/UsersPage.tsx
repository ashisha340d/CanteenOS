import { useMemo, useState } from 'react';
import { Capability, UserRole, UserStatus, type UserDto } from '@menuboard/shared';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { SelectField } from '@/components/form/fields';
import { DeleteAction, EditAction, RowActions } from '@/components/RowActions';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { useViewMode } from '../../components/DataTable/gridState';
import { EntityCardGrid } from '../../components/EntityCardGrid';
import { ListToolbar } from '../../components/ListToolbar';
import { PageHeader } from '../../components/ui/PageHeader';
import { StatusChip } from '../../components/StatusChip';
import { IfCapable } from '../../services/CapabilityGate';
import { useAuth } from '../../services/AuthContext';
import { useDeleteUser, useUsers } from '../../hooks/useUsers';
import { enumOptions, humanise } from '@/lib/options';
import { notify } from '@/lib/notify';
import { UserFormModal } from './UserFormModal';

export function UsersPage(): JSX.Element {
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [view, setView] = useViewMode('users');
  const [editing, setEditing] = useState<UserDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<UserDto | null>(null);

  const query = useMemo(
    () => ({
      search: search || undefined,
      role: role || undefined,
      status: status || undefined,
      page,
      pageSize,
      sortBy,
      sortDir,
    }),
    [search, role, status, page, pageSize, sortBy, sortDir],
  );

  const { data, isLoading } = useUsers(query);
  const deleteUser = useDeleteUser();

  const columns: DataTableColumn<UserDto>[] = [
    { field: 'name', headerName: 'Name', width: 200 },
    { field: 'username', headerName: 'Username', width: 160 },
    { field: 'role', headerName: 'Role', width: 140, renderCell: (r) => humanise(r.role) },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      sortable: false,
      renderCell: (r) => <StatusChip status={r.status} />,
    },
    { field: 'email', headerName: 'Email', width: 200, sortable: false, valueGetter: (r) => r.email ?? '—' },
    { field: 'phone', headerName: 'Phone', width: 140, sortable: false, valueGetter: (r) => r.phone ?? '—' },
    {
      field: 'lastLoginAt',
      headerName: 'Last login',
      width: 170,
      sortable: false,
      valueGetter: (r) => (r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString() : 'Never'),
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 110,
      sortable: false,
      align: 'right',
      alwaysVisible: true,
      renderCell: (r) => (
        <IfCapable capability={Capability.USER_WRITE}>
          <RowActions>
            <EditAction label={r.name} onClick={() => setEditing(r)} />
            <DeleteAction
              label={r.name}
              disabled={r.id === currentUser?.id}
              tooltip={r.id === currentUser?.id ? 'You cannot delete your own account' : 'Delete'}
              onClick={() => setDeleting(r)}
            />
          </RowActions>
        </IfCapable>
      ),
    },
  ];

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    try {
      await deleteUser.mutateAsync(deleting.id);
      notify.success('User deleted.');
      setDeleting(null);
    } catch (err) {
      notify.fromError(err);
      setDeleting(null);
    }
  }

  const activeFilterCount = (role ? 1 : 0) + (status ? 1 : 0);
  const filtersActive = activeFilterCount > 0 || search.trim() !== '';

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Everyone who can sign in, and what they are allowed to do."
      />
      <ListToolbar
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        activeFilterCount={activeFilterCount}
        onClearFilters={() => {
          setRole('');
          setStatus('');
          setPage(1);
        }}
        filters={
          <>
            <SelectField
              label="Role"
              value={role}
              onChange={(v) => {
                setRole(v as UserRole | '');
                setPage(1);
              }}
              emptyLabel="All roles"
              options={enumOptions(UserRole)}
            />
            <SelectField
              label="Status"
              value={status}
              onChange={(v) => {
                setStatus(v as UserStatus | '');
                setPage(1);
              }}
              emptyLabel="All statuses"
              options={enumOptions(UserStatus)}
            />
          </>
        }
        view={view}
        onViewChange={setView}
        page={page}
        pageSize={pageSize}
        total={data?.meta.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onCreate={() => setEditing(null)}
        createLabel="New user"
      />

      {view === 'table' ? (
        <DataTable
          gridId="users"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={(field, dir) => {
            setSortBy(field);
            setSortDir(dir);
          }}
          onRowDoubleClick={(r) => setEditing(r)}
          filtered={filtersActive}
          emptyTitle="No users yet"
          emptyMessage="Create the first account to let someone sign in."
          emptyAction={{ label: 'New user', onClick: () => setEditing(null) }}
        />
      ) : (
        <EntityCardGrid
          rows={data?.items ?? []}
          getRowId={(r) => r.id}
          loading={isLoading}
          onCardDoubleClick={(r) => setEditing(r)}
          filtered={filtersActive}
          emptyTitle="No users yet"
          emptyMessage="Create the first account to let someone sign in."
          emptyAction={{ label: 'New user', onClick: () => setEditing(null) }}
          renderCard={(r) => (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Avatar className="size-9 shrink-0">
                  <AvatarFallback>{r.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-[0.9375rem] leading-tight font-semibold">{r.name}</p>
                  <p className="text-muted-foreground truncate text-xs leading-tight">
                    @{r.username}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{humanise(r.role)}</Badge>
                <StatusChip status={r.status} />
              </div>
            </div>
          )}
        />
      )}

      {editing !== undefined && (
        <UserFormModal
          open={editing !== undefined}
          editing={editing}
          onClose={() => setEditing(undefined)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete user"
        message={`Delete "${deleting?.name}"? This soft-deletes the account and revokes all of their sessions.`}
        confirmLabel="Delete"
        danger
        loading={deleteUser.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
