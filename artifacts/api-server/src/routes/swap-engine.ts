import { db, swapLookupsTable, userSwapsTable, type SwapLookup } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { findSwaps, lookupBarcode, rememberForUser, voteOnSuggestion } from "../lib/swap-engine";

const router: IRouter = Router();

function requireUser(req: Request, res: Response): req is Request & { user: Express.User } {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Authentication required" }); return false; }
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

const aiConfigured = () => Boolean(process.env.AI_INTEGRATIONS_OPENAI_API_KEY && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL);
const AI_OFF = "Swap search isn't switched on yet. In Replit, ask the Agent to add the OpenAI integration (Replit managed), then republish.";
const TABLES_MISSING = "The swap tables aren't set up on this database yet. Ask Replit's Agent to run `pnpm --filter @workspace/db run push` on the production database, then republish.";
const isMissingTable = (error: unknown) => String((error as { code?: string })?.code) === "42P01" || /does not exist/i.test(String((error as Error)?.message));

router.post("/swaps/find", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  if (!aiConfigured()) { res.status(503).json({ error: AI_OFF }); return; }
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
      if (known) { await rememberForUser(req.user.id, known.id, "barcode"); res.json(serialize(known)); return; }
      const found = await lookupBarcode(barcode);
      if (!found) { res.status(404).json({ error: "I couldn't find that barcode yet. Try typing the product name instead." }); return; }
      product = { ...found, retailer, price: price > 0 ? price : null } as typeof product & { barcode: string };
    }
    const result = await findSwaps(product!, req.user.id);
    if (!result) { res.status(503).json({ error: "Swap search is busy right now. Try again in a minute." }); return; }
    if (result.status === "ready" && result.suggestions.length) await rememberForUser(req.user.id, result.id, barcode ? "barcode" : "search");
    res.json(serialize(result));
  } catch (error) {
    req.log.error({ err: error }, "Swap search failed");
    res.status(502).json({ error: isMissingTable(error) ? TABLES_MISSING : "Swap search had a hiccup. Try again." });
  }
});

/** Only this person's swaps: from their receipts, barcode scans and searches, newest first. */
router.get("/swaps/mine", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const rows = await db.select({ lookup: swapLookupsTable, source: userSwapsTable.source })
    .from(userSwapsTable)
    .innerJoin(swapLookupsTable, eq(userSwapsTable.lookupId, swapLookupsTable.id))
    .where(eq(userSwapsTable.userId, req.user.id))
    .orderBy(desc(userSwapsTable.createdAt))
    .limit(100);
  res.json(rows
    .filter((row) => row.lookup.status === "ready")
    .map((row) => ({ ...serialize(row.lookup), source: row.source }))
    .filter((row) => row.suggestions.length));
});

/** Removes a swap from this person's list. */
router.delete("/swaps/mine/:lookupId", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  await db.delete(userSwapsTable).where(and(eq(userSwapsTable.userId, req.user.id), eq(userSwapsTable.lookupId, String(req.params.lookupId))));
  res.sendStatus(204);
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

/** Admin check: is each part of the swap engine working? */
router.get("/admin/swap-engine-status", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const allowed = (process.env.SWAP_CATALOG_ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!req.user.email || !allowed.includes(req.user.email.toLowerCase())) { res.status(403).json({ error: "Admin only" }); return; }
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  let tablesOk = true;
  try {
    const [lookups] = await db.select({ count: sql<number>`count(*)::int` }).from(swapLookupsTable);
    const [mine] = await db.select({ count: sql<number>`count(*)::int` }).from(userSwapsTable);
    checks.push({ name: "Database tables", ok: true, detail: `${lookups?.count ?? 0} products looked up, ${mine?.count ?? 0} saved to people's lists` });
  } catch (error) {
    tablesOk = false;
    checks.push({ name: "Database tables", ok: false, detail: isMissingTable(error) ? TABLES_MISSING : "Couldn't read the swap tables." });
  }
  if (!aiConfigured()) {
    checks.push({ name: "AI connection", ok: false, detail: AI_OFF });
  } else {
    try {
      const response = await fetch(`${process.env.AI_INTEGRATIONS_OPENAI_BASE_URL!.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.AI_INTEGRATIONS_OPENAI_API_KEY}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({ model: "gpt-5.6-terra", max_completion_tokens: 20, messages: [{ role: "user", content: "Reply with OK." }] }),
      });
      checks.push(response.ok
        ? { name: "AI connection", ok: true, detail: "Working" }
        : { name: "AI connection", ok: false, detail: response.status === 401 || response.status === 403 ? "The AI integration isn't approved for this app. In Replit, approve the OpenAI (Replit managed) integration." : response.status === 402 || response.status === 429 ? "Out of AI credits or rate limited. Check your Replit credits." : `The AI service answered with an error (${response.status}).` });
    } catch {
      checks.push({ name: "AI connection", ok: false, detail: "Couldn't reach the AI service. Try again in a minute." });
    }
  }
  const links = process.env.SKIMLINKS_PUBLISHER_ID ? "Skimlinks" : process.env.SOVRN_API_KEY ? "Sovrn" : "";
  checks.push({ name: "Affiliate links", ok: Boolean(links || process.env.AMAZON_ASSOCIATE_TAG), detail: [links && `${links} on`, process.env.AMAZON_ASSOCIATE_TAG ? "Amazon tag on" : ""].filter(Boolean).join(", ") || "Not set yet. Links still work, they just don't earn commission." });
  res.json({ ok: tablesOk && checks.every((check) => check.ok || check.name === "Affiliate links"), checks });
});

/** Recent engine results for the admin to spot-check. */
router.get("/admin/swap-lookups", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const allowed = (process.env.SWAP_CATALOG_ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!req.user.email || !allowed.includes(req.user.email.toLowerCase())) { res.status(403).json({ error: "Admin only" }); return; }
  const rows = await db.select().from(swapLookupsTable).orderBy(desc(swapLookupsTable.updatedAt)).limit(200);
  res.json(rows.map(serialize));
});

export default router;
