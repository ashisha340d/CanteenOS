import { Fragment, Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ALargeSmallIcon,
  ChevronRightIcon,
  ContrastIcon,
  EllipsisIcon,
  LogOutIcon,
  MoonIcon,
  SearchIcon,
  ShieldIcon,
  SunIcon,
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PageSkeleton } from '@/components/ui/Skeletons';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useAuth } from '@/services/AuthContext';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';
import {
  SKIN_LABEL,
  TEXT_SIZE_LABEL,
  useTheme,
  type TextSize,
  type ThemeSkin,
} from '@/theme/ThemeProvider';
import { cn } from '@/lib/utils';
import { CommandPalette } from './CommandPalette';
import { crumbsFor, NAV_SECTIONS, titleFor, type NavItem } from './navigation';

const SKIN_ICON: Record<ThemeSkin, typeof SunIcon> = {
  light: SunIcon,
  dark: MoonIcon,
  brand: ContrastIcon,
};

/** How many destinations fit in a thumb-reachable bottom bar before "More" wins. */
const MOBILE_PRIMARY_SLOTS = 4;

export function AppShell(): JSX.Element {
  const { isMobile } = useDeviceProfile();
  const { hasCapability } = useAuth();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.capability || hasCapability(item.capability)),
  })).filter((section) => section.items.length > 0);

  // Keeps the browser tab honest about where you are — and gives the back/forward stack
  // readable entries.
  useEffect(() => {
    document.title = `${titleFor(location.pathname)} · Canteen OS`;
  }, [location.pathname]);

  return (
    <>
      {isMobile ? (
        <MobileShell sections={sections} onOpenPalette={() => setPaletteOpen(true)} />
      ) : (
        <DesktopShell sections={sections} onOpenPalette={() => setPaletteOpen(true)} />
      )}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}

interface ShellProps {
  sections: { heading?: string; items: NavItem[] }[];
  onOpenPalette: () => void;
}

/* ============================================================================ desktop */

/**
 * A spacious workspace: a collapsible sidebar that can drop to an icon rail (Ctrl/Cmd-B),
 * a sticky header carrying breadcrumbs so deep pages still say where they sit, and the
 * palette one keystroke away.
 */
