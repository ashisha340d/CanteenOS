import { useState } from 'react';
import {
  MasterStatus,
  type MenuBoardConfig,
  type MenuBoardScreenDto,
} from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import {
  useCreateMenuBoardScreen,
  useMenus,
  useUpdateMenuBoardScreen,
} from '../../hooks/useMenuMaster';
import { readError } from '../../services/errorMessage';

interface FormValues {
  code: string;
  name: string;
  menuCode: string;
  pollSeconds: string;
  status: MasterStatus;
  restaurantName: string;
  restaurantNameHi: string;
  morningFrom: string;
  morningTo: string;
  langSwitchSeconds: string;
}

const FORM_ID = 'menu-board-screen-form';

const EMPTY: FormValues = {
  code: '',
  name: '',
  menuCode: '',
  pollSeconds: '60',
  status: MasterStatus.ACTIVE,
  restaurantName: '',
  restaurantNameHi: '',
  morningFrom: '07:00',
  morningTo: '11:00',
  langSwitchSeconds: '10',
};

/**
 * One screen, on one form.
 *
 * Which menu it advertises is the field that matters and is why this page exists; the rest is
 * how the board introduces itself. Typography and the column arrangement are deliberately *not*
 * here — they are set once, live on the screen's config, and an operator choosing which menu a
 * wall shows should not have to scroll past sixteen font sizes to do it.
 */
export function MenuBoardScreenModal({
  open,
  editing,
  onClose,
}: {
  open: boolean;
  editing: MenuBoardScreenDto | null;
  onClose: () => void;
}): JSX.Element {
  const [value, setValue] = useState<FormValues>(EMPTY);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateMenuBoardScreen();
  const update = useUpdateMenuBoardScreen();
  const submitting = create.isPending || update.isPending;

  const menus = useMenus({ status: MasterStatus.ACTIVE, pageSize: 100 });

  // Reseeds when the modal is opened on a different subject, in render rather than an effect,
  // so the first paint already shows the right values — the same reasoning as KioskDeviceModal.
  const subject = editing?.id ?? 'new';
  if (open && loadedFor !== subject) {
    setLoadedFor(subject);
    setValue(editing === null ? EMPTY : fromScreen(editing));
    setError(null);
  }
  if (!open && loadedFor !== null) setLoadedFor(null);

  const published = (menus.data?.items ?? []).filter((menu) => menu.publishedAt !== null);

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    // The stored config is merged rather than replaced: it also carries the typography, the
    // column arrangement and the Today/ad settings, none of which this form shows. Sending only
    // the fields on screen would wipe everything it does not know about.
    const existing: MenuBoardConfig = editing?.config ?? {};
    const config: MenuBoardConfig = {
      ...existing,
      identity: {
        ...(existing.identity ?? {}),
        restaurantName: value.restaurantName,
        restaurantNameHi: value.restaurantNameHi,
        morningFrom: value.morningFrom,
        morningTo: value.morningTo,
        langSwitchSeconds: Number(value.langSwitchSeconds) || 10,
      },
    };

    const body = {
      code: value.code,
      name: value.name,
      menuCode: value.menuCode,
      pollSeconds: Number(value.pollSeconds) || 60,
      status: value.status,
      config,
    };

    try {
      if (editing === null) await create.mutateAsync(body);
      else await update.mutateAsync({ id: editing.id, body });
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id={FORM_ID}
      minWidth={720}
      title={editing === null ? 'New menu board screen' : `Edit screen — ${editing.name}`}
      open={open}
      onClose={onClose}
      footer={<FormModalFooter formId={FORM_ID} onCancel={onClose} submitting={submitting} />}
    >
      <form onSubmit={onSubmit} id={FORM_ID}>
        <FieldGroup>
          {error !== null && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Screen code"
              helperText="Appears in the screen’s URL. Short, so it can be typed on a TV remote."
              autoFocus
              required
              value={value.code}
              onChange={(e) => setValue({ ...value, code: e.target.value.toUpperCase() })}
              className="font-mono"
              maxLength={40}
            />
            <TextField
              label="Name"
              helperText="What you call it here — “Above the counter”"
              required
              value={value.name}
              onChange={(e) => setValue({ ...value, name: e.target.value })}
              maxLength={120}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Menu to show"
              helperText={
                published.length === 0
                  ? 'No menu has been published yet — publish one first.'
                  : 'Only published menus can be shown. Blank follows the POS default menu.'
              }
              value={value.menuCode}
              onChange={(next) => setValue({ ...value, menuCode: next })}
              emptyLabel="Follow the POS default menu"
              options={published.map((menu) => ({ value: menu.code, label: menu.name }))}
            />
            <SelectField
              label="Status"
              helperText="An inactive screen stops serving; the display shows that it is not configured."
              value={value.status}
              onChange={(next) => setValue({ ...value, status: next as MasterStatus })}
              options={[
                { value: MasterStatus.ACTIVE, label: 'Active' },
                { value: MasterStatus.INACTIVE, label: 'Inactive' },
              ]}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Name on the board"
              helperText="The house name across the top of the display."
              value={value.restaurantName}
              onChange={(e) => setValue({ ...value, restaurantName: e.target.value })}
              maxLength={80}
            />
            <TextField
              label="Name in Hindi"
              lang="hi"
              value={value.restaurantNameHi}
              onChange={(e) => setValue({ ...value, restaurantNameHi: e.target.value })}
              maxLength={80}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label="Morning menu from"
              helperText="24-hour, e.g. 07:00"
              placeholder="07:00"
              className="font-mono"
              value={value.morningFrom}
              onChange={(e) => setValue({ ...value, morningFrom: e.target.value })}
              maxLength={5}
            />
            <TextField
              label="…until"
              helperText="Between these hours the board shows only the morning shift."
              placeholder="11:00"
              className="font-mono"
              value={value.morningTo}
              onChange={(e) => setValue({ ...value, morningTo: e.target.value })}
              maxLength={5}
            />
            <TextField
              label="Language swap (seconds)"
              helperText="How long the specials ribbon holds each script."
              inputMode="numeric"
              value={value.langSwitchSeconds}
              onChange={(e) => setValue({ ...value, langSwitchSeconds: e.target.value })}
              maxLength={3}
            />
          </div>

          {/* The check-interval field that stood here is gone: a screen no longer asks the
              server whether anything changed, it is told over a live connection the moment it
              does. The interval is still on the record and the DTO — dropping the column is a
              migration for no gain — but offering it as a setting would be offering a dial that
              turns nothing. */}
        </FieldGroup>
      </form>
    </Modal>
  );
}

function fromScreen(screen: MenuBoardScreenDto): FormValues {
  const identity = screen.config?.identity ?? {};
  return {
    code: screen.code,
    name: screen.name,
    menuCode: screen.menuCode,
    pollSeconds: String(screen.pollSeconds),
    status: screen.status,
    restaurantName: identity.restaurantName ?? '',
    restaurantNameHi: identity.restaurantNameHi ?? '',
    morningFrom: identity.morningFrom ?? '07:00',
    morningTo: identity.morningTo ?? '11:00',
    langSwitchSeconds: String(identity.langSwitchSeconds ?? 10),
  };
}
