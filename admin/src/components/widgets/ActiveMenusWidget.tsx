import { CircleSlash2Icon, CookingPotIcon, MoonIcon } from 'lucide-react';
import { useActiveMenus } from '@/hooks/useMenuMaster';
import { WidgetMessage, WidgetSkeleton } from './widgetUi';

/**
 * Which menus the counter is actually serving from at this moment, and what opens next.
 *
 * The question this answers is "why is that dish not on the till" — nearly always because the
 * menu carrying it is outside its window. A menu is live only when it is ACTIVE, published,
 * inside its effective dates and inside a schedule window for today, and all four are
 * resolved on the server: the workstation clock is not the authority on when breakfast ends.
 */

/** Turns a minute count into the phrase a counter would actually say. */
function remaining(minutes: number): string {
  if (minutes < 1) return 'closing now';
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h left` : `${hours}h ${rest}m left`;
}

function until(minutes: number): string {
  if (minutes < 1) return 'opening now';
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `in ${hours}h` : `in ${hours}h ${rest}m`;
}

export function ActiveMenusWidget(): JSX.Element {
  const menus = useActiveMenus();

  if (menus.isPending) return <WidgetSkeleton lines={3} />;

  if (menus.isError || menus.data === undefined) {
    return (
      <WidgetMessage
        Icon={CircleSlash2Icon}
        title="Menus unavailable"
        detail="The menu schedule could not be read."
        action={{ label: 'Try again', onClick: () => void menus.refetch() }}
        tone="danger"
      />
    );
  }

  const { active, next } = menus.data;

  return (
    <div className="flex h-full flex-col gap-2">
      <p className="text-muted-foreground text-[0.625rem] font-medium tracking-wide uppercase">
        Serving now
      </p>

      {active.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-2 text-center">
          <MoonIcon className="text-muted-foreground size-5 opacity-50" aria-hidden />
          <p className="text-xs font-medium">Nothing is being served</p>
          <p className="text-muted-foreground text-[0.6875rem]">
            No published menu is inside its window.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {active.map((menu) => (
            <li key={menu.id} className="flex items-baseline gap-2">
              <span
                className="bg-tone-success-solid mt-1 size-1.5 shrink-0 rounded-full"
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium" title={menu.name}>
                  {menu.name}
                </span>
                <span className="text-muted-foreground text-[0.625rem] tabular-nums">
                  {menu.startTime === null
                    ? 'All day'
                    : `${menu.startTime}–${menu.endTime ?? ''}`}
                </span>
              </span>
              {menu.endsInMinutes !== null && (
                <span
                  className={`shrink-0 text-[0.625rem] tabular-nums ${menu.endsInMinutes <= 30 ? 'text-tone-progress font-semibold' : 'text-muted-foreground'
                    }`}
                >
                  {remaining(menu.endsInMinutes)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {next.length > 0 && (
        <>
          <p className="text-muted-foreground mt-1 border-t pt-2 text-[0.625rem] font-medium tracking-wide uppercase">
            Opens later today
          </p>
          <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto">
            {next.map((menu) => (
              <li key={menu.id} className="flex items-baseline gap-2">
                <CookingPotIcon
                  className="text-muted-foreground mt-0.5 size-3 shrink-0 opacity-60"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-[0.6875rem]" title={menu.name}>
                  {menu.name}
                </span>
                <span className="text-muted-foreground shrink-0 text-[0.625rem] tabular-nums">
                  {menu.startTime} · {until(menu.startsInMinutes)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
