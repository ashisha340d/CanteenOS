import { useEffect, useState } from 'react';
import {
  KioskLanguageMode,
  KioskRecommendationMode,
  KioskSkin,
  OrderPriority,
  type SettingDto,
} from '@menuboard/shared';
import { CheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpdateSetting } from '../../hooks/useAdmin';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';

/**
 * Every portal-wide setting, moved here from its own page.
 *
 * This used to be a standalone "Settings" page under Records. Nearly every key on it is either
 * about a kiosk directly (`kiosk.*`, the counter printer a USB-less stand falls back to) or
 * about the organisation those kiosks bill under — so a separate destination just meant a
 * second place to look while provisioning a stand. It lives here instead, below the stands it
 * configures.
 *
 * Keys are drawn from SETTING_DEFINITIONS (backend/src/services/SettingsService.ts). The key
 * set is closed server-side; this must not invent one that is not defined there.
 */
const GROUPS: { title: string; description: string; keys: string[] }[] = [
  {
    title: 'Orders',
    description: 'Defaults applied when an order is created.',
    keys: ['orders.default_priority', 'orders.require_acknowledgement'],
  },
  {
    title: 'Notifications & sync',
    description: 'How the mobile app is kept up to date.',
    keys: ['notifications.push_enabled', 'sync.pull_limit'],
  },
  {
    title: 'Organisation',
    description: 'Identity and housekeeping.',
    keys: ['organisation.name', 'media.orphan_sweep_hours'],
  },
  {
    title: 'Billing identity',
    description:
      'What every GST bill states about the seller. Held here rather than on each device, so a hall running several kiosks cannot end up issuing bills under two different registrations.',
    keys: ['organisation.legal_name', 'organisation.address_line', 'organisation.gstin'],
  },
  {
    title: 'Self-service kiosk',
    description:
      'How the guest-facing kiosks present themselves. Every kiosk in the hall follows this — the tablets pick the change up within a minute, with nobody walking over to reload one. Skin, language, greeting and suggestions are easier to judge above, against a live preview; the same keys are here for completeness.',
    keys: [
      'kiosk.skin',
      'kiosk.language_mode',
      'kiosk.greeting',
      'kiosk.greeting_hi',
      'kiosk.recommendations',
      'kiosk.idle_prompt_seconds',
      'kiosk.whatsapp_bill_enabled',
    ],
  },
  {
    title: 'Receipt printing',
    description:
      'The networked counter printer, and the shape of the paper it prints on. A kiosk with its own USB printer prints through that instead and ignores the host below.',
    keys: ['pos.printer_host', 'pos.printer_port', 'kiosk.receipt_columns', 'kiosk.receipt_footer'],
  },
];

/** Keys read better as a sentence than as the dotted key the server stores them under. */
const LABELS: Record<string, string> = {
  'orders.default_priority': 'Default priority',
  'orders.require_acknowledgement': 'Require acknowledgement',
  'notifications.push_enabled': 'Push notifications',
  'sync.pull_limit': 'Sync page size',
  'organisation.name': 'Organisation name',
  'media.orphan_sweep_hours': 'Orphan media sweep',
  'organisation.legal_name': 'Legal name on the bill',
  'organisation.address_line': 'Address line',
  'organisation.gstin': 'GSTIN',
  'kiosk.skin': 'Kiosk skin',
  'kiosk.language_mode': 'Kiosk language',
  'kiosk.greeting': 'Greeting',
  'kiosk.greeting_hi': 'Greeting in Hindi',
  'kiosk.recommendations': 'Suggestions before payment',
  'kiosk.idle_prompt_seconds': 'Idle prompt after',
  'kiosk.whatsapp_bill_enabled': 'Bill on WhatsApp',
  'pos.printer_host': 'Printer host',
  'pos.printer_port': 'Printer port',
  'kiosk.receipt_columns': 'Receipt width',
  'kiosk.receipt_footer': 'Receipt closing line',
};

/** Skins are named for what they evoke; the operator needs the palette, not the enum. */
const SKIN_LABELS: Record<KioskSkin, string> = {
  SANDALWOOD: 'Sandalwood — warm ivory, saffron accent',
  TULSI: 'Tulsi — cool ivory, green accent',
  KASHI: 'Kashi — low-light indigo and moonlight',
  SATTVA: 'Sattva — near-monochrome paper and graphite',
};

const LANGUAGE_LABELS: Record<KioskLanguageMode, string> = {
  EN: 'English only',
  HI: 'हिंदी only',
  BOTH: 'Both, one under the other',
};

const RECOMMENDATION_LABELS: Record<KioskRecommendationMode, string> = {
  OFF: 'Never suggest anything',
  DRINKS: 'Offer a drink only',
  SWEETS: 'Offer a sweet only',
  BOTH: 'Offer a drink, or a sweet',
};

const RECEIPT_WIDTHS: { value: number; label: string }[] = [
  { value: 32, label: '32 columns — 58 mm roll' },
  { value: 42, label: '42 columns — 76 mm roll' },
  { value: 48, label: '48 columns — 80 mm roll' },
];

