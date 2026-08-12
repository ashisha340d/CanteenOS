import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useMenuItemVariants } from '../../hooks/useMenuMaster';

/**
 * Shows each variant's name and price directly in a table — e.g. "Tiny ₹30", "Large ₹100" —
 * rather than only a count. Variants belong to the Food Item Master (menu_items), so this is
 * read reference wherever it's shown outside that master; `onManage` should send the admin to
 * the Food Item Master's own edit modal, the only place they're actually editable.
 */
export function VariantSummary({
  foodItemId,
  basePrice,
  onManage,
}: {
  foodItemId: string;
  basePrice: number | null;
  onManage: () => void;
}): JSX.Element {
  const { data: variants, isLoading } = useMenuItemVariants(foodItemId);

  if (isLoading) {
    return (
      <Button variant="ghost" size="sm" onClick={onManage}>
        Loading…
      </Button>
    );
  }

  if (!variants || variants.length === 0) {
    return (
      <Button variant="ghost" size="sm" onClick={onManage}>
        {basePrice === null ? 'No variants — set price' : `Base price ₹${basePrice}`}
      </Button>
    );
  }

  return (
    <button
      type="button"
      onClick={onManage}
      className="focus-ring flex flex-wrap items-center gap-1 rounded-md text-left"
    >
      {variants.map((variant) => (
        <Badge key={variant.id} variant={variant.isDefault ? 'secondary' : 'outline'}>
          {variant.name} ₹{variant.price}
        </Badge>
      ))}
    </button>
  );
}
