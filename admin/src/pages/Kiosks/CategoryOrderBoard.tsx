import { useState } from 'react';
import { GripVerticalIcon, RotateCcwIcon } from 'lucide-react';
import {
  applyCategoryOrder,
  glyphForCategory,
  type ResolvedMenuCategoryDto,
} from '@menuboard/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { GLYPH_ICONS } from './glyphs';

interface CategoryOrderBoardProps {
  categories: ResolvedMenuCategoryDto[];
  value: string[];
  onChange: (order: string[]) => void;
}

/**
 * The order a guest meets the menu in, dragged rather than numbered.
 *
 * The Menu Master already carries a sort order, and it is the right one for a printed board and
 * for the counter's till. A self-service stand is a different reading of the same data: what a
 * queue should be shown first depends on the hour and the hall, and asking an operator to open
 * the Menu Master and renumber assignments to move sweets above rice at a kiosk would change
 * every other surface too. So this is an override held on the stand.
 *
 * Native HTML5 drag events rather than a drag library: the list is short, the interaction is
 * one axis, and the portal does not otherwise carry a dnd dependency. What it does carry is the
 * live preview beside it — a numbered list of category names is not something anybody can read
 * as "what the hall will see", which is the whole question being answered here.
 */
export function CategoryOrderBoard({
  categories,
  value,
  onChange,
}: CategoryOrderBoardProps): JSX.Element {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const ordered = applyCategoryOrder(categories, (category) => category.id, value);

  function move(fromId: string, toId: string): void {
    if (fromId === toId) return;
    const ids = ordered.map((category) => category.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0] as string);
    onChange(ids);
  }

  if (categories.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
        This menu has no categories with anything sellable in them yet.
      </p>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
      <div>
        <ul className="flex flex-col gap-1.5">
          {ordered.map((category, index) => {
            const Glyph = GLYPH_ICONS[glyphForCategory(category.name, category.nameHi)];
            const isOver = over === category.id && dragging !== category.id;

            return (
              <li
                key={category.id}
                draggable
                onDragStart={(event) => {
                  setDragging(category.id);
                  event.dataTransfer.effectAllowed = 'move';
                  // Firefox refuses to start a drag at all without payload on the transfer.
                  event.dataTransfer.setData('text/plain', category.id);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setOver(category.id);
                }}
                onDragLeave={() => setOver((current) => (current === category.id ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  const from = dragging ?? event.dataTransfer.getData('text/plain');
                  if (from !== '') move(from, category.id);
                  setDragging(null);
                  setOver(null);
                }}
                className={cn(
                  'bg-card flex cursor-grab items-center gap-3 rounded-lg border px-3 py-2 transition-[border-color,opacity,transform]',
                  dragging === category.id && 'opacity-40',
                  isOver && 'border-primary translate-y-px',
                )}
              >
                <GripVerticalIcon className="text-muted-foreground size-4 shrink-0" />
                <span className="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center rounded-md">
                  <Glyph className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{category.name}</span>
                  {category.nameHi !== null && category.nameHi !== '' && (
                    <span className="text-muted-foreground block truncate text-xs" lang="hi">
                      {category.nameHi}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {index + 1} · {category.items.length}
                </span>
              </li>
            );
          })}
        </ul>

        {value.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => onChange([])}
          >
            <RotateCcwIcon className="size-4" />
            Follow the menu’s own order
          </Button>
        )}
      </div>

      <RailPreview categories={ordered} />
    </div>
  );
}

/**
 * What the top of the kiosk will actually look like.
 *
 * Not a mockup of the whole screen — a scaled-down kiosk is unreadable and would be a second
 * copy of the kiosk's layout to keep true. This is the one strip the ordering decides: the
 * category rail, with "All" pinned first because that is where every guest starts.
 */
function RailPreview({ categories }: { categories: ResolvedMenuCategoryDto[] }): JSX.Element {
  const AllGlyph = GLYPH_ICONS.ALL;

  return (
    <aside className="bg-muted/40 rounded-lg border p-3">
      <p className="text-muted-foreground mb-2 text-xs font-medium">On the kiosk</p>
      <div className="flex flex-col gap-1.5">
        <span className="bg-primary text-primary-foreground flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium">
          <AllGlyph className="size-3.5" />
          All
        </span>
        {categories.map((category) => {
          const Glyph = GLYPH_ICONS[glyphForCategory(category.name, category.nameHi)];
          return (
            <span
              key={category.id}
              className="bg-card flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs"
            >
              <Glyph className="text-muted-foreground size-3.5 shrink-0" />
              <span className="truncate">{category.name}</span>
            </span>
          );
        })}
      </div>
      <p className="text-muted-foreground mt-2 text-[11px] leading-snug">
        Guests always arrive on “All”. The rail filters; it never hides a dish for the next
        person.
      </p>
    </aside>
  );
}
