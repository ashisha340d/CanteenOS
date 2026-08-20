import { CheckCircle2, ClipboardList, ListOrdered, UtensilsCrossed } from 'lucide-react';
import { useT } from '../i18n';

export type BoardTab = 'orders' | 'queue' | 'menu' | 'completed';

interface Props {
  active: BoardTab;
  onSelect: (tab: BoardTab) => void;
  openOrders: number;
  queuedItems: number;
  completedCount: number;
}

/**
 * The board's four views, as tabs inside the top bar. They lived in a bar of their own along the
 * bottom, which spent a whole strip of a wall screen on four words — the space belongs to order
 * cards. The served card still flies to the Completed tab; it simply flies upward now.
 */
export function BottomNav({ active, onSelect, openOrders, queuedItems, completedCount }: Props): JSX.Element {
  const t = useT();
  /* Orders → Queue → Completed → Menu, which is the order the shift actually moves through:
     the three service views sit together and the menu file — the one tab nobody touches during
     a rush — is parked at the end. It also puts Completed next to the cards, so the card that
     flies out lands on a tab right beside where it left. */
  const tabs: { id: BoardTab; label: string; icon: JSX.Element; badge: number }[] = [
    { id: 'orders', label: t.tabMyOrders, icon: <ClipboardList className="size-4" />, badge: openOrders },
    { id: 'queue', label: t.tabQueue, icon: <ListOrdered className="size-4" />, badge: queuedItems },
    { id: 'completed', label: t.tabCompleted, icon: <CheckCircle2 className="size-4" />, badge: completedCount },
    { id: 'menu', label: t.tabMenuItems, icon: <UtensilsCrossed className="size-4" />, badge: 0 },
  ];

  return (
    <nav className="kds-tabs" aria-label={t.serviceKds}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={tab.id === 'completed' ? 'kds-tab-completed' : undefined}
          type="button"
          className={`kds-tabs__tab ${active === tab.id ? 'kds-tabs__tab--active' : ''}`}
          aria-pressed={active === tab.id}
          onClick={() => onSelect(tab.id)}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {tab.badge > 0 && <span className="kds-tabs__badge">{tab.badge}</span>}
        </button>
      ))}
    </nav>
  );
}
