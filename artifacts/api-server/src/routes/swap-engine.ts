import { db, extensionTokensTable, swapLookupsTable, userSwapsTable, type SwapLookup } from "@workspace/db";
import { createHash } from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { findSwaps, identifyBarcodeOnline, lookupBarcode, rememberForUser, voteOnSuggestion } from "../lib/swap-engine";

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
      if (known?.status === "ready" && known.suggestions.length) { await rememberForUser(req.dbUser.id, known.id, "barcode"); res.json(serialize(known)); return; }
      const found = known ? { name: known.productName, brand: known.brand, category: known.category, barcode: known.barcode ?? barcode, imageUrl: known.imageUrl } : (await lookupBarcode(barcode)) ?? (await identifyBarcodeOnline(barcode));
      if (!found) { res.status(404).json({ error: "I couldn't find that barcode in any product database. Type the product name and I'll find a swap." }); return; }
      product = { ...found, retailer, price: price > 0 ? price : null } as typeof product & { barcode: string };
    }
    const result = await findSwaps(product!, req.dbUser.id);
    if (!result) { res.status(503).json({ error: "You've hit today's swap search limit, or swap search is busy. Try again later." }); return; }
    if (result.status === "error") { res.status(502).json({ error: "The AI couldn't answer just now. Try again in a minute. If it keeps happening, check the Swap engine card in Settings." }); return; }
    if (result.status === "ready" && result.suggestions.length) await rememberForUser(req.dbUser.id, result.id, barcode ? "barcode" : "search");
    res.json(serialize(result));
  } catch (error) {
    req.log.error({ err: error }, "Swap search failed");
    res.status(502).json({ error: isMissingTable(error) ? TABLES_MISSING : "Swap search had a hiccup. Try again." });
  }
});

/** Only this person's swaps: from their receipts, barcode scans and searches, newest first. */
router.get("/swaps/mine", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const rows = await db.select({ lookup: swapLookupsTable, source: userSwapsTable.source, kept: userSwapsTable.kept })
    .from(userSwapsTable)
    .innerJoin(swapLookupsTable, eq(userSwapsTable.lookupId, swapLookupsTable.id))
    .where(eq(userSwapsTable.userId, req.dbUser.id))
    .orderBy(desc(userSwapsTable.createdAt))
    .limit(100);
  res.json(rows
    .filter((row) => row.lookup.status === "ready" && !row.kept)
    .map((row) => ({ ...serialize(row.lookup), source: row.source }))
    .filter((row) => row.suggestions.length));

  // Swaps saved before the real-dupe rules have no reasons or source yet: redo a few quietly, so the next visit shows them.
  const old = rows.filter((row) => row.lookup.status === "ready" && row.lookup.source !== "admin" && !refreshing.has(row.lookup.id)
    && !row.lookup.suggestions.some((item) => Array.isArray(item.traits))).slice(0, 4);
  for (const row of old) {
    refreshing.add(row.lookup.id);
    void findSwaps({ name: row.lookup.productName, brand: row.lookup.brand, category: row.lookup.category, retailer: row.lookup.retailer, price: row.lookup.typicalPrice ? Number(row.lookup.typicalPrice) : undefined, barcode: row.lookup.barcode ?? undefined, imageUrl: row.lookup.imageUrl }, req.dbUser.id)
      .catch((error) => console.error("[swap-engine] refresh", (error as Error).message));
  }
});
const refreshing = new Set<string>();

/** "I'll keep mine": hides the swap and stops suggesting it. Different from "Not a match", which says the swap itself is wrong. */
router.post("/swaps/mine/:lookupId/keep", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const kept = req.body?.kept !== false;
  const [row] = await db.update(userSwapsTable).set({ kept })
    .where(and(eq(userSwapsTable.userId, req.dbUser.id), eq(userSwapsTable.lookupId, String(req.params.lookupId)))).returning();
  if (!row) { res.status(404).json({ error: "Swap not found" }); return; }
  res.json({ ok: true, kept });
});

