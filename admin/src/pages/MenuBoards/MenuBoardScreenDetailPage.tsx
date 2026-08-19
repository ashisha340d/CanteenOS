import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  MasterStatus,
  type MenuBoardAd,
  type MenuBoardBoardConfig,
  type MenuBoardFestivalDay,
  type MenuBoardItemDto,
} from '@menuboard/shared';
import { CopyIcon, ExternalLinkIcon, PlusIcon, SaveIcon, Trash2Icon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NumberField, SelectField, SwitchField, TextField } from '@/components/form/fields';
import { BackButton } from '../../components/BackButton';
import { PageSkeleton } from '../../components/ui/Skeletons';
import { StatusChip } from '../../components/StatusChip';
import {
  useMenuBoardScreen,
  useMenuBoardSnapshot,
  useMenus,
  useUpdateMenuBoardScreen,
} from '../../hooks/useMenuMaster';
import { menuBoardUrl } from '@/lib/menuBoardUrl';
import { notify } from '@/lib/notify';
import { BoardEditorLauncher } from './BoardEditorLauncher';

const CELEBRATION_ANIMATIONS: { value: string; label: string }[] = [
  { value: 'fireworks', label: 'Fireworks' },
  { value: 'pushpa', label: 'Flower fall' },
  { value: 'rose', label: 'Rose petals' },
  { value: 'deep', label: 'Diyas' },
  { value: 'aarti', label: 'Aarti flame' },
  { value: 'morpankh', label: 'Peacock feather' },
  { value: 'tulsi', label: 'Tulsi leaves' },
  { value: 'om', label: 'Om' },
  { value: 'shankh', label: 'Shankh' },
  { value: 'rangoli', label: 'Rangoli' },
  { value: 'gulal', label: 'Gulal' },
  { value: 'kanak', label: 'Golden shower' },
];

interface InfoDraft {
  code: string;
  name: string;
  menuCode: string;
  status: MasterStatus;
  restaurantName: string;
  restaurantNameHi: string;
  morningFrom: string;
  morningTo: string;
  langSwitchSeconds: string;
}

/**
 * Everything about one screen, on one page.
 *
 * The small modal this page replaced held six fields, which was already all it could fit —
 * the Today panel, the weather card, celebrations, the festival calendar and the ad rotation
 * lived in an on-board admin overlay that only existed while somebody stood at the wall and
 * unlocked it. Removing that overlay (the board is a read-only display now) moved all of it
 * here, which is also why this is a page and not a bigger modal: there is a whole settings
 * surface's worth of content below the screen's own identity, not a few extra rows.
 */