function DesktopShell({ sections, onOpenPalette }: ShellProps): JSX.Element {
  const location = useLocation();
  const crumbs = crumbsFor(location.pathname);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex h-10 items-center gap-2 px-2">
            {/* The dot is the product's one piece of ornament. */}
            <span
              aria-hidden
              className="bg-primary ring-sidebar-accent size-2.5 shrink-0 rounded-full ring-4"
            />
            <span className="font-heading truncate text-[0.9375rem] font-semibold tracking-[-0.02em] group-data-[collapsible=icon]:hidden">
              Canteen OS
            </span>
          </div>
        </SidebarHeader>

        <SidebarContent>
          {sections.map((section, index) =>
            section.heading ? (
              <CollapsibleNavGroup
                key={section.heading}
                heading={section.heading}
                items={section.items}
                pathname={location.pathname}
              />
            ) : (
              <SidebarGroup key={`primary-${index}`}>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {section.items.map((item) => (
                      <SidebarMenuItem key={item.to}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActivePath(location.pathname, item.to)}
                          tooltip={item.label}
                        >
                          <NavLink to={item.to} end={item.to === '/'}>
                            <item.icon />
                            <span>{item.label}</span>
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ),
          )}
        </SidebarContent>

        <SidebarFooter>
          <UserMenu />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0">
        <header className="bg-background/85 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur-md">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 h-4" />

          <Breadcrumb className="min-w-0">
            <BreadcrumbList>
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

          <div className="flex-1" />

          <Button
            variant="outline"
            size="sm"
            onClick={onOpenPalette}
            className="text-muted-foreground hidden w-56 justify-start font-normal lg:flex"
          >
            <SearchIcon data-icon="inline-start" />
            Search…
            <kbd className="bg-muted text-muted-foreground pointer-events-none ml-auto inline-flex h-5 items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium select-none">
              <span className="text-xs">⌘</span>K
            </kbd>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenPalette}
            aria-label="Open command palette"
            className="lg:hidden"
          >
            <SearchIcon />
          </Button>

          <AppearanceMenu />
        </header>

        <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-[1440px]">
            {/* Innermost boundary wins, so a lazily-loaded page replaces only the content
                area — the sidebar and header stay where they are. The error boundary is scoped
                the same way, and resets on navigation, so a page that throws leaves the
                sidebar usable rather than blanking the window. */}
            <ErrorBoundary resetKey={location.pathname}>
              <Suspense fallback={<PageSkeleton />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function CollapsibleNavGroup({
  heading,
  items,
  pathname,
}: {
  heading: string;
  items: NavItem[];
  pathname: string;
}): JSX.Element {
  const [open, setOpen] = useState(() => items.some((item) => isActivePath(pathname, item.to)));

  useEffect(() => {
    if (items.some((item) => isActivePath(pathname, item.to))) setOpen(true);
  }, [pathname, items]);

  return (
    <SidebarGroup>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <SidebarGroupLabel className="flex w-full cursor-pointer items-center justify-between gap-2 hover:text-sidebar-foreground">
            <span>{heading}</span>
            <ChevronRightIcon
              className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
            />
          </SidebarGroupLabel>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActivePath(pathname, item.to)}
                    tooltip={item.label}
                  >
                    <NavLink to={item.to} end={item.to === '/'}>
                      <item.icon />
                      <span>{item.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
}

/* ============================================================================= mobile */

/**
 * Not a narrowed desktop. Navigation lives in a thumb-reachable bottom bar carrying the four
 * most-used destinations plus a "More" sheet for the rest; the sidebar, the breadcrumb trail
 * and the icon rail — all of which assume a pointer and horizontal room — are simply absent.
 */
function MobileShell({ sections, onOpenPalette }: ShellProps): JSX.Element {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  // Closing in the same click that navigates races the sheet's own unmount animation against
  // the route swap; letting the pathname change drive it avoids that entirely.
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  const allItems = sections.flatMap((section) => section.items);
  const primary = allItems.filter((item) => item.primary).slice(0, MOBILE_PRIMARY_SLOTS);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background/90 safe-top sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur-md">
        <span aria-hidden className="bg-primary ring-sidebar-accent size-2.5 shrink-0 rounded-full ring-4" />
        <h2 className="font-heading min-w-0 flex-1 truncate text-base font-semibold">
          {titleFor(location.pathname)}
        </h2>
        <Button variant="ghost" size="icon" onClick={onOpenPalette} aria-label="Search" className="touch-target">
          <SearchIcon />
        </Button>
        <AppearanceMenu />
      </header>

      {/* Bottom padding clears the fixed nav bar so the last row is never trapped under it. */}
      <main className="min-w-0 flex-1 px-4 pt-5 pb-24">
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>

      <nav className="bg-background/95 safe-bottom fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t backdrop-blur-md">
        {primary.map((item) => {
          const active = isActivePath(location.pathname, item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={cn(
                'touch-target flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[0.6875rem] font-medium',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <item.icon className="size-5" />
              <span className="truncate px-1">{item.label}</span>
            </NavLink>
          );
        })}

        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="touch-target text-muted-foreground flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[0.6875rem] font-medium"
        >
          <EllipsisIcon className="size-5" />
          More
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>All sections</SheetTitle>
            <SheetDescription>Everywhere you can go from here.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">
            {sections.map((section, index) => (
              <div key={section.heading ?? `primary-${index}`} className="flex flex-col gap-1">
                {section.heading && (
                  <p className="text-muted-foreground px-1 text-xs font-medium tracking-[0.06em] uppercase">
                    {section.heading}
                  </p>
                )}
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={cn(
                      'touch-target flex items-center gap-3 rounded-lg px-2 text-sm font-medium',
                      isActivePath(location.pathname, item.to)
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'active:bg-accent',
                    )}
                  >
                    <item.icon className="size-4.5 shrink-0" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}
            <Separator />
            <UserMenu />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ========================================================================= shared bits */

/** Theme skin and text size in one menu — both are "how it looks", so both live together. */
function AppearanceMenu(): JSX.Element {
  const { skin, setSkin, textSize, setTextSize } = useTheme();
  const Icon = SKIN_ICON[skin];

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Appearance">
              <Icon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Appearance</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
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

/** Identity block, anchored to the bottom the way a desktop app would. */
function UserMenu(): JSX.Element {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const initial = (user?.name ?? '?').slice(0, 1).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="hover:bg-sidebar-accent focus-visible:ring-sidebar-ring flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left focus-visible:ring-2 focus-visible:outline-none"
        >
          <Avatar className="size-7 shrink-0">
            <AvatarFallback className="text-xs">{initial}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-[0.8125rem] leading-tight font-medium">
              {user?.name ?? '—'}
            </span>
            <span className="text-muted-foreground block truncate text-[0.6875rem] leading-tight">
              {(user?.role ?? '').replace(/_/g, ' ').toLowerCase()}
            </span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
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

/** `/` must match exactly; every other route also owns its nested paths. */
function isActivePath(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}