/** The things this person said they'll keep, so they can change their mind. */
router.get("/swaps/kept", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const rows = await db.select({ lookup: swapLookupsTable }).from(userSwapsTable)
    .innerJoin(swapLookupsTable, eq(userSwapsTable.lookupId, swapLookupsTable.id))
    .where(and(eq(userSwapsTable.userId, req.dbUser.id), eq(userSwapsTable.kept, true)))
    .orderBy(desc(userSwapsTable.createdAt)).limit(100);
  res.json(rows.map((row) => ({ id: row.lookup.id, productName: row.lookup.productName, brand: row.lookup.brand, imageUrl: row.lookup.imageUrl })));
});

/** Removes a swap from this person's list. */
router.delete("/swaps/mine/:lookupId", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  await db.delete(userSwapsTable).where(and(eq(userSwapsTable.userId, req.dbUser.id), eq(userSwapsTable.lookupId, String(req.params.lookupId))));
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
  if (!req.identityEmail || !allowed.includes(req.identityEmail.toLowerCase())) { res.status(403).json({ error: "Admin only" }); return; }
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
        body: JSON.stringify({ model: process.env.SWAP_AI_MODEL || "gpt-5.6-terra", max_completion_tokens: 2000, messages: [{ role: "user", content: "Reply with the word OK." }] }),
      });
      const answer = response.ok ? ((await response.json()) as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content?.trim() : "";
      checks.push(response.ok
        ? answer ? { name: "AI connection", ok: true, detail: "Working" } : { name: "AI connection", ok: false, detail: "The AI connected but sent back an empty answer. Tell Claude." }
        : { name: "AI connection", ok: false, detail: response.status === 401 || response.status === 403 ? "The AI integration isn't approved for this app. In Replit, approve the OpenAI (Replit managed) integration." : response.status === 402 || response.status === 429 ? "Out of AI credits or rate limited. Check your Replit credits." : `The AI service answered with an error (${response.status}).` });
    } catch {
      checks.push({ name: "AI connection", ok: false, detail: "Couldn't reach the AI service. Try again in a minute." });
    }
  }
  checks.push(process.env.SERPER_API_KEY
    ? { name: "Photos and Amazon links (Serper)", ok: true, detail: "On" }
    : { name: "Photos and Amazon links (Serper)", ok: false, detail: "Not set. Add SERPER_API_KEY in Replit Secrets for real photos, prices and exact Amazon links." });
  checks.push({ name: "Affiliate links", ok: true, detail: `Amazon tag ${process.env.AMAZON_ASSOCIATE_TAG || "margo0ba-20"}, Skimlinks on for other stores` });
  res.json({ ok: tablesOk && checks.every((check) => check.ok || check.name === "Affiliate links" || check.name.startsWith("Photos")), checks });
});

const isAdmin = (req: Request) => {
  const allowed = (process.env.SWAP_CATALOG_ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  return Boolean(req.identityEmail && allowed.includes(req.identityEmail.toLowerCase()));
};

/** Swap test bench (admin only): runs one product fresh, skipping saved answers and the daily limit, and reports how it went. */
router.post("/admin/swap-test", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  if (!isAdmin(req)) { res.status(403).json({ error: "Admin only" }); return; }
  if (!aiConfigured()) { res.status(503).json({ error: AI_OFF }); return; }
  const body = (req.body ?? {}) as { query?: unknown; fresh?: unknown };
  const raw = typeof body.query === "string" ? body.query.trim().slice(0, 200) : "";
  if (!raw) { res.status(400).json({ error: "Type a product." }); return; }
  // "$12.99" at the end of a line is the price paid; a line of only digits is a barcode.
  const priceMatch = raw.match(/\$\s*(\d+(?:\.\d{1,2})?)\s*$/);
  const query = priceMatch ? raw.slice(0, priceMatch.index).trim() : raw;
  const started = Date.now();
  try {
    let product: Parameters<typeof findSwaps>[0] = { name: query, price: priceMatch ? Number(priceMatch[1]) : null };
    if (/^\d{8,14}$/.test(query)) {
      const found = (await lookupBarcode(query)) ?? (await identifyBarcodeOnline(query));
      if (!found) { res.json({ query: raw, ms: Date.now() - started, error: "Barcode not found anywhere" }); return; }
      product = { ...found, price: product.price };
    }
    const result = await findSwaps(product, req.dbUser.id, { fresh: body.fresh !== false, skipLimit: true });
    if (!result) { res.json({ query: raw, ms: Date.now() - started, error: "No answer (busy or limit)" }); return; }
    res.json({ query: raw, ms: Date.now() - started, lookup: serialize(result), product: { name: product.name, brand: product.brand || "" } });
  } catch (error) {
    req.log.error({ err: error }, "Swap test failed");
    res.json({ query: raw, ms: Date.now() - started, error: isMissingTable(error) ? TABLES_MISSING : "Error: " + String((error as Error).message).slice(0, 160) });
  }
});

