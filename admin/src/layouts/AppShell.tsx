import { Fragment, Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ALargeSmallIcon,
  ContrastIcon,
  HomeIcon,
  LogOutIcon,
  Minimize2Icon,
  MinusIcon,
  MonitorCogIcon,
  MoonIcon,
  SearchIcon,
  ShieldIcon,
  SunIcon,
  XIcon,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PageSkeleton } from '@/components/ui/Skeletons';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useAuth } from '@/services/AuthContext';
import {
  DESKTOP_SKIN_LABEL,
  DESKTOP_SKIN_SWATCH,
  DESKTOP_SKINS,
  SKIN_LABEL,
  TEXT_SIZE_LABEL,
  useTheme,
  type DesktopSkin,
  type TextSize,
  type ThemeSkin,
} from '@/theme/ThemeProvider';
import {
  useDockedWindow,
  useWindowManager,
  WindowManagerProvider,
  type ManagedWindow,
} from '@/services/WindowManager';
import { WindowsLayer } from '@/components/WindowsLayer';
import { StatusBar } from '@/components/StatusBar';
import { CommandPalette } from './CommandPalette';
import { crumbsFor, titleFor } from './navigation';

const SKIN_ICON: Record<ThemeSkin, typeof SunIcon> = {
  light: SunIcon,
  dark: MoonIcon,
  brand: ContrastIcon,
};

/**
 * The desktop shell. There is no small-screen variant: this is a windowing environment with
 * draggable, resizable MDI children and a task bar, which has no meaning on a phone.
 */
export function AppShell(): JSX.Element {
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    document.title = `${titleFor(location.pathname)} · Canteen OS`;
  }, [location.pathname]);

  return (
    // The provider wraps the whole shell, not just the content area: a maximised window docks
    // its caption into the top bar, so the header has to be able to read the window stack.
    <WindowManagerProvider>
      <Shell onOpenPalette={() => setPaletteOpen(true)} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </WindowManagerProvider>
  );
}

