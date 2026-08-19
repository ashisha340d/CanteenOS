import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MasterStatus, type MenuBoardScreenDto } from '@menuboard/shared';
import {
  CopyIcon,
  ExternalLinkIcon,
  MonitorIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatGridSkeleton } from '../../components/ui/Skeletons';
import { useDeleteMenuBoardScreen, useMenuBoardScreens } from '../../hooks/useMenuMaster';
import { menuBoardUrl } from '@/lib/menuBoardUrl';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { MenuBoardScreenModal } from './MenuBoardScreenModal';

/**
 * The Digital Menu Boards — the bilingual menu screens above the counter.
 *
 * The board used to be a separate program with its own copy of the menu in a spreadsheet, which
 * meant a price could be right at the till and wrong on the wall at the same time. It now reads
 * a published menu from Menu Master like everything else, and what is left to decide is exactly
 * what this page holds: which menu each screen shows, and how it introduces itself.
 *
 * A screen is opened by URL and needs nothing installed, so the URL is the most useful thing on
 * each card — copy it once into whatever browser the display runs.
 */
export function MenuBoardsPage(): JSX.Element {
  const navigate = useNavigate();
  const screens = useMenuBoardScreens();
  const remove = useDeleteMenuBoardScreen();
  const [composing, setComposing] = useState(false);

  if (screens.isLoading) return <StatGridSkeleton count={3} />;

  async function onDelete(screen: MenuBoardScreenDto): Promise<void> {
    if (!window.confirm(`Remove the screen “${screen.name}”? Any display still on it goes blank.`)) {
      return;
    }
    try {
      await remove.mutateAsync(screen.id);
    } catch (err) {
      notify.fromError(err);
    }
  }

  const rows = screens.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Records"
        title="Digital menu boards"
        subtitle="The menu screens above the counter. Each one shows a published menu — point it at the right one here, then open its URL on the display."
        meta={
          rows.length > 0 ? (
            <Badge variant="secondary">
              {rows.length} {rows.length === 1 ? 'screen' : 'screens'}
            </Badge>
          ) : undefined
        }
        actions={
          <Button onClick={() => setComposing(true)}>
            <PlusIcon className="size-4" />
            New screen
          </Button>
        }
      />

      <div className="flex flex-col gap-10">
        <section>
          <h2 className="font-heading text-base font-semibold">Screens</h2>
          <p className="text-muted-foreground mt-0.5 mb-3 text-sm">
            A screen needs no install and no sign-in — open its URL in any browser and leave it
            full screen. A menu edited here reaches the wall at once — screens are pushed changes
            over a live connection rather than checking for them on a timer.
          </p>

          {rows.length === 0 ? (
            <EmptyState
              icon={<MonitorIcon className="size-6" />}
              title="No menu board screen has been registered yet"
              description="Register a screen here, then open its URL on the display above the counter."
              action={{ label: 'New screen', onClick: () => setComposing(true) }}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((screen) => (
                <ScreenCard
                  key={screen.id}
                  screen={screen}
                  onEdit={() => navigate(`/menu-boards/${screen.id}`)}
                  onDelete={() => void onDelete(screen)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Only the quick-create form lives here now — editing a screen's settings, layout and
          ads is a whole page's worth of content (see MenuBoardScreenDetailPage), not a modal. */}
      <MenuBoardScreenModal
        open={composing}
        editing={null}
        onClose={() => setComposing(false)}
      />
    </>
  );
}

/**
 * One screen. As with a kiosk, the heartbeat is the point: an operator two floors from the hall
 * has no other way to tell a display that is switched off from one that is switched on and
 * showing the wrong menu.
 */
function ScreenCard({
  screen,
  onEdit,
  onDelete,
}: {
  screen: MenuBoardScreenDto;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const live = isRecent(screen.lastSeenAt);
  const inactive = screen.status !== MasterStatus.ACTIVE;
  const url = menuBoardUrl(screen.code);

  return (
    <article
      className={cn(
        'bg-card flex flex-col gap-3 rounded-xl border p-4 transition-colors',
        inactive && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{screen.name}</p>
          <p className="text-muted-foreground mt-0.5 font-mono text-xs">{screen.code}</p>
        </div>
        <span
          className={cn(
            'mt-1 inline-flex shrink-0 items-center gap-1.5 text-xs',
            live ? 'text-tone-success' : 'text-muted-foreground',
          )}
          title={
            screen.lastSeenAt === null
              ? 'No display has ever opened this screen'
              : `Last seen ${new Date(screen.lastSeenAt).toLocaleString()}`
          }
        >
          <span
            className={cn(
              'size-2 rounded-full',
              live ? 'bg-tone-success motion-safe:animate-pulse' : 'bg-muted-foreground/40',
            )}
          />
          {live ? 'Live' : screen.lastSeenAt === null ? 'Never seen' : 'Idle'}
        </span>
      </div>

      <dl className="grid gap-1 text-xs">
        <Row label="Menu">
          {screen.menuName ?? (screen.menuCode === '' ? 'POS default menu' : screen.menuCode)}
        </Row>
        <Row label="Shows as">{screen.config?.identity?.restaurantName ?? '—'}</Row>
        <Row label="Morning">
          {screen.config?.identity?.morningFrom ?? '—'} – {screen.config?.identity?.morningTo ?? '—'}
        </Row>
        <Row label="Updates">Pushed live</Row>
      </dl>

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void copyUrl(url)}
            aria-label={`Copy the URL for ${screen.name}`}
            title={url}
          >
            <CopyIcon className="size-3.5" />
            Copy URL
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${screen.name}`}>
              <ExternalLinkIcon className="size-3.5" />
            </a>
          </Button>
        </span>
        <span className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${screen.name}`}>
            <PencilIcon className="size-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} aria-label={`Remove ${screen.name}`}>
            <Trash2Icon className="size-4" />
          </Button>
        </span>
      </div>
    </article>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{children}</dd>
    </div>
  );
}

async function copyUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    notify.success('URL copied — paste it into the browser on the display');
  } catch {
    notify.error(`Could not copy. The URL is ${url}`);
  }
}

/**
 * KNOWN GAP: this was reliable when a screen re-fetched on a timer, because the heartbeat was a
 * side effect of that fetch. Screens are now pushed their changes instead, so a display that is
 * on and idle stamps itself at start-up and then only when the menu actually changes — and reads
 * "Idle" here in between, though it is working. Reporting it as off would be the worse error, so
 * the window stays as it is until liveness is taken from the board's open socket instead, which
 * is where it now belongs.
 */
function isRecent(stamp: string | null): boolean {
  if (stamp === null) return false;
  return Date.now() - Date.parse(stamp) < 3 * 60_000;
}