export function MenuBoardScreenDetailPage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const { data: screen, isLoading } = useMenuBoardScreen(id);
  const menus = useMenus({ status: MasterStatus.ACTIVE, pageSize: 100 });
  const update = useUpdateMenuBoardScreen();
  // The dishes an ad can be tagged to — the board's own snapshot, so the ids match what it
  // resolves against at render time.
  const snapshot = useMenuBoardSnapshot(screen?.code ?? '');

  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [info, setInfo] = useState<InfoDraft | null>(null);
  const [board, setBoard] = useState<MenuBoardBoardConfig | null>(null);
  const [selectedAdId, setSelectedAdId] = useState<string | null>(null);

  // Reseeds when the fetched screen changes identity, in render rather than an effect — the
  // same pattern KioskDeviceModal and MenuBoardScreenModal already use, so the first paint
  // shows the right values instead of flashing whatever the previous route left behind.
  if (screen && loadedFor !== screen.id) {
    setLoadedFor(screen.id);
    setInfo(fromScreen(screen));
    setBoard(screen.config.board ?? {});
    setSelectedAdId(null);
  }

  if (isLoading || !screen || !info || !board) return <PageSkeleton />;

  const published = (menus.data?.items ?? []).filter((m) => m.publishedAt !== null);
  const url = menuBoardUrl(screen.code);

  async function saveInfo(): Promise<void> {
    if (!info) return;
    try {
      await update.mutateAsync({
        id,
        body: {
          code: info.code,
          name: info.name,
          menuCode: info.menuCode,
          status: info.status,
          config: {
            ...screen!.config,
            identity: {
              restaurantName: info.restaurantName,
              restaurantNameHi: info.restaurantNameHi,
              morningFrom: info.morningFrom,
              morningTo: info.morningTo,
              langSwitchSeconds: Number(info.langSwitchSeconds) || 10,
            },
          },
        },
      });
      notify.success('Screen information saved.');
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function saveBoard(next?: MenuBoardBoardConfig): Promise<void> {
    const value = next ?? board;
    if (!value) return;
    try {
      await update.mutateAsync({
        id,
        body: { config: { ...screen!.config, board: value } },
      });
      if (!next) notify.success('Settings saved.');
    } catch (err) {
      notify.fromError(err);
    }
  }

  function patchBoard(patch: Partial<MenuBoardBoardConfig>): void {
    setBoard((prev) => ({ ...(prev ?? {}), ...patch }));
  }

  const ads = board.ads ?? [];

  function addAd(): void {
    const next: MenuBoardAd = {
      id: 'ad-' + Date.now().toString(36),
      on: true,
      title: 'New ad',
      hi: '',
      text: '',
      price: '',
      images: [],
      everyMin: 8,
      forSec: 10,
      x: 21,
      y: 68,
      w: 58,
      h: 24,
    };
    patchBoard({ ads: [...ads, next] });
    setSelectedAdId(next.id);
  }

  function updateAd(adId: string, patch: Partial<MenuBoardAd>): void {
    patchBoard({ ads: ads.map((a) => (a.id === adId ? { ...a, ...patch } : a)) });
  }

  function removeAd(adId: string): void {
    patchBoard({ ads: ads.filter((a) => a.id !== adId) });
    if (selectedAdId === adId) setSelectedAdId(null);
  }

  const days = board.days ?? [];
  function addDay(): void {
    patchBoard({ days: [...days, { d: '01-01', n: 'New day', h: '', a: 'pushpa' }] });
  }
  function updateDay(index: number, patch: Partial<MenuBoardFestivalDay>): void {
    patchBoard({ days: days.map((d, i) => (i === index ? { ...d, ...patch } : d)) });
  }
  function removeDay(index: number): void {
    patchBoard({ days: days.filter((_, i) => i !== index) });
  }

  const selectedAd = ads.find((a) => a.id === selectedAdId) ?? null;

  return (
    <>
      <BackButton to="/menu-boards" label="Back to menu boards" />

      {/* ── Digital Board Information ────────────────────────────────────── */}
      <section className="bg-card mb-8 rounded-xl border p-4">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-xl font-bold tracking-tight">{screen.name}</h1>
          <StatusChip status={screen.status} />
          <span
            className={
              'inline-flex items-center gap-1.5 text-xs ' +
              (isRecent(screen.lastSeenAt) ? 'text-tone-success' : 'text-muted-foreground')
            }
          >
            <span
              className={
                'size-2 rounded-full ' +
                (isRecent(screen.lastSeenAt) ? 'bg-tone-success motion-safe:animate-pulse' : 'bg-muted-foreground/40')
              }
            />
            {isRecent(screen.lastSeenAt)
              ? 'Live'
              : screen.lastSeenAt === null
                ? 'Never seen'
                : 'Idle'}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => void copyUrl(url)}>
              <CopyIcon className="size-3.5" />
              Copy URL
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLinkIcon className="size-3.5" />
                Open
              </a>
            </Button>
          </div>
        </div>
        <p className="text-muted-foreground mb-4 font-mono text-xs">{url}</p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextField
            label="Screen code"
            required
            value={info.code}
            onChange={(e) => setInfo({ ...info, code: e.target.value.toUpperCase() })}
            className="font-mono"
            maxLength={40}
          />
          <TextField
            label="Name"
            required
            value={info.name}
            onChange={(e) => setInfo({ ...info, name: e.target.value })}
            maxLength={120}
          />
          <SelectField
            label="Menu to show"
            helperText="Blank follows the POS default menu."
            value={info.menuCode}
            onChange={(next) => setInfo({ ...info, menuCode: next })}
            emptyLabel="Follow the POS default menu"
            options={published.map((m) => ({ value: m.code, label: m.name }))}
          />
          <TextField
            label="Name on the board"
            value={info.restaurantName}
            onChange={(e) => setInfo({ ...info, restaurantName: e.target.value })}
            maxLength={80}
          />
          <HindiField
            label="Name in Hindi"
            value={info.restaurantNameHi}
            english={info.restaurantName}
            items={snapshot.data?.items ?? []}
            onChange={(v) => setInfo({ ...info, restaurantNameHi: v })}
          />
          <SelectField
            label="Status"
            value={info.status}
            onChange={(next) => setInfo({ ...info, status: next as MasterStatus })}
            options={[
              { value: MasterStatus.ACTIVE, label: 'Active' },
              { value: MasterStatus.INACTIVE, label: 'Inactive' },
            ]}
          />
          <TextField
            label="Morning menu from"
            placeholder="07:00"
            className="font-mono"
            value={info.morningFrom}
            onChange={(e) => setInfo({ ...info, morningFrom: e.target.value })}
            maxLength={5}
          />
          <TextField
            label="…until"
            placeholder="11:00"
            className="font-mono"
            value={info.morningTo}
            onChange={(e) => setInfo({ ...info, morningTo: e.target.value })}
            maxLength={5}
          />
          <NumberField
            label="Language swap (seconds)"
            value={info.langSwitchSeconds}
            onChange={(e) => setInfo({ ...info, langSwitchSeconds: e.target.value })}
            maxLength={3}
          />
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={saveInfo} disabled={update.isPending}>
            <SaveIcon data-icon="inline-start" />
            Save information
          </Button>
        </div>
      </section>

      {/* ── Everything that lived in the on-board admin overlay ─────────────── */}
      <Tabs defaultValue="layout">
        <TabsList>
          <TabsTrigger value="layout">Layout &amp; Ads</TabsTrigger>
          <TabsTrigger value="weather">Today Panel &amp; Weather</TabsTrigger>
          <TabsTrigger value="celebrations">Celebrations</TabsTrigger>
          <TabsTrigger value="festivals">Festival Days</TabsTrigger>
          <TabsTrigger value="cards">Card Animations</TabsTrigger>
        </TabsList>

        <TabsContent value="layout" className="space-y-4">
          <BoardEditorLauncher screenId={id} code={screen.code} />

          <div className="flex items-center justify-between">
            <h2 className="font-heading text-base font-semibold">Ads</h2>
            <Button size="sm" variant="outline" onClick={addAd}>
              <PlusIcon data-icon="inline-start" />
              Add ad
            </Button>
          </div>
          {ads.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No ads yet — add one, then drag it into position above.
            </p>
          )}
          <div className="flex flex-col gap-3">
            {ads.map((ad) => (
              <AdEditor
                key={ad.id}
                ad={ad}
                menuItems={snapshot.data?.items ?? []}
                selected={selectedAdId === ad.id}
                onSelect={() => setSelectedAdId(ad.id)}
                onChange={(patch) => updateAd(ad.id, patch)}
                onRemove={() => removeAd(ad.id)}
              />
            ))}
          </div>
          {selectedAd === null && ads.length > 0 && (
            <p className="text-muted-foreground text-xs">
              Click a box above or a card below to select an ad.
            </p>
          )}

          <div className="flex justify-end">
            <Button onClick={() => void saveBoard()} disabled={update.isPending}>
              <SaveIcon data-icon="inline-start" />
              Save layout &amp; ads
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="weather" className="space-y-4">
          <div className="bg-card rounded-xl border p-4">
            <h2 className="font-heading mb-1 text-base font-semibold">Today panel</h2>
            <p className="text-muted-foreground mb-3 text-sm">
              The clock, weather card and festival line float together — drag the whole panel
              into position on the Layout tab. This is only what shows inside it.
            </p>
            <div className="flex flex-col gap-3">
              <SwitchField
                label="Show the Today panel"
                checked={board.panel?.on ?? true}
                onCheckedChange={(v) => patchBoard({ panel: { ...(board.panel ?? {}), on: v } })}
              />
              <SwitchField
                label="Show the weather card"
                checked={board.panel?.wx ?? true}
                onCheckedChange={(v) => patchBoard({ panel: { ...(board.panel ?? {}), wx: v } })}
              />
              <SwitchField
                label="Place the weather card separately"
                helperText="Lifts it out of the Today panel so it can be dragged to its own spot on the Layout tab. Off, it travels with the panel."
                checked={board.wx?.float ?? false}
                onCheckedChange={(v) => patchBoard({ wx: { ...(board.wx ?? {}), float: v } })}
              />
              <SwitchField
                label="Show today's festival in the panel"
                checked={board.panel?.fest ?? true}
                onCheckedChange={(v) => patchBoard({ panel: { ...(board.panel ?? {}), fest: v } })}
              />
            </div>
          </div>

          <div className="bg-card rounded-xl border p-4">
            <h2 className="font-heading mb-1 text-base font-semibold">Weather location</h2>
            <p className="text-muted-foreground mb-3 text-sm">
              Open-Meteo, no API key needed — just where this screen physically is.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <NumberField
                label="Latitude"
                value={String(board.wx?.lat ?? '')}
                onChange={(e) =>
                  patchBoard({ wx: { ...(board.wx ?? {}), lat: Number(e.target.value) } })
                }
              />
              <NumberField
                label="Longitude"
                value={String(board.wx?.lon ?? '')}
                onChange={(e) =>
                  patchBoard({ wx: { ...(board.wx ?? {}), lon: Number(e.target.value) } })
                }
              />
              <TextField
                label="Place label"
                value={board.wx?.place ?? ''}
                onChange={(e) => patchBoard({ wx: { ...(board.wx ?? {}), place: e.target.value } })}
                maxLength={60}
              />
              <SelectField
                label="Unit"
                value={board.wx?.unit ?? 'C'}
                onChange={(next) =>
                  patchBoard({ wx: { ...(board.wx ?? {}), unit: next as 'C' | 'F' } })
                }
                options={[
                  { value: 'C', label: '°C' },
                  { value: 'F', label: '°F' },
                ]}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => void saveBoard()} disabled={update.isPending}>
              <SaveIcon data-icon="inline-start" />
              Save
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="celebrations" className="space-y-4">
          <div className="bg-card rounded-xl border p-4">
            <p className="text-muted-foreground mb-3 text-sm">
              The canvas animation that plays on a festival day (see the Festival Days tab for
              which day plays which one).
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <SwitchField
                label="Celebrations on"
                checked={board.fx?.on ?? true}
                onCheckedChange={(v) => patchBoard({ fx: { ...(board.fx ?? {}), on: v } })}
              />
              <SelectField
                label="Default animation"
                value={board.fx?.anim ?? 'pushpa'}
                onChange={(next) => patchBoard({ fx: { ...(board.fx ?? {}), anim: next } })}
                options={CELEBRATION_ANIMATIONS}
              />
              <NumberField
                label="Every (minutes)"
                value={String(board.fx?.everyMin ?? 15)}
                onChange={(e) =>
                  patchBoard({ fx: { ...(board.fx ?? {}), everyMin: Number(e.target.value) } })
                }
              />
              <NumberField
                label="Show for (seconds)"
                value={String(board.fx?.forSec ?? 9)}
                onChange={(e) =>
                  patchBoard({ fx: { ...(board.fx ?? {}), forSec: Number(e.target.value) } })
                }
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void saveBoard()} disabled={update.isPending}>
              <SaveIcon data-icon="inline-start" />
              Save
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="festivals" className="space-y-4">
          <div className="bg-card rounded-xl border p-4">
            <h2 className="font-heading mb-1 text-base font-semibold">Calendar source</h2>
            <p className="text-muted-foreground mb-3 text-sm">
              A Calendarific API key, stored here for reference — importing a fresh calendar
              through this page isn't built yet, so add or edit days below by hand for now.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Calendarific API key"
                className="font-mono"
                value={board.hol?.key ?? ''}
                onChange={(e) => patchBoard({ hol: { ...(board.hol ?? {}), key: e.target.value } })}
                maxLength={200}
              />
              <TextField
                label="Country code"
                className="font-mono"
                placeholder="IN"
                value={board.hol?.country ?? 'IN'}
                onChange={(e) =>
                  patchBoard({ hol: { ...(board.hol ?? {}), country: e.target.value.toUpperCase() } })
                }
                maxLength={3}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <h2 className="font-heading text-base font-semibold">Days</h2>
            <Button size="sm" variant="outline" onClick={addDay}>
              <PlusIcon data-icon="inline-start" />
              Add day
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {days.map((day, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border p-2">
                <TextField
                  label="Date (MM-DD)"
                  className="w-24 font-mono"
                  value={day.d}
                  onChange={(e) => updateDay(i, { d: e.target.value })}
                  maxLength={10}
                />
                <TextField
                  label="Name"
                  className="w-40"
                  value={day.n}
                  onChange={(e) => updateDay(i, { n: e.target.value })}
                  maxLength={60}
                />
                <TextField
                  label="Name (Hindi)"
                  lang="hi"
                  className="w-40"
                  value={day.h ?? ''}
                  onChange={(e) => updateDay(i, { h: e.target.value })}
                  maxLength={60}
                />
                <SelectField
                  label="Animation"
                  className="w-40"
                  value={day.a ?? 'pushpa'}
                  onChange={(next) => updateDay(i, { a: next })}
                  options={CELEBRATION_ANIMATIONS}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto"
                  onClick={() => removeDay(i)}
                  aria-label={`Remove ${day.n}`}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            {days.length === 0 && (
              <p className="text-muted-foreground text-sm">No festival days configured yet.</p>
            )}
          </div>

          <div className="flex justify-end">
            <Button onClick={() => void saveBoard()} disabled={update.isPending}>
              <SaveIcon data-icon="inline-start" />
              Save
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="cards" className="space-y-4">
          <div className="bg-card rounded-xl border p-4">
            <p className="text-muted-foreground mb-3 text-sm">
              A periodic flourish across category cards — a gentle "still alive" motion, not a
              celebration.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <SwitchField
                label="Card animation on"
                checked={board.divAnim?.on ?? false}
                onCheckedChange={(v) => patchBoard({ divAnim: { ...(board.divAnim ?? {}), on: v } })}
              />
              <SelectField
                label="Style"
                value={board.divAnim?.style ?? 'slide'}
                onChange={(next) =>
                  patchBoard({ divAnim: { ...(board.divAnim ?? {}), style: next } })
                }
                options={[
                  { value: 'slide', label: 'Slide' },
                  { value: 'drawer', label: 'Drawer' },
                  { value: 'flip', label: 'Flip' },
                  { value: 'zoom', label: 'Zoom' },
                  { value: 'fade', label: 'Fade up' },
                  { value: 'swing', label: 'Swing' },
                ]}
              />
              <NumberField
                label="Every (minutes)"
                value={String(board.divAnim?.everyMin ?? 5)}
                onChange={(e) =>
                  patchBoard({ divAnim: { ...(board.divAnim ?? {}), everyMin: Number(e.target.value) } })
                }
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void saveBoard()} disabled={update.isPending}>
              <SaveIcon data-icon="inline-start" />
              Save
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}

function hindiFromMenu(text: string, items: MenuBoardItemDto[]): string {
  const q = text.trim().toLowerCase();
  if (q === '') return '';
  const exact = items.find((m) => m.name.trim().toLowerCase() === q);
  if (exact) return exact.nameHi;
  const starts = items.find((m) => m.name.trim().toLowerCase().startsWith(q));
  if (starts) return starts.nameHi;
  const cat = items.find((m) => m.category.trim().toLowerCase() === q);
  return cat ? cat.categoryHi : '';
}

function HindiField({
  label,
  value,
  english,
  items,
  onChange,
  className,
}: {
  label: string;
  value: string;
  english: string;
  items: MenuBoardItemDto[];
  onChange: (v: string) => void;
  className?: string;
}): JSX.Element {
  return (
    <div className="flex items-end gap-1.5">
      <TextField
        label={label}
        lang="hi"
        className={className ?? 'flex-1'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={80}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        title="Load Hindi from Menu Master"
        className="mb-0.5 shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          const hi = hindiFromMenu(english, items);
          if (hi === '') {
            notify.error('Menu Master has no Hindi for that text.');
            return;
          }
          onChange(hi);
        }}
      >
        🇮🇳
      </Button>
    </div>
  );
}