export function PortalSettings({ settings }: { settings: SettingDto[] }): JSX.Element {
  const update = useUpdateSetting();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);

  useEffect(() => {
    setValues(Object.fromEntries(settings.map((setting) => [setting.key, setting.value])));
  }, [settings]);

  async function save(key: string): Promise<void> {
    try {
      await update.mutateAsync({ key, value: values[key] });
      // Confirmation lands on the row that changed, not in a corner of the screen.
      setSavedKey(key);
      window.setTimeout(() => setSavedKey((current) => (current === key ? null : current)), 2000);
    } catch (err) {
      notify.fromError(err);
    }
  }

  const byKey = new Map(settings.map((setting) => [setting.key, setting]));

  function control(key: string): JSX.Element | null {
    const value = values[key];
    switch (key) {
      case 'orders.default_priority':
        return (
          <Select
            value={typeof value === 'string' ? value : ''}
            onValueChange={(next) => setValues({ ...values, [key]: next })}
          >
            <SelectTrigger size="sm" className="w-[190px]" aria-label={LABELS[key]}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {Object.values(OrderPriority).map((priority) => (
                  <SelectItem key={priority} value={priority}>
                    {priority}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        );
      case 'kiosk.skin':
        return (
          <Select
            value={typeof value === 'string' ? value : ''}
            onValueChange={(next) => setValues({ ...values, [key]: next })}
          >
            <SelectTrigger size="sm" className="w-[320px]" aria-label={LABELS[key]}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {Object.values(KioskSkin).map((skin) => (
                  <SelectItem key={skin} value={skin}>
                    {SKIN_LABELS[skin]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        );
      case 'kiosk.language_mode':
        return (
          <Select
            value={typeof value === 'string' ? value : ''}
            onValueChange={(next) => setValues({ ...values, [key]: next })}
          >
            <SelectTrigger size="sm" className="w-[240px]" aria-label={LABELS[key]}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {Object.values(KioskLanguageMode).map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {LANGUAGE_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        );
      case 'kiosk.recommendations':
        return (
          <Select
            value={typeof value === 'string' ? value : ''}
            onValueChange={(next) => setValues({ ...values, [key]: next })}
          >
            <SelectTrigger size="sm" className="w-[240px]" aria-label={LABELS[key]}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {Object.values(KioskRecommendationMode).map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {RECOMMENDATION_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        );
      case 'kiosk.receipt_columns':
        return (
          <Select
            value={typeof value === 'number' ? String(value) : ''}
            onValueChange={(next) => setValues({ ...values, [key]: Number(next) })}
          >
            <SelectTrigger size="sm" className="w-[220px]" aria-label={LABELS[key]}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {RECEIPT_WIDTHS.map((width) => (
                  <SelectItem key={width.value} value={String(width.value)}>
                    {width.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        );
      case 'orders.require_acknowledgement':
      case 'notifications.push_enabled':
      case 'kiosk.whatsapp_bill_enabled':
        return (
          <div className="flex items-center gap-2">
            <Switch
              checked={Boolean(value)}
              onCheckedChange={(checked) => setValues({ ...values, [key]: checked })}
              aria-label={LABELS[key]}
            />
            <span className="text-muted-foreground text-sm">
              {value ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        );
      case 'sync.pull_limit':
      case 'media.orphan_sweep_hours':
      case 'kiosk.idle_prompt_seconds':
      case 'pos.printer_port':
        return (
          <Input
            type="number"
            inputMode="numeric"
            aria-label={LABELS[key]}
            className="w-[150px]"
            value={typeof value === 'number' ? value : 0}
            onWheel={(event) => (event.target as HTMLInputElement).blur()}
            onChange={(e) => setValues({ ...values, [key]: Number(e.target.value) })}
          />
        );
      case 'organisation.gstin':
        return (
          <Input
            aria-label={LABELS[key]}
            className="w-[240px] font-mono uppercase"
            maxLength={15}
            placeholder="22AAAAA0000A1Z5"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => setValues({ ...values, [key]: e.target.value.toUpperCase() })}
          />
        );
      case 'pos.printer_host':
        return (
          <Input
            aria-label={LABELS[key]}
            className="w-[240px] font-mono"
            placeholder="192.168.1.50"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => setValues({ ...values, [key]: e.target.value })}
          />
        );
      case 'kiosk.greeting_hi':
        return (
          <Input
            aria-label={LABELS[key]}
            className="w-[300px]"
            lang="hi"
            maxLength={40}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => setValues({ ...values, [key]: e.target.value })}
          />
        );
      case 'kiosk.greeting':
      case 'organisation.name':
      case 'organisation.legal_name':
      case 'organisation.address_line':
      case 'kiosk.receipt_footer':
        return (
          <Input
            aria-label={LABELS[key]}
            className="w-[300px]"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => setValues({ ...values, [key]: e.target.value })}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="flex max-w-[880px] flex-col gap-8">
      {GROUPS.map((group) => (
        <section key={group.title}>
          <h2 className="font-heading text-base font-semibold">{group.title}</h2>
          <p className="text-muted-foreground mt-0.5 mb-3 text-sm">{group.description}</p>

          <div className="bg-card overflow-hidden rounded-xl border">
            {group.keys.map((key, index) => {
              const setting = byKey.get(key);
              if (!setting) return null;
              const dirty = JSON.stringify(values[key]) !== JSON.stringify(setting.value);
              const justSaved = savedKey === key;

              return (
                <div
                  key={key}
                  className={cn(
                    'flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-4',
                    index > 0 && 'border-t',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{LABELS[key] ?? key}</p>
                    <p className="text-muted-foreground mt-0.5 text-xs">{setting.description}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    {control(key)}
                    {/* The save button only exists once there is something to save, so the
                        row is quiet until the operator has actually changed something. */}
                    <div className="flex w-[74px] justify-end">
                      {justSaved ? (
                        <span className="text-tone-success flex items-center gap-1 text-xs font-medium motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95">
                          <CheckIcon className="size-4" />
                          Saved
                        </span>
                      ) : (
                        dirty && (
                          <Button size="sm" onClick={() => save(key)} disabled={update.isPending}>
                            Save
                          </Button>
                        )
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
