import { ModulePage } from '@/components/ModulePage';
import { StockAdjustmentsTab } from './StockAdjustmentsTab';
import { StockCountsTab } from './StockCountsTab';
import { StockLedgerTab } from './StockLedgerTab';
import { StockOnHandTab } from './StockOnHandTab';

/**
 * What is on the shelf, how it got there, and the two documents allowed to change it without
 * a supplier behind them. One module because the four are read together: a balance that looks
 * wrong is checked against its ledger, corrected by an adjustment, and proven by a count.
 */
export function StockPage(): JSX.Element {
  return (
    <ModulePage
      moduleId="stock"
      eyebrow="Purchase"
      title="Stock & Inventory"
      subtitle="Balances by location and batch, the immutable movement history behind them, and the adjustments and counts that correct them."
      defaultTab="on-hand"
      tabs={[
        { key: 'on-hand', label: 'Stock on Hand', content: <StockOnHandTab /> },
        { key: 'ledger', label: 'Stock Ledger', content: <StockLedgerTab /> },
        { key: 'adjustments', label: 'Adjustments', content: <StockAdjustmentsTab /> },
        { key: 'counts', label: 'Stock Counts', content: <StockCountsTab /> },
      ]}
    />
  );
}
