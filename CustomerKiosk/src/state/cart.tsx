import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import type { PosOrderItemInput } from '@menuboard/shared';

/**
 * The cart is the only client-side state the kiosk owns, and it is deliberately display-only:
 * `unitPrice` here exists to render a number while the guest decides. What the guest actually
 * pays is resolved by `PosService` from the Menu Master when the ticket is raised, so a
 * tampered cart changes nothing about the bill.
 */
export interface CartLine {
  /** Variant id when the dish has one, otherwise the food item id. Unique per line. */
  key: string;
  foodItemId: string;
  variantId: string | null;
  name: string;
  nameHi: string | null;
  variantName: string | null;
  variantNameHi: string | null;
  unitPrice: number;
  quantity: number;
  imageUrl: string | null;
  preparationTimeMinutes: number | null;
  /** `menu_category_assignments.id` — what the drink/sweet prompt keys off. */
  categoryKey: string;
}

export type CartAction =
  | { type: 'add'; line: Omit<CartLine, 'quantity'>; quantity?: number }
  | { type: 'increment'; key: string }
  | { type: 'decrement'; key: string }
  | { type: 'remove'; key: string }
  | { type: 'clear' };

const MAX_PER_LINE = 30;

export function cartReducer(state: CartLine[], action: CartAction): CartLine[] {
  switch (action.type) {
    case 'add': {
      const quantity = action.quantity ?? 1;
      const existing = state.find((line) => line.key === action.line.key);
      if (existing !== undefined) {
        return state.map((line) =>
          line.key === action.line.key
            ? { ...line, quantity: Math.min(MAX_PER_LINE, line.quantity + quantity) }
            : line,
        );
      }
      return [...state, { ...action.line, quantity }];
    }
    case 'increment':
      return state.map((line) =>
        line.key === action.key
          ? { ...line, quantity: Math.min(MAX_PER_LINE, line.quantity + 1) }
          : line,
      );
    case 'decrement':
      return state
        .map((line) => (line.key === action.key ? { ...line, quantity: line.quantity - 1 } : line))
        .filter((line) => line.quantity > 0);
    case 'remove':
      return state.filter((line) => line.key !== action.key);
    case 'clear':
      return [];
  }
}

interface CartContextValue {
  lines: CartLine[];
  dispatch: Dispatch<CartAction>;
  count: number;
  /** Indicative only — see the note at the top of this file. */
  subtotal: number;
  quantityOf: (key: string) => number;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }): JSX.Element {
  const [lines, dispatch] = useReducer(cartReducer, []);

  const value = useMemo<CartContextValue>(() => {
    const count = lines.reduce((sum, line) => sum + line.quantity, 0);
    const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
    return {
      lines,
      dispatch,
      count,
      subtotal,
      quantityOf: (key) => lines.find((line) => line.key === key)?.quantity ?? 0,
    };
  }, [lines]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (context === null) throw new Error('useCart must be used inside CartProvider');
  return context;
}

/** The shape `POST /pos/orders` wants: what was chosen and how many. Never a price. */
export function toOrderItems(lines: CartLine[]): PosOrderItemInput[] {
  return lines.map((line, index) => ({
    menuItemId: line.foodItemId,
    variantId: line.variantId,
    quantity: line.quantity,
    sortOrder: index,
  }));
}
