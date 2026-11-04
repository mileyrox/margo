import { db, swapCatalogTable } from "@workspace/db";
import { and, asc, eq, gt, like, ne } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();
const groups = new Set(["Groceries", "Skincare", "Haircare"]);
const csvFields = [
  "id", "group", "category", "original_brand", "original_product", "original_retailer", "original_price",
  "swap_brand", "swap_product", "swap_retailer", "swap_price", "original_price_per_oz", "swap_price_per_oz",
  "savings_per_oz_pct", "match_type", "similarity", "confidence", "why_similar", "differences", "status", "flags",
];
const mapping = {
  group: "groupName", original_brand: "originalBrand", original_product: "originalProduct",
  original_retailer: "originalRetailer", original_price: "originalPrice", swap_brand: "swapBrand",
  swap_product: "swapProduct", swap_retailer: "swapRetailer", swap_price: "swapPrice",
  original_price_per_oz: "originalPricePerOz", swap_price_per_oz: "swapPricePerOz",
  savings_per_oz_pct: "savingsPerOzPct", match_type: "matchType", why_similar: "whySimilar",
} as const;

function requireUser(req: Request, res: Response): req is Request & { user: Express.User } {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Authentication required" }); return false; }
  return true;
}
function requireAdmin(req: Request, res: Response): req is Request & { user: Express.User } {
  if (!requireUser(req, res)) return false;
  const allowed = (process.env.SWAP_CATALOG_ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!req.user.email || !allowed.includes(req.user.email.toLowerCase())) { res.status(403).json({ error: "Swap catalog admin access is not enabled for this account." }); return false; }
  return true;
}
function parseCsv(source: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift()?.map((value, index) => index === 0 ? value.replace(/^\uFEFF/, "").trim() : value.trim()) || [];
  if (!csvFields.every((field) => headers.includes(field))) throw new Error("CSV is missing one or more required catalog columns.");
  return rows.filter((values) => values.some((value) => value.trim())).map((values) => Object.fromEntries(headers.map((key, index) => [key, values[index] || ""])));
}
function numberOrNull(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/[$,]/g, "").trim());
  if (!Number.isFinite(parsed)) throw new Error("Price and score fields must be numbers or blank.");
  return parsed;
}
function priceOrNull(value: unknown): number | null {
  if (typeof value === "string" && /^\s*\$?\d+(?:\.\d+)?\s*[-–]\s*\$?\d+(?:\.\d+)?\s*$/.test(value)) return null;
  return numberOrNull(value);
}
function fromCsv(row: Record<string, string>) {
  const groupName = row.group.trim();
  const id = row.id.trim();
  if (!id || !groups.has(groupName) || !row.original_product.trim() || !row.swap_product.trim() || !row.match_type.trim() || !row.status.trim()) {
    throw new Error(`Row ${id || "(missing id)"} is missing a required value or has an unsupported group.`);
  }
  return {
    id, groupName, category: row.category.trim(), originalBrand: row.original_brand.trim(),
    originalProduct: row.original_product.trim(), originalRetailer: row.original_retailer.trim(),
    originalPrice: priceOrNull(row.original_price), swapBrand: row.swap_brand.trim(),
    swapProduct: row.swap_product.trim(), swapRetailer: row.swap_retailer.trim(),
    swapPrice: priceOrNull(row.swap_price), originalPricePerOz: numberOrNull(row.original_price_per_oz),
    swapPricePerOz: numberOrNull(row.swap_price_per_oz), savingsPerOzPct: numberOrNull(row.savings_per_oz_pct),
    matchType: row.match_type.trim(), similarity: numberOrNull(row.similarity), confidence: row.confidence.trim(),
    whySimilar: row.why_similar.trim(), differences: row.differences.trim(), status: row.status.trim(), flags: row.flags.trim(),
  };
}
function ounces(name: string): number | null {
  const match = name.match(/(\d+(?:\.\d+)?)\s*(?:fl\.?\s*)?(?:oz|ounces?)\b/i);
  if (!match) return null;
  const pack = name.match(/(\d+)\s*[- ]?(?:pack|count|ct)\b/i);
  return Number(match[1]) * (pack ? Number(pack[1]) : 1);
}
function withUnitSavings(row: typeof swapCatalogTable.$inferSelect) {
  const originalSize = ounces(row.originalProduct), swapSize = ounces(row.swapProduct);
  const canCalculate = originalSize && swapSize && row.originalPrice && row.swapPrice;
  const originalPerOz = canCalculate ? row.originalPrice! / originalSize : row.originalPricePerOz;
  const swapPerOz = canCalculate ? row.swapPrice! / swapSize : row.swapPricePerOz;
  const savingsPerOzPct = originalPerOz && swapPerOz ? ((originalPerOz - swapPerOz) / originalPerOz) * 100 : row.savingsPerOzPct;
  return { ...row, originalPricePerOz: originalPerOz, swapPricePerOz: swapPerOz, savingsPerOzPct };
}
router.get("/swap-catalog", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const rows = await db.select().from(swapCatalogTable).where(and(
    like(swapCatalogTable.status, "Ready%"),
    ne(swapCatalogTable.status, "Don't show as a dupe"),
    gt(swapCatalogTable.originalPrice, 0),
    gt(swapCatalogTable.swapPrice, 0),
  )).orderBy(asc(swapCatalogTable.groupName), asc(swapCatalogTable.category), asc(swapCatalogTable.id));
  res.json(rows.map(withUnitSavings));
});
router.get("/admin/swap-catalog", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  res.json(await db.select().from(swapCatalogTable).orderBy(asc(swapCatalogTable.groupName), asc(swapCatalogTable.id)));
});
router.post("/admin/swap-catalog/import", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  if (typeof req.body?.csv !== "string" || req.body.csv.length > 1_000_000) { res.status(400).json({ error: "Upload a CSV file smaller than 1 MB." }); return; }
  try {
    const parsed = parseCsv(req.body.csv);
    if (parsed.length > 5000) { res.status(400).json({ error: "CSV is limited to 5,000 rows." }); return; }
    const rows = parsed.map(fromCsv);
    const ids = new Set(rows.map((row) => row.id));
    if (ids.size !== rows.length) { res.status(400).json({ error: "CSV contains duplicate id values." }); return; }
    if (!rows.length) { res.status(400).json({ error: "CSV has no data rows." }); return; }
    for (const row of rows) {
      await db.insert(swapCatalogTable).values(row).onConflictDoUpdate({ target: swapCatalogTable.id, set: row });
    }
    res.json({ imported: rows.length, message: `${rows.length} rows imported or updated by id.` });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not parse CSV." });
  }
});
router.put("/admin/swap-catalog/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = String(req.params.id);
  const patch: Partial<typeof swapCatalogTable.$inferInsert> = {};
  try {
    for (const field of csvFields) {
      if (field === "id" || !Object.hasOwn(req.body || {}, field)) continue;
      const key = field in mapping ? mapping[field as keyof typeof mapping] : field === "group" ? "groupName" : field.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
      const value = req.body[field];
      const normalized = ["original_price", "swap_price", "original_price_per_oz", "swap_price_per_oz", "savings_per_oz_pct", "similarity"].includes(field)
        ? numberOrNull(value)
        : typeof value === "string" ? value.trim() : "";
      (patch as Record<string, unknown>)[key] = normalized;
    }
    if (typeof patch.groupName === "string" && !groups.has(patch.groupName)) throw new Error("Group must be Groceries, Skincare, or Haircare.");
    if (!Object.keys(patch).length) { res.status(400).json({ error: "No editable fields were provided." }); return; }
    const [updated] = await db.update(swapCatalogTable).set(patch).where(eq(swapCatalogTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Swap not found." }); return; }
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not update swap." });
  }
});
router.post("/admin/swap-catalog/:id/approve", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const [updated] = await db.update(swapCatalogTable).set({ status: "Ready (approved)" })
    .where(eq(swapCatalogTable.id, String(req.params.id))).returning();
  if (!updated) { res.status(404).json({ error: "Swap not found." }); return; }
  res.json(updated);
});

export default router;
