import { ModulePage } from '@/components/ModulePage';
import { InventoryLocationsTab } from './InventoryLocationsTab';
import { ProductsTab } from './ProductsTab';
import { SupplierProductsTab } from './SupplierProductsTab';
import { UomsTab } from './UomsTab';

/**
 * The reference data every purchase document is written against.
 *
 * One module rather than four nav entries, because the four are only meaningful together: a
 * product cites its units, its store and its supplier, and somebody setting one up needs the
 * other three within a tab of it.
 */
export function PurchaseMastersPage(): JSX.Element {
  return (
    <ModulePage
      moduleId="purchase-masters"
      eyebrow="Purchase"
      title="Purchase Masters"
      subtitle="Products, the units they are bought and stocked in, the locations they sit in, and who supplies them."
      defaultTab="products"
      tabs={[
        { key: 'products', label: 'Products', content: <ProductsTab /> },
        { key: 'locations', label: 'Inventory Locations', content: <InventoryLocationsTab /> },
        { key: 'uoms', label: 'Units of Measure', content: <UomsTab /> },
        { key: 'supplier-products', label: 'Supplier Products', content: <SupplierProductsTab /> },
      ]}
    />
  );
}
