import { CheckCircle2, ClipboardList, ListOrdered, UtensilsCrossed } from 'lucide-react';

export type BoardTab = 'orders' | 'queue' | 'menu' | 'completed';

interface Props {
  active: BoardTab;
  onSelect: (tab: BoardTab) => void;
  openOrders: number;
  queuedItems: number;
  completedCount: number;
}

/** The board's bottom bar: one tap between the card wall, the queue, the menu file and served. */
export function BottomNav({ active, onSelect, openOrders, queuedItems, completedCount }: Props): JSX.Element {
  const tabs: { id: BoardTab; label: string; icon: JSX.Element; badge: number }[] = [
    { id: 'orders', label: 'My Orders', icon: <ClipboardList className="size-5" />, badge: openOrders },
    { id: 'queue', label: 'Queue', icon: <ListOrdered className="size-5" />, badge: queuedItems },
    { id: 'menu', label: 'Menu Items', icon: <UtensilsCrossed className="size-5" />, badge: 0 },
    { id: 'completed', label: 'Completed', icon: <CheckCircle2 className="size-5" />, badge: completedCount },
  ];

  return (
    <nav className="kds-bottomnav" aria-label="Board views">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          id={tab.id === 'completed' ? 'kds-tab-completed' : undefined}
          type="button"
          className={`kds-bottomnav__tab ${active === tab.id ? 'kds-bottomnav__tab--active' : ''}`}
          aria-pressed={active === tab.id}
          onClick={() => onSelect(tab.id)}
        >
          {tab.badge > 0 && <span className="kds-bottomnav__badge">{tab.badge}</span>}
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
