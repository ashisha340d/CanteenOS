import { useState } from 'react';
import { LayoutGridIcon, LogOutIcon, SearchIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/services/AuthContext';
import { APP_GROUPS, APPS } from '@/services/appRegistry';
import { useLaunchApp } from '@/services/useLaunchApp';
import { useNavigate } from 'react-router-dom';
import './StartMenu.css';

/**
 * The OS launcher: every module, grouped by what part of the operation it belongs to, with a
 * filter for the operator who already knows the name. Not site navigation — nothing here
 * changes the route; each entry opens a window on the desktop.
 */
export function StartMenu(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const launch = useLaunchApp();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const term = query.trim().toLowerCase();
  const matches = term ? APPS.filter((app) => app.label.toLowerCase().includes(term)) : APPS;

  function run(id: string): void {
    launch(id);
    setOpen(false);
    setQuery('');
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`start-button ${open ? 'start-button--open' : ''}`}
          aria-label="Start"
        >
          <LayoutGridIcon className="start-button__glyph" />
          <span className="start-button__label">Canteen OS</span>
        </button>
      </PopoverTrigger>

      <PopoverContent side="top" align="start" sideOffset={6} className="start-menu">
        <div className="start-menu__search">
          <SearchIcon className="size-3.5 shrink-0 opacity-60" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search applications…"
            className="h-7 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) run(matches[0].id);
            }}
          />
        </div>

        <div className="start-menu__body">
          {matches.length === 0 && (
            <p className="text-muted-foreground px-2 py-6 text-center text-xs">
              No application matches “{query}”.
            </p>
          )}

          {term
            ? matches.map((app) => (
                <StartItem key={app.id} app={app} onRun={() => run(app.id)} />
              ))
            : APP_GROUPS.map((group) => {
                const items = APPS.filter((app) => app.group === group);
                if (items.length === 0) return null;
                return (
                  <div key={group} className="start-menu__group">
                    <p className="start-menu__group-label">{group}</p>
                    {items.map((app) => (
                      <StartItem key={app.id} app={app} onRun={() => run(app.id)} />
                    ))}
                  </div>
                );
              })}
        </div>

        <div className="start-menu__footer">
          <span className="min-w-0 truncate">
            <span className="font-medium">{user?.name ?? '—'}</span>
            <span className="text-muted-foreground"> · {(user?.role ?? '').replace(/_/g, ' ').toLowerCase()}</span>
          </span>
          <button
            type="button"
            className="start-menu__signout"
            onClick={() => {
              setOpen(false);
              void logout().then(() => navigate('/login', { replace: true }));
            }}
          >
            <LogOutIcon className="size-3.5" />
            Sign out
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function StartItem({
  app,
  onRun,
}: {
  app: (typeof APPS)[number];
  onRun: () => void;
}): JSX.Element {
  return (
    <button type="button" className="start-menu__item" onClick={onRun}>
      <span className="start-menu__item-icon" style={{ background: app.accent }}>
        <app.Icon className="size-3.5 text-white" />
      </span>
      <span className="truncate">{app.label}</span>
    </button>
  );
}