/** Recent engine results for the admin to spot-check. */
router.get("/admin/swap-lookups", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const allowed = (process.env.SWAP_CATALOG_ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!req.identityEmail || !allowed.includes(req.identityEmail.toLowerCase())) { res.status(403).json({ error: "Admin only" }); return; }
  const rows = await db.select().from(swapLookupsTable).orderBy(desc(swapLookupsTable.updatedAt)).limit(200);
  res.json(rows.map(serialize));
});

/**
 * The Chrome extension: someone clicks the Margo icon on a product page, and the extension sends what's on the page.
 * It signs in with its own token (made in Settings), never the person's Margo sign-in, and finds a swap the same way the app does.
 */
router.post("/extension/swap", async (req, res): Promise<void> => {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!bearer) { res.status(401).json({ error: "Connect the extension to your Margo account first." }); return; }
  const [token] = await db.select({ id: extensionTokensTable.id, userId: extensionTokensTable.userId }).from(extensionTokensTable).where(and(
    eq(extensionTokensTable.tokenHash, createHash("sha256").update(bearer).digest("hex")), gt(extensionTokensTable.expiresAt, new Date()),
  )).limit(1);
  if (!token) { res.status(401).json({ error: "This connection expired or was removed. Get a new code in Margo's Settings." }); return; }
  if (!aiConfigured()) { res.status(503).json({ error: AI_OFF }); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const text = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
  const name = text(body.name, 200);
  const brand = text(body.brand, 120);
  const barcode = text(body.barcode, 20).replace(/\D/g, "");
  const retailer = text(body.retailer, 80);
  const price = Number(body.price);
  if (!name && !barcode) { res.status(400).json({ error: "I couldn't read a product on this page." }); return; }
  try {
    await db.update(extensionTokensTable).set({ lastUsedAt: new Date() }).where(eq(extensionTokensTable.id, token.id));
    let product: Parameters<typeof findSwaps>[0] = { name, brand, retailer, price: price > 0 && price < 5000 ? price : null, ...(barcode.length >= 8 ? { barcode } : {}) };
    if (!name && barcode) {
      const found = (await lookupBarcode(barcode)) ?? (await identifyBarcodeOnline(barcode));
      if (!found) { res.status(404).json({ error: "I couldn't identify this product." }); return; }
      product = { ...found, retailer, price: product.price };
    }
    const result = await findSwaps(product, token.userId);
    if (!result) { res.status(503).json({ error: "You've hit today's swap search limit, or swap search is busy. Try again later." }); return; }
    if (result.status === "error") { res.status(502).json({ error: "The AI couldn't answer just now. Try again in a minute." }); return; }
    if (result.status === "ready" && result.suggestions.length) await rememberForUser(token.userId, result.id, "search");
    res.json(serialize(result));
  } catch (error) {
    req.log.error({ err: error }, "Extension swap search failed");
    res.status(502).json({ error: isMissingTable(error) ? TABLES_MISSING : "Swap search had a hiccup. Try again." });
  }
});

export default router;
