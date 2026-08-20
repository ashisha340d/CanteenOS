import { ModulePage } from '@/components/ModulePage';
import { PayablesTab } from './PayablesTab';
import { PaymentQueueTab } from './PaymentQueueTab';
import { VendorAgeingTab } from './VendorAgeingTab';
import { VendorLedgerTab } from './VendorLedgerTab';
import { VendorPaymentsTab } from './VendorPaymentsTab';

/**
 * What the business owes its suppliers, from the bill to the money leaving.
 *
 * One module because the five are read in one sitting: a payable is queued, the queue becomes
 * a payment, the payment lands on the ledger, and the ageing is the answer to "how bad is it".
 */
export function VendorAccountingPage(): JSX.Element {
  return (
    <ModulePage
      moduleId="vendor-accounting"
      eyebrow="Purchase"
      title="Vendor Accounting"
      subtitle="Accounts payable, the payment queue, payments made, the vendor ledger behind them and the ageing of what is still owed."
      defaultTab="payables"
      tabs={[
        { key: 'payables', label: 'Payables', content: <PayablesTab /> },
        { key: 'queue', label: 'Payment Queue', content: <PaymentQueueTab /> },
        { key: 'payments', label: 'Payments', content: <VendorPaymentsTab /> },
        { key: 'ledger', label: 'Vendor Ledger', content: <VendorLedgerTab /> },
        { key: 'ageing', label: 'Ageing', content: <VendorAgeingTab /> },
      ]}
    />
  );
}
