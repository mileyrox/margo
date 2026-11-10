import { db, receiptsTable, swapLookupsTable, type SwapLookup } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { cachedLookups, findSwaps, lookupBarcode, productKey, voteOnSuggestion } from "../lib/swap-engine";

const router: IRouter = Router();

function requireUser(req: Request, res: Response): boolean {
  if (!req.dbUser) { res.status(401).json({ error: "Authentication required" }); return false; }
  return true;
}

function serialize(row: SwapLookup) {
  return {
    id: row.id,
    productName: row.productName,
    brand: row.brand,
    category: row.category,
    sizeText: row.sizeText,
    retailer: row.retailer,
    price: row.typicalPrice ? Number(row.typicalPrice) : null,
    imageUrl: row.imageUrl ?? null,
    status: row.status,
    // Show one swap: the best-rated one the community hasn't clearly rejected.
    suggestions: row.suggestions
      .map((item, index) => ({ ...item, imageUrl: item.imageUrl ?? null, index }))
      .filter((item) => !(item.downVotes >= 3 && item.downVotes > item.upVotes * 2))
      .sort((a, b) => (b.upVotes - b.downVotes) - (a.upVotes - a.downVotes) || a.index - b.index)
      .slice(0, 1),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.post("/swaps/find", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const body = (req.body ?? {}) as { query?: unknown; barcode?: unknown; retailer?: unknown; price?: unknown };
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 200) : "";
  const barcode = typeof body.barcode === "string" ? body.barcode.trim() : "";
  const retailer = typeof body.retailer === "string" ? body.retailer.trim().slice(0, 80) : "";
  const price = Number(body.price);
  if (!query && !barcode) { res.status(400).json({ error: "Type a product or scan a barcode." }); return; }
  try {
    let product = query ? { name: query, retailer, price: price > 0 ? price : null } : null;
    if (barcode) {
      const [known] = await db.select().from(swapLookupsTable).where(eq(swapLookupsTable.barcode, barcode.replace(/\D/g, ""))).limit(1);
      if (known) { res.json(serialize(known)); return; }
      const found = await lookupBarcode(barcode);
      if (!found) { res.status(404).json({ error: "I couldn't find that barcode yet. Try typing the product name instead." }); return; }
      product = { ...found, retailer, price: price > 0 ? price : null } as typeof product & { barcode: string };
    }
    const result = await findSwaps(product!, req.dbUser.id);
    if (!result) { res.status(503).json({ error: "Swap search is busy right now. Try again in a minute." }); return; }
    res.json(serialize(result));
  } catch (error) {
    req.log.error({ err: error }, "Swap search failed");
    res.status(502).json({ error: "Swap search had a hiccup. Try again." });
  }
});

/** Swaps for everything this user has bought on scanned receipts. */
router.get("/swaps/mine", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const receipts = await db.select({ items: receiptsTable.items }).from(receiptsTable)
    .where(eq(receiptsTable.userId, req.dbUser.id)).orderBy(desc(receiptsTable.purchasedAt)).limit(50);
  const keys = receipts.flatMap((receipt) => receipt.items.map((item) => productKey(item.productName, item.brand)));
  const rows = await cachedLookups(keys);
  res.json(rows.filter((row) => row.status === "ready").map(serialize));
});

router.post("/swaps/lookups/:id/vote", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const index = Number(req.body?.index);
  const vote = Number(req.body?.vote);
  if (!Number.isInteger(index) || (vote !== 1 && vote !== -1)) { res.status(400).json({ error: "Invalid vote" }); return; }
  const saved = await voteOnSuggestion(String(req.params.id), index, vote as 1 | -1);
  if (!saved) { res.status(404).json({ error: "Swap not found" }); return; }
  res.json(serialize(saved));
});

/** Recent engine results for the admin to spot-check. */
router.get("/admin/swap-lookups", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const allowed = (process.env.SWAP_CATALOG_ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!req.identityEmail || !allowed.includes(req.identityEmail.toLowerCase())) { res.status(403).json({ error: "Admin only" }); return; }
  const rows = await db.select().from(swapLookupsTable).orderBy(desc(swapLookupsTable.updatedAt)).limit(200);
  res.json(rows.map(serialize));
});

export default router;
