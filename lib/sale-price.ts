/**
 * Unit price in copper when the stack count divides the proceeds exactly.
 * A remainder would be a made-up unit price, so the sale stays unpriced.
 */
export function unitPriceFromSale(quantity: number, copper: number | null): number | null {
  if (copper == null) return null;
  if (!Number.isInteger(quantity) || quantity < 1) return null;
  if (!Number.isInteger(copper) || copper < 0) return null;
  if (copper % quantity !== 0) return null;
  return copper / quantity;
}
