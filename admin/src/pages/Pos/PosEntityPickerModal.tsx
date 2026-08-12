import { useMemo, useState } from 'react';
import {
  Capability,
  EntityType,
  LIMITS,
  MasterStatus,
  type EntityDto,
} from '@menuboard/shared';
import { PhoneIcon, SearchIcon, UserPlusIcon, UserRoundIcon, XIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { FieldGroup, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { useCreateEntity, useEntities, useEntityByPhone } from '../../hooks/useEntities';
import { useAuth } from '../../services/AuthContext';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';
import { cn } from '@/lib/utils';
import { formatMoney } from './posFormat';

const FORM_ID = 'pos-entity-register-form';

interface PosEntityPickerModalProps {
  open: boolean;
  onClose: () => void;
  /** `null` means "name this order by hand" — a walk-in nobody wants on the master. */
  onSelect: (entity: EntityDto | null) => void;
  allowWalkIn?: boolean;
}

/**
 * "Who is this order for?" — the counter's entity lookup.
 *
 * Two searches, because a counter asks the question two ways: a name/code search that lists
 * candidates, and a phone box that answers with exactly one person or nobody. The phone lookup
 * is separate rather than folded into the search because an exact hit is a different kind of
 * answer from a list of maybes, and burying it in ranked results makes the operator read.
 */
export function PosEntityPickerModal({
  open,
  onClose,
  onSelect,
  allowWalkIn,
}: PosEntityPickerModalProps): JSX.Element {
  const { hasCapability } = useAuth();
  const canRegister = hasCapability(Capability.ENTITY_WRITE);

  const [search, setSearch] = useState('');
  const [phone, setPhone] = useState('');
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    type: EntityType.CUSTOMER as EntityType,
    name: '',
    phone: '',
  });

  const listQuery = useMemo(
    () => ({
      search: search.trim() || undefined,
      status: MasterStatus.ACTIVE,
      page: 1,
      pageSize: 20,
    }),
    [search],
  );
  const { data: results, isFetching } = useEntities(listQuery);
  const { data: phoneMatch, isFetching: phoneSearching } = useEntityByPhone(phone);
  const create = useCreateEntity();

  const rows = results?.items ?? [];
  const phoneEntered = phone.trim().length >= 6;

  function choose(entity: EntityDto | null): void {
    onSelect(entity);
    setSearch('');
    setPhone('');
    setRegistering(false);
    setError(null);
    onClose();
  }

  async function onRegister(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const created = await create.mutateAsync({
        type: draft.type,
        name: draft.name,
        phone: draft.phone.trim() || null,
      });
      setDraft({ type: EntityType.CUSTOMER, name: '', phone: '' });
      choose(created);
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="pos-entity-picker"
      title={registering ? 'Register a new entity' : 'Who is this order for?'}
      description="Search the entity master by name or code, look someone up by phone, or register a new one."
      open={open}
      onClose={onClose}
      minWidth={480}
      minHeight={560}
      footer={
        registering ? (
          <FormModalFooter
            formId={FORM_ID}
            onCancel={() => {
              setRegistering(false);
              setError(null);
            }}
            submitting={create.isPending}
            saveLabel="Register & select"
            savingLabel="Registering…"
            disabled={draft.name.trim() === ''}
          />
        ) : (
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {registering ? (
        <form id={FORM_ID} onSubmit={onRegister}>
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <p className="text-muted-foreground text-sm">
              Just enough to raise a bill in their name. The rest of the record — GSTIN, credit
              limit, department — is edited on the Entities page later.
            </p>
            <SelectField
              label="Type"
              value={draft.type}
              onChange={(value) => setDraft({ ...draft, type: value as EntityType })}
              options={enumOptions(EntityType)}
            />
            <TextField
              label="Name"
              autoFocus
              required
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              maxLength={LIMITS.ENTITY_NAME_MAX}
            />
            <TextField
              label="Phone"
              helperText="Optional, but it is what the counter searches on tomorrow."
              value={draft.phone}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
              maxLength={LIMITS.ENTITY_PHONE_MAX}
            />
          </FieldGroup>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              autoFocus
              placeholder="Search by name or code…"
              aria-label="Search entities"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search !== '' && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label="Clear search"
                  onClick={() => setSearch('')}
                >
                  <XIcon />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>

          <div className="flex flex-col gap-2">
            <InputGroup>
              <InputGroupAddon>
                <PhoneIcon />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Exact phone number…"
                aria-label="Look up by phone"
                inputMode="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                maxLength={LIMITS.ENTITY_PHONE_MAX}
              />
              {phoneSearching && (
                <InputGroupAddon align="inline-end">
                  <Spinner />
                </InputGroupAddon>
              )}
            </InputGroup>
            {phoneEntered && !phoneSearching && (
              <div>
                {phoneMatch ? (
                  <EntityRow entity={phoneMatch} exact onSelect={choose} />
                ) : (
                  <p className="text-muted-foreground px-1 text-sm">
                    Nobody is registered on that number. Register them, or name the order by hand.
                  </p>
                )}
              </div>
            )}
          </div>

          <Separator />

          <div className="flex flex-col gap-1.5">
            {isFetching && rows.length === 0 && (
              <div className="text-muted-foreground flex items-center gap-2 px-1 py-3 text-sm">
                <Spinner />
                Searching…
              </div>
            )}
            {!isFetching && rows.length === 0 && (
              <EmptyState
                variant={search.trim() === '' ? 'empty' : 'no-results'}
                title={search.trim() === '' ? 'No active entities yet' : 'No entity matches that'}
                description={
                  search.trim() === ''
                    ? 'Register a customer, employee or vendor so orders can be raised in their name.'
                    : 'Try a shorter search, look them up by phone, or register them now.'
                }
              />
            )}
            {rows.map((entity) => (
              <EntityRow key={entity.id} entity={entity} onSelect={choose} />
            ))}
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            {allowWalkIn && (
              <Button
                type="button"
                variant="outline"
                className="touch-target justify-start"
                onClick={() => choose(null)}
              >
                <UserRoundIcon data-icon="inline-start" />
                Walk-in — type the name on the ticket, do not register
              </Button>
            )}
            {canRegister && (
              <Button
                type="button"
                variant="secondary"
                className="touch-target justify-start"
                onClick={() => {
                  setDraft((current) => ({ ...current, phone: phone.trim() }));
                  setRegistering(true);
                }}
              >
                <UserPlusIcon data-icon="inline-start" />
                Register new entity
              </Button>
            )}
            {!canRegister && (
              <p className="text-muted-foreground px-1 text-xs">
                Registering a new entity needs the Entity write capability. Name the order by hand,
                or ask a manager to add them to the master.
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function EntityRow({
  entity,
  exact,
  onSelect,
}: {
  entity: EntityDto;
  exact?: boolean;
  onSelect: (entity: EntityDto) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onSelect(entity)}
      className={cn(
        'touch-target hover:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-3',
        exact ? 'border-tone-success-border bg-tone-success-bg' : 'border-transparent',
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium">{entity.name}</span>
          <Badge variant="outline" className="shrink-0 text-[0.625rem]">
            {entity.type}
          </Badge>
          {exact && <span className="text-tone-success shrink-0 text-xs font-medium">Exact match</span>}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          <span className="font-mono">{entity.code}</span>
          {entity.phone ? ` · ${entity.phone}` : ' · no phone'}
          {entity.discountPercent > 0 ? ` · ${entity.discountPercent}% standing discount` : ''}
        </span>
      </span>
      {entity.accountBalance !== 0 && (
        <span
          className={cn(
            'shrink-0 text-xs tabular-nums',
            entity.accountBalance > 0 ? 'text-tone-danger font-medium' : 'text-muted-foreground',
          )}
        >
          {formatMoney(entity.accountBalance)}
        </span>
      )}
    </button>
  );
}
