import type { ThreadMessageDto } from '@menuboard/shared';
import type { Language } from '../../i18n';

/**
 * Turns a SYSTEM feed row into the one line a person reads.
 *
 * The specification requires every quantity and pax edit to appear in the thread showing the
 * previous and the updated value, so these sentences are not decorative — they *are* the edit
 * history. `system_meta` is written by `OrderService` on the server (and mirrored locally for
 * offline actions); anything missing degrades to a vaguer sentence rather than to "undefined".
 */
export function describeSystemEvent(
  message: ThreadMessageDto,
  language: Language = 'en',
): string {
  const meta = message.systemMeta ?? {};
  const hi = language === 'hi';
  const actor = str(meta.actorName) ?? str(message.authorName);
  const by = actor === undefined ? '' : hi ? ` — ${actor}` : ` — ${actor}`;

  switch (message.systemEvent) {
    case 'ORDER_UPDATED':
      return (hi ? 'ऑर्डर बदला गया' : 'Order updated') + by;

    case 'ORDER_STATUS_CHANGED': {
      const to = statusLabel(str(meta.to), language);
      const from = statusLabel(str(meta.from), language);
      if (from === undefined || to === undefined) {
        return (hi ? 'स्थिति बदली' : 'Status changed') + by;
      }
      return (hi ? `स्थिति: ${from} → ${to}` : `Status: ${from} → ${to}`) + by;
    }

    case 'ORDER_ACKNOWLEDGED':
      return (hi ? 'ऑर्डर स्वीकार किया' : 'Acknowledged the order') + by;

    case 'ORDER_PAX_CHANGED': {
      const from = num(meta.from);
      const to = num(meta.to);
      if (from === undefined || to === undefined) {
        return (hi ? 'मेहमानों की संख्या बदली' : 'Guest count changed') + by;
      }
      return (hi ? `मेहमान: ${from} → ${to}` : `Guests: ${from} → ${to}`) + by;
    }

    case 'ORDER_ITEM_QUANTITY_CHANGED': {
      const name = str(meta.itemName) ?? (hi ? 'आइटम' : 'Item');
      const from = num(meta.from);
      const to = num(meta.to);
      const unit = str(meta.unit) ?? '';
      if (from === undefined || to === undefined) {
        return (hi ? `${name} की मात्रा बदली` : `${name} quantity changed`) + by;
      }
      return `${name}: ${trim(from)}${unit} → ${trim(to)}${unit}${by}`;
    }

    case 'ORDER_ITEM_CANCELLED': {
      const name = str(meta.itemName) ?? (hi ? 'आइटम' : 'Item');
      return (hi ? `${name} रद्द किया` : `Cancelled ${name}`) + by;
    }

    case 'ORDER_ITEM_REPLACED': {
      const from = describeLine(meta.from, hi);
      const to = describeLine(meta.to, hi);
      if (from === undefined || to === undefined) {
        return (hi ? 'आइटम बदला गया' : 'Item replaced') + by;
      }
      return `${from} → ${to}${by}`;
    }

    case 'ORDER_ITEM_ADDED': {
      const name = describeLine(meta.to, hi) ?? str(meta.itemName);
      if (name === undefined) return (hi ? 'नया आइटम जोड़ा' : 'Item added') + by;
      return (hi ? `जोड़ा: ${name}` : `Added ${name}`) + by;
    }

    case 'ORDER_ITEMS_CHANGED':
      return (hi ? 'मेन्यू बदला गया' : 'Menu changed') + by;

    case 'ORDER_ASSIGNED': {
      const name = str(meta.assigneeName);
      if (meta.to === null || meta.to === undefined) {
        return (hi ? 'ज़िम्मेदारी हटाई गई' : 'Assignment cleared') + by;
      }
      if (name === undefined) return (hi ? 'ऑर्डर सौंपा गया' : 'Order assigned') + by;
      return (hi ? `${name} को सौंपा` : `Assigned to ${name}`) + by;
    }

    case 'ORDER_DONE':
      return (hi ? 'ऑर्डर पूरा हुआ' : 'Marked done') + by;

    case 'ORDER_BILLED': {
      const reference = str(meta.exportReference);
      const base = hi ? 'बिल बन गया — अब बदलाव नहीं' : 'Billed — locked for editing';
      return reference === undefined ? base + by : `${base} (${reference})${by}`;
    }

    case 'SHOPPING_LIST_GENERATED': {
      const count = num(meta.itemCount);
      if (count === undefined) return (hi ? 'खरीद सूची बनी' : 'Shopping list generated') + by;
      return (
        (hi ? `खरीद सूची बनी — ${count} सामग्री` : `Shopping list generated — ${count} ingredients`) +
        by
      );
    }

    case 'ATTACHMENT_ADDED':
      return (hi ? 'फ़ाइल जोड़ी गई' : 'Attachment added') + by;

    case 'MEMBER_JOINED': {
      const name = str(meta.userName) ?? actor;
      if (name === undefined) return hi ? 'नया सदस्य जुड़ा' : 'A member joined';
      return hi ? `${name} बोर्ड में जुड़े` : `${name} joined the board`;
    }

    // Order cards normally render this event themselves; this is the fallback for a feed row
    // whose order has not synced down yet.
    case 'ORDER_CREATED': {
      const orderNumber = str(meta.orderNumber);
      const base = hi ? 'नया ऑर्डर' : 'New order';
      return (orderNumber === undefined ? base : `${base} ${orderNumber}`) + by;
    }

    default:
      return (hi ? 'अपडेट' : 'Update') + by;
  }
}

/** `{ menuItemName, quantity, unit }` rendered as "Paneer Tikka 45 PLATE". */
function describeLine(value: unknown, hi: boolean): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const name = str(record.menuItemName) ?? str(record.itemName) ?? (hi ? 'आइटम' : 'item');
  const quantity = num(record.quantity);
  const unit = str(record.unit) ?? '';
  if (quantity === undefined) return name;
  return `${name} ${trim(quantity)}${unit === '' ? '' : ` ${unit}`}`;
}

const STATUS_LABELS: Record<string, { en: string; hi: string }> = {
  PENDING: { en: 'Pending', hi: 'लंबित' },
  ACKNOWLEDGED: { en: 'Acknowledged', hi: 'स्वीकृत' },
  PREPARATION: { en: 'Preparation', hi: 'तैयारी' },
  WORK_IN_PROGRESS: { en: 'Work in progress', hi: 'काम चालू' },
  DELIVERED: { en: 'Delivered', hi: 'पहुँचाया' },
  DONE: { en: 'Done', hi: 'पूर्ण' },
  CANCELLED: { en: 'Cancelled', hi: 'रद्द' },
};

function statusLabel(value: string | undefined, language: Language): string | undefined {
  if (value === undefined) return undefined;
  const entry = STATUS_LABELS[value];
  if (entry === undefined) return value.toLowerCase().replace(/_/g, ' ');
  return language === 'hi' ? entry.hi : entry.en;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/** Drops trailing zeros so 45.000 reads as 45 but 1.500 stays 1.5. */
function trim(value: number): string {
  return String(Number(value.toFixed(3)));
}
