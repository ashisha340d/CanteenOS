import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ALargeSmallIcon, ContrastIcon, LogOutIcon, MoonIcon, SunIcon } from 'lucide-react';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { useAuth } from '@/services/AuthContext';
import {
  SKIN_LABEL,
  TEXT_SIZE_LABEL,
  useTheme,
  type TextSize,
  type ThemeSkin,
} from '@/theme/ThemeProvider';
import { NAV_SECTIONS } from './navigation';

const SKIN_ICON = { light: SunIcon, dark: MoonIcon, brand: ContrastIcon } as const;

/**
 * Ctrl/Cmd-K palette: every destination the signed-in user may reach, plus the appearance
 * controls, without taking a hand off the keyboard. Capability filtering is the same check
 * the sidebar uses, so the palette can never route someone somewhere they'd be bounced from.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const navigate = useNavigate();
  const { hasCapability, logout } = useAuth();
  const { skin, setSkin, textSize, setTextSize } = useTheme();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  function run(action: () => void): void {
    onOpenChange(false);
    action();
  }

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.capability || hasCapability(item.capability)),
  })).filter((section) => section.items.length > 0);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Jump to a page or change how the portal looks."
    >
      {/* CommandDialog supplies only the dialog shell — the cmdk primitives below need a
          Command root of their own, or cmdk has no store to subscribe to and throws. */}
      <Command className="bg-transparent p-0">
        <CommandInput placeholder="Type a page or command…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {sections.map((section) => (
            <CommandGroup key={section.heading ?? 'go'} heading={section.heading ?? 'Go to'}>
              {section.items.map((item) => (
                <CommandItem
                  key={item.to}
                  value={`${item.label} ${item.keywords ?? ''}`}
                  onSelect={() => run(() => navigate(item.to))}
                >
                  <item.icon />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}

          <CommandSeparator />

          <CommandGroup heading="Theme">
            {(['light', 'dark', 'brand'] as ThemeSkin[]).map((option) => {
              const Icon = SKIN_ICON[option];
              return (
                <CommandItem
                  key={option}
                  value={`theme ${SKIN_LABEL[option]}`}
                  onSelect={() => run(() => setSkin(option))}
                >
                  <Icon />
                  {SKIN_LABEL[option]}
                  {skin === option && <CommandShortcut>Current</CommandShortcut>}
                </CommandItem>
              );
            })}
          </CommandGroup>

          <CommandGroup heading="Text size">
            {(['compact', 'default', 'large'] as TextSize[]).map((option) => (
              <CommandItem
                key={option}
                value={`text size ${TEXT_SIZE_LABEL[option]}`}
                onSelect={() => run(() => setTextSize(option))}
              >
                <ALargeSmallIcon />
                {TEXT_SIZE_LABEL[option]}
                {textSize === option && <CommandShortcut>Current</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Account">
            <CommandItem
              value="sign out log out"
              onSelect={() =>
                run(() => {
                  void logout().then(() => navigate('/login', { replace: true }));
                })
              }
            >
              <LogOutIcon />
              Sign out
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
