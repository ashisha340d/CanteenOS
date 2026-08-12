import { BoardRole, Capability, UserRole } from '@menuboard/shared';
import { CheckIcon, InfoIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TableSkeleton } from '../../components/ui/Skeletons';
import { useAuth } from '@/services/AuthContext';
import {
  usePermissionsMatrix,
  useSetBoardRoleCapability,
  useSetRoleCapability,
} from '../../hooks/useAdmin';
import { PageHeader } from '@/components/ui/PageHeader';
import { humanise } from '@/lib/options';
import { notify } from '@/lib/notify';

/**
 * Editable view of the role -> capability grants. Reads and writes the database-backed
 * matrix (backend/src/services/PermissionsCacheService.ts) that every authorisation check in
 * the backend enforces — toggling a cell here takes effect on the very next request. Role
 * assignment itself (which user holds which role) still happens on the Users page.
 */
export function PermissionsPage(): JSX.Element {
  const { data, isLoading } = usePermissionsMatrix();
  const { hasCapability } = useAuth();
  const canEdit = hasCapability(Capability.PERMISSION_WRITE);
  const setRoleCapability = useSetRoleCapability();
  const setBoardRoleCapability = useSetBoardRoleCapability();

  if (isLoading || !data) {
    return <TableSkeleton rows={10} columns={5} />;
  }

  const allCapabilities = Array.from(
    new Set([
      ...Object.values(data.roleCapabilities).flat(),
      ...Object.values(data.boardRoleCapabilities).flat(),
    ]),
  ).sort();

  const roles = Object.keys(data.roleCapabilities);
  const boardRoles = Object.keys(data.boardRoleCapabilities);

  async function toggleRole(role: string, capability: string, granted: boolean): Promise<void> {
    try {
      await setRoleCapability.mutateAsync({
        role: role as UserRole,
        capability: capability as Capability,
        granted,
      });
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function toggleBoardRole(
    boardRole: string,
    capability: string,
    granted: boolean,
  ): Promise<void> {
    try {
      await setBoardRoleCapability.mutateAsync({
        boardRole: boardRole as BoardRole,
        capability: capability as Capability,
        granted,
      });
    } catch (err) {
      notify.fromError(err);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="People"
        title="Permissions"
        subtitle="What each role can do, as enforced by the server. This is the matrix the whole portal reads its visibility from."
      />

      <div className="flex flex-col gap-6">
        <Alert>
          <InfoIcon />
          <AlertDescription>
            {canEdit
              ? 'Toggling a capability here changes it immediately for everyone with that role. To change a user\u2019s role, use the Users page.'
              : "Read-only: you don't hold permission.write. What each role can do, as enforced by the server."}
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Global role capabilities</CardTitle>
            <CardDescription>What each account-level role can do anywhere.</CardDescription>
          </CardHeader>
          <CardContent>
            <MatrixTable
              columns={roles}
              formatColumn={humanise}
              capabilities={allCapabilities.filter((cap) =>
                roles.some((role) =>
                  data.roleCapabilities[role as keyof typeof data.roleCapabilities]?.includes(
                    cap as never,
                  ),
                ),
              )}
              has={(cap, role) =>
                Boolean(
                  data.roleCapabilities[role as keyof typeof data.roleCapabilities]?.includes(
                    cap as never,
                  ),
                )
              }
              editable={canEdit}
              isDisabled={(cap, role) =>
                role === UserRole.ADMIN &&
                (cap === Capability.PERMISSION_WRITE || cap === Capability.PERMISSION_READ)
              }
              disabledReason="The Admin role must always be able to read and edit permissions."
              onToggle={toggleRole}
              pending={setRoleCapability.isPending}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Board role capabilities</CardTitle>
            <CardDescription>What a member can do on a board they belong to.</CardDescription>
          </CardHeader>
          <CardContent>
            <MatrixTable
              columns={boardRoles}
              formatColumn={(role) => role}
              capabilities={allCapabilities.filter((cap) =>
                boardRoles.some((role) =>
                  data.boardRoleCapabilities[
                    role as keyof typeof data.boardRoleCapabilities
                  ]?.includes(cap as never),
                ),
              )}
              has={(cap, role) =>
                Boolean(
                  data.boardRoleCapabilities[
                    role as keyof typeof data.boardRoleCapabilities
                  ]?.includes(cap as never),
                )
              }
              editable={canEdit}
              onToggle={toggleBoardRole}
              pending={setBoardRoleCapability.isPending}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Never reachable from Android</CardTitle>
            <CardDescription>
              Stripped from any token issued to the mobile client, regardless of the signed-in
              user&apos;s role.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {data.androidForbiddenCapabilities.map((cap) => (
                <Badge
                  key={cap}
                  variant="outline"
                  className="border-tone-danger-border bg-tone-danger-bg text-tone-danger font-mono"
                >
                  {cap}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/**
 * A capability grid. When `editable`, each cell is a checkbox that writes through
 * `onToggle`; otherwise it falls back to the read-only tick used before this page supported
 * editing. The capability column is pinned because the grid scrolls sideways once there are
 * more than a few roles, and a tick with no visible row label says nothing.
 */
function MatrixTable({
  columns,
  formatColumn,
  capabilities,
  has,
  editable = false,
  isDisabled,
  disabledReason,
  onToggle,
  pending = false,
}: {
  columns: string[];
  formatColumn: (column: string) => string;
  capabilities: string[];
  has: (capability: string, column: string) => boolean;
  editable?: boolean;
  isDisabled?: (capability: string, column: string) => boolean;
  disabledReason?: string;
  onToggle?: (column: string, capability: string, granted: boolean) => void | Promise<void>;
  pending?: boolean;
}): JSX.Element {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="bg-card sticky left-0 z-10 min-w-[220px]">Capability</TableHead>
            {columns.map((column) => (
              <TableHead key={column} className="text-center whitespace-nowrap">
                {formatColumn(column)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {capabilities.map((capability) => (
            <TableRow key={capability}>
              <TableCell className="bg-card text-foreground sticky left-0 z-10 font-mono text-[0.8125rem]">
                {capability}
              </TableCell>
              {columns.map((column) => {
                const checked = has(capability, column);
                const disabled = Boolean(isDisabled?.(capability, column));
                if (!editable) {
                  return (
                    <TableCell key={column} className="text-center">
                      {checked && (
                        <span
                          role="img"
                          aria-label="granted"
                          className="bg-tone-success-bg text-tone-success inline-grid size-[18px] place-items-center rounded-full"
                        >
                          <CheckIcon className="size-3" />
                        </span>
                      )}
                    </TableCell>
                  );
                }
                const box = (
                  <Checkbox
                    checked={checked}
                    disabled={disabled || pending}
                    aria-label={`${capability} for ${formatColumn(column)}`}
                    onCheckedChange={(next) => onToggle?.(column, capability, next === true)}
                  />
                );
                return (
                  <TableCell key={column} className="text-center">
                    {disabled && disabledReason ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">{box}</span>
                        </TooltipTrigger>
                        <TooltipContent>{disabledReason}</TooltipContent>
                      </Tooltip>
                    ) : (
                      box
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