function AdEditor({
  ad,
  menuItems,
  selected,
  onSelect,
  onChange,
  onRemove,
}: {
  ad: MenuBoardAd;
  menuItems: MenuBoardItemDto[];
  selected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<MenuBoardAd>) => void;
  onRemove: () => void;
}): JSX.Element {
  const [imageUrl, setImageUrl] = useState('');
  const [search, setSearch] = useState('');
  const images = ad.images ?? [];
  const taggedIds = ad.items ?? [];

  const tagged = taggedIds
    .map((tid) => menuItems.find((m) => m.id === tid))
    .filter((m): m is MenuBoardItemDto => m !== undefined);
  const lead = tagged.length > 0 ? tagged[0] : undefined;

  const query = search.trim().toLowerCase();
  const matches =
    query === ''
      ? []
      : menuItems
          .filter(
            (m) =>
              !taggedIds.includes(m.id) &&
              (m.name.toLowerCase().includes(query) ||
                m.nameHi.includes(search.trim()) ||
                m.category.toLowerCase().includes(query)),
          )
          .slice(0, 8);

  function addImage(): void {
    const url = imageUrl.trim();
    if (!url) return;
    onChange({ images: [...images, url].slice(0, 6) });
    setImageUrl('');
  }
  function removeImage(i: number): void {
    onChange({ images: images.filter((_, idx) => idx !== i) });
  }
  function tagItem(itemId: string): void {
    if (taggedIds.includes(itemId) || taggedIds.length >= 8) return;
    onChange({ items: [...taggedIds, itemId] });
    setSearch('');
  }
  function untagItem(itemId: string): void {
    onChange({ items: taggedIds.filter((t) => t !== itemId) });
  }

  const stop = (e: React.SyntheticEvent): void => e.stopPropagation();

  return (
    <div
      className={
        'flex flex-col gap-2.5 rounded-lg border p-3 ' + (selected ? 'ring-primary ring-2' : '')
      }
      onClick={onSelect}
    >
      <div className="flex flex-wrap items-end gap-2">
        <SwitchField
          label="On"
          className="w-auto"
          checked={ad.on ?? true}
          onCheckedChange={(v) => onChange({ on: v })}
        />
        <TextField
          label="Title"
          className="w-40"
          placeholder={lead?.name}
          value={ad.title ?? ''}
          onChange={(e) => onChange({ title: e.target.value })}
          maxLength={80}
        />
        <HindiField
          label="Title (Hindi)"
          className="w-36"
          value={ad.hi ?? ''}
          english={ad.title ?? ''}
          items={menuItems}
          onChange={(v) => onChange({ hi: v })}
        />
        <TextField
          label="Price"
          className="w-24"
          placeholder={tagged.length === 1 ? lead?.price : undefined}
          value={ad.price ?? ''}
          onChange={(e) => onChange({ price: e.target.value })}
          maxLength={20}
        />
        <NumberField
          label="Every (min)"
          className="w-20"
          value={String(ad.everyMin ?? 8)}
          onChange={(e) => onChange({ everyMin: Number(e.target.value) })}
        />
        <NumberField
          label="For (sec)"
          className="w-20"
          value={String(ad.forSec ?? 10)}
          onChange={(e) => onChange({ forSec: Number(e.target.value) })}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          onClick={(e) => {
            stop(e);
            onRemove();
          }}
          aria-label={`Remove ${ad.title}`}
        >
          <Trash2Icon />
        </Button>
      </div>

      <TextField
        label="Text"
        value={ad.text ?? ''}
        onChange={(e) => onChange({ text: e.target.value })}
        maxLength={200}
      />

      {/* ── Tagged dishes ─────────────────────────────────────────────────────
          An ad tagged to a dish follows Menu Master: the board draws the live name and
          price, so a repricing at the till reaches the wall without anyone reopening
          this form. */}
      <div>
        <p className="mb-1 text-xs font-medium">
          Menu items
          <span className="text-muted-foreground ml-1 font-normal">
            — the board shows their live name and price
          </span>
        </p>
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {tagged.map((item) => (
            <span
              key={item.id}
              className="bg-muted inline-flex items-center gap-1.5 rounded-full py-0.5 pr-1 pl-2 text-xs"
            >
              {item.image !== '' && (
                <img src={item.image} alt="" className="-ml-1.5 size-5 rounded-full object-cover" />
              )}
              <span className="font-medium">{item.name}</span>
              <span className="text-muted-foreground tabular-nums">₹{item.price}</span>
              <button
                type="button"
                className="hover:bg-background rounded-full p-0.5"
                onClick={(e) => {
                  stop(e);
                  untagItem(item.id);
                }}
                aria-label={`Untag ${item.name}`}
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
          {taggedIds.length > tagged.length && (
            <span className="text-tone-warning text-xs">
              {taggedIds.length - tagged.length} tagged item no longer on this menu — it is
              skipped on the board
            </span>
          )}
        </div>
        <div className="relative">
          <TextField
            aria-label="Find a menu item"
            placeholder={
              taggedIds.length >= 8 ? 'Eight items is the limit' : 'Search the menu to tag a dish…'
            }
            className="w-72"
            disabled={taggedIds.length >= 8 || menuItems.length === 0}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClick={stop}
          />
          {matches.length > 0 && (
            <ul className="bg-popover absolute z-20 mt-1 w-72 overflow-hidden rounded-md border shadow-md">
              {matches.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="hover:bg-accent flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
                    onClick={(e) => {
                      stop(e);
                      tagItem(m.id);
                    }}
                  >
                    {m.image !== '' ? (
                      <img src={m.image} alt="" className="size-6 rounded object-cover" />
                    ) : (
                      <span className="bg-muted size-6 rounded" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                    <span className="text-muted-foreground shrink-0">{m.category}</span>
                    <span className="shrink-0 tabular-nums">₹{m.price}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium">
          Photos
          <span className="text-muted-foreground ml-1 font-normal">
            {images.length > 1
              ? '— crossfades between them while the ad is showing'
              : '— leave empty to use the tagged dishes’ own photos'}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {images.map((src, i) => (
            <div key={i} className="group relative">
              <img src={src} alt="" className="bg-muted size-11 rounded-md border object-cover" />
              <Button
                variant="destructive"
                size="icon-sm"
                className="absolute -top-1 -right-1 size-4 opacity-0 transition-opacity group-hover:opacity-100"
                onClick={(e) => {
                  stop(e);
                  removeImage(i);
                }}
                aria-label="Remove photo"
              >
                <Trash2Icon className="size-2.5" />
              </Button>
            </div>
          ))}
          <TextField
            aria-label="Photo URL"
            placeholder="Paste an image URL"
            className="w-56"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            onClick={stop}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={images.length >= 6 || imageUrl.trim() === ''}
            onClick={(e) => {
              stop(e);
              addImage();
            }}
          >
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

function fromScreen(screen: NonNullable<ReturnType<typeof useMenuBoardScreen>['data']>): InfoDraft {
  const identity = screen.config?.identity ?? {};
  return {
    code: screen.code,
    name: screen.name,
    menuCode: screen.menuCode,
    status: screen.status,
    restaurantName: identity.restaurantName ?? '',
    restaurantNameHi: identity.restaurantNameHi ?? '',
    morningFrom: identity.morningFrom ?? '07:00',
    morningTo: identity.morningTo ?? '11:00',
    langSwitchSeconds: String(identity.langSwitchSeconds ?? 10),
  };
}

async function copyUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    notify.success('URL copied');
  } catch {
    notify.error(`Could not copy. The URL is ${url}`);
  }
}

function isRecent(stamp: string | null): boolean {
  if (stamp === null) return false;
  return Date.now() - Date.parse(stamp) < 3 * 60_000;
}
