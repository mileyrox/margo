import type { ProductArtKind } from '@/components/margo/art';
import { customFetch } from '@workspace/api-client-react';

export type SwapCatalogRow = {
  id: string; groupName: string; category: string; originalBrand: string; originalProduct: string; originalRetailer: string;
  originalPrice: number | null; swapBrand: string; swapProduct: string; swapRetailer: string; swapPrice: number | null;
  originalPricePerOz: number | null; swapPricePerOz: number | null; savingsPerOzPct: number | null;
  matchType: string; similarity: number | null; confidence: string; whySimilar: string; differences: string; status: string; flags: string;
};

export async function fetchSwapCatalog(admin = false): Promise<SwapCatalogRow[]> {
  return customFetch<SwapCatalogRow[]>(admin ? '/api/admin/swap-catalog' : '/api/swap-catalog');
}

/** Picks a stand-in cut-out illustration until real background-removed product photos are wired up. */
export function artFor(text: string): ProductArtKind {
  const t = text.toLowerCase();
  if (/towel|tissue|toilet|napkin|paper/.test(t)) return 'towels';
  if (/detergent|bleach|cleaner|soap|dish|laundry|softener|jug/.test(t)) return 'jug';
  if (/soda|seltzer|sparkling|water|cans|beer|drink|juice/.test(t)) return 'case';
  if (/shampoo|conditioner|lotion|serum|foundation|wash|cream|oil|spray|mascara|skincare|beauty|hair/.test(t)) return 'bottle';
  return 'box';
}

const brandBands = ['#1E4E9E', '#E07A1F', '#7A4FA0', '#6B3E26', '#B23A48', '#2C6E8F'];
const swapBands = ['#6D712E', '#0B1F4B', '#8A6A4A', '#3A7D7B', '#5A0F1A', '#4A5578'];
const hash = (text: string) => Array.from(text).reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7);
export const bandFor = (text: string, swap = false) => (swap ? swapBands : brandBands)[hash(text) % 6];

export const rowArt = (row: SwapCatalogRow) => artFor(`${row.category} ${row.groupName} ${row.originalProduct}`);
export const rowSavings = (row: SwapCatalogRow) =>
  row.originalPrice != null && row.swapPrice != null ? Math.max(0, row.originalPrice - row.swapPrice) : null;
export const rowLabel = (row: SwapCatalogRow) => (/dupe/i.test(row.matchType) ? 'Dupe' : 'Cheaper option');