function Shell({ onOpenPalette }: { onOpenPalette: () => void }): JSX.Element {
  const location = useLocation();
  const crumbs = crumbsFor(location.pathname);
  const docked = useDockedWindow();

  return (
    <div className="flex h-dvh flex-col">
      {/* Minimal chrome: home, where you are, search, appearance, identity — plus the caption
          of a maximised window, docked here so it costs no extra row. */}
      <header className="bg-background/85 sticky top-0 z-30 flex h-9 shrink-0 items-center gap-2 border-b px-2 backdrop-blur-md">
        <Tooltip>
          <TooltipTrigger asChild>
            <NavLink
              to="/"
              className="hover:bg-accent flex h-6 w-6 items-center justify-center rounded"
              aria-label="Desktop"
            >
              <HomeIcon className="size-3.5" />
            </NavLink>
          </TooltipTrigger>
          <TooltipContent>Desktop</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-3.5" />

        <Breadcrumb className="min-w-0 shrink-0">
          <BreadcrumbList className="text-xs">
            {crumbs.map((crumb, index) => (
              <Fragment key={`${crumb.label}-${index}`}>
                {index > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem className="min-w-0">
                  {crumb.to ? (
                    <BreadcrumbLink asChild>
                      <NavLink to={crumb.to} className="truncate">
                        {crumb.label}
                      </NavLink>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>

        {docked && <DockedCaptionTitle window={docked} />}

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onOpenPalette}
          aria-label="Search"
          title="Search (Ctrl/Cmd K)"
        >
          <SearchIcon />
        </Button>

        <AppearanceMenu />
        <UserMenu />

        {docked && <DockedCaptionControls window={docked} />}
      </header>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1">
          {/* Absolute so the desktop gets a definite box to fill; ordinary routes opened by
              URL still scroll inside it. */}
          <div className="absolute inset-0 overflow-auto">
            <ErrorBoundary resetKey={location.pathname}>
              <Suspense fallback={<PageSkeleton />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
          <WindowsLayer />
        </div>
        <StatusBar />
      </main>
    </div>
  );
}

/** The maximised window's identity, sitting in the parent bar where its own caption would be. */
function DockedCaptionTitle({ window: win }: { window: ManagedWindow }): JSX.Element {
  return (
    <>
      <Separator orientation="vertical" className="h-3.5" />
      <span className="flex min-w-0 items-center gap-1.5">
        {win.Icon ? (
          <span
            aria-hidden
            className="flex size-4 shrink-0 items-center justify-center rounded-[5px]"
            style={{ background: win.accent }}
          >
            <win.Icon className="size-2.5 text-white" />
          </span>
        ) : (
          win.accent && (
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: win.accent }}
            />
          )
        )}
        <span className="truncate text-xs font-semibold">{win.title}</span>
      </span>
    </>
  );
}

/** Minimise / restore / close for the maximised window, at the far right as MDI puts them. */
function DockedCaptionControls({ window: win }: { window: ManagedWindow }): JSX.Element {
  const { minimize, maximize, close } = useWindowManager();

  return (
    <>
      <Separator orientation="vertical" className="mx-0.5 h-3.5" />
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => minimize(win.id)}
        aria-label={`Minimise ${win.title}`}
        title="Minimise"
      >
        <MinusIcon />
      </Button>
      {/* Full-screen appliances have no floating size to restore to. */}
      {!win.alwaysMaximized && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => maximize(win.id)}
          aria-label={`Restore ${win.title}`}
          title="Restore down"
        >
          <Minimize2Icon />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => close(win.id)}
        aria-label={`Close ${win.title}`}
        title="Close"
        className="hover:bg-destructive/15 hover:text-destructive"
      >
        <XIcon />
      </Button>
    </>
  );
}

function AppearanceMenu(): JSX.Element {
  const { skin, setSkin, textSize, setTextSize, desktopSkin, setDesktopSkin } = useTheme();
  const Icon = SKIN_ICON[skin];

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Appearance">
              <Icon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Appearance</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-2">
          <MonitorCogIcon className="size-4" />
          Desktop skin
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={desktopSkin}
          onValueChange={(next) => setDesktopSkin(next as DesktopSkin)}
        >
          {DESKTOP_SKINS.map((option) => {
            const [surface, accent] = DESKTOP_SKIN_SWATCH[option];
            return (
              <DropdownMenuRadioItem key={option} value={option}>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="ring-foreground/15 size-3.5 shrink-0 rounded-full ring-1"
                    style={{ background: `linear-gradient(135deg, ${surface} 50%, ${accent} 50%)` }}
                  />
                  {DESKTOP_SKIN_LABEL[option]}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Window content</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={skin} onValueChange={(next) => setSkin(next as ThemeSkin)}>
          {(['light', 'dark', 'brand'] as ThemeSkin[]).map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {SKIN_LABEL[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2">
          <ALargeSmallIcon className="size-4" />
          Text size
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={textSize}
          onValueChange={(next) => setTextSize(next as TextSize)}
        >
          {(['compact', 'default', 'large'] as TextSize[]).map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {TEXT_SIZE_LABEL[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu(): JSX.Element {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const initial = (user?.name ?? '?').slice(0, 1).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="hover:bg-accent focus-visible:ring-ring flex items-center rounded p-0.5 text-left focus-visible:ring-2 focus-visible:outline-none"
        >
          <Avatar className="size-5.5 shrink-0">
            <AvatarFallback className="text-[0.625rem]">{initial}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{user?.name}</span>
          <span className="text-muted-foreground truncate text-xs font-normal">
            @{user?.username}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => navigate('/account/security')}>
            <ShieldIcon data-icon="inline-start" />
            Security
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void logout().then(() => navigate('/login', { replace: true }));
            }}
          >
            <LogOutIcon data-icon="inline-start" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
