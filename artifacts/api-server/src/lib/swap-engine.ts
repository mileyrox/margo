import { db, swapLookupsTable, userSwapsTable, type EngineSuggestion, type SwapLookup } from "@workspace/db";
import { and, eq, gt, inArray, sql } from "drizzle-orm";

/**
 * Margo's swap engine.
 * 1. Identify the product (receipt line, search text, or barcode via Open Food Facts / Open Beauty Facts).
 * 2. Ask the AI for up to 3 cheaper options, preferring the same store's own brand.
 * 3. Attach a store link automatically, wrapped in an affiliate link when a network is configured.
 * 4. Cache the result by product so every later user gets it instantly.
 */

export type ProductInput = { name: string; brand?: string | null; category?: string | null; retailer?: string | null; price?: number | null; barcode?: string | null };

const CACHE_DAYS = 30;
const DAILY_NEW_LOOKUPS_PER_USER = 40;
const inflight = new Map<string, Promise<SwapLookup | null>>();

const clean = (value: string | null | undefined, max: number) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function productKey(name: string, brand?: string | null) {
  const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9.% ]+/g, " ").replace(/\s+/g, " ").trim();
  return `${norm(brand ?? "")}|${norm(name)}`.slice(0, 260);
}

/* ---------------- Barcodes (free, no key) ---------------- */

export async function lookupBarcode(barcode: string): Promise<ProductInput | null> {
  const code = barcode.replace(/\D/g, "");
  if (code.length < 8 || code.length > 14) return null;
  for (const host of ["world.openfoodfacts.org", "world.openbeautyfacts.org"]) {
    try {
      const response = await fetch(`https://${host}/api/v2/product/${code}.json?fields=product_name,brands,quantity,categories`, {
        headers: { "User-Agent": "Margo/0.1 (budgeting app)" },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) continue;
      const body = await response.json() as { status?: number; product?: { product_name?: string; brands?: string; quantity?: string; categories?: string } };
      const product = body.product;
      if (body.status !== 1 || !product?.product_name) continue;
      const size = product.quantity ? `, ${product.quantity}` : "";
      return {
        name: `${product.product_name}${size}`,
        brand: (product.brands || "").split(",")[0]?.trim() || "",
        category: (product.categories || "").split(",").pop()?.trim() || (host.includes("beauty") ? "Personal care" : "Groceries"),
        barcode: code,
      };
    } catch { /* try the next database */ }
  }
  return null;
}

/* ---------------- Links ---------------- */

const searchUrls: Array<[RegExp, (q: string) => string]> = [
  [/target/i, (q) => `https://www.target.com/s?searchTerm=${q}`],
  [/walmart/i, (q) => `https://www.walmart.com/search?q=${q}`],
  [/amazon/i, (q) => `https://www.amazon.com/s?k=${q}`],
  [/kroger/i, (q) => `https://www.kroger.com/search?query=${q}`],
  [/costco/i, (q) => `https://www.costco.com/CatalogSearch?keyword=${q}`],
  [/ulta/i, (q) => `https://www.ulta.com/search?search=${q}`],
  [/sephora/i, (q) => `https://www.sephora.com/search?keyword=${q}`],
  [/cvs/i, (q) => `https://www.cvs.com/search?searchTerm=${q}`],
  [/walgreens/i, (q) => `https://www.walgreens.com/search/results.jsp?Ntt=${q}`],
  [/old navy/i, (q) => `https://oldnavy.gap.com/browse/search.do?searchText=${q}`],
];

export function storeLink(retailer: string, productName: string, brand: string) {
  const q = encodeURIComponent(`${brand} ${productName}`.trim());
  const match = searchUrls.find(([pattern]) => pattern.test(retailer));
  let url = match ? match[1](q) : `https://www.google.com/search?tbm=shop&q=${q}`;
  if (/amazon/i.test(retailer)) {
    const tag = process.env.AMAZON_ASSOCIATE_TAG;
    return tag ? `${url}&tag=${encodeURIComponent(tag)}` : url;
  }
  // Skimlinks or Sovrn turn ordinary store links into affiliate links once approved.
  if (process.env.SKIMLINKS_PUBLISHER_ID) url = `https://go.skimresources.com/?id=${encodeURIComponent(process.env.SKIMLINKS_PUBLISHER_ID)}&url=${encodeURIComponent(url)}`;
  else if (process.env.SOVRN_API_KEY) url = `https://redirect.viglink.com?key=${encodeURIComponent(process.env.SOVRN_API_KEY)}&u=${encodeURIComponent(url)}`;
  return url;
}

/* ---------------- AI ---------------- */

const storeBrands = "Target: Up & Up, Good & Gather, Favorite Day, Everspring. Walmart: Great Value, Equate, Mainstays. Kroger: Kroger, Simple Truth, Private Selection. Costco: Kirkland Signature. Amazon: Amazon Basics, Solimo, Amazon Elements. CVS: CVS Health. Walgreens: Walgreens brand. Aldi: Aldi exclusive brands. Trader Joe's: Trader Joe's. Ulta: Ulta Beauty Collection. Sephora: Sephora Collection. Whole Foods: 365 by Whole Foods Market.";

async function askAi(product: ProductInput): Promise<{ category: string; sizeText: string; typicalPrice: number | null; suggestions: Omit<EngineSuggestion, "url" | "upVotes" | "downVotes">[] } | null> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey || !baseUrl) return null;
  const prompt = `You help a budgeting app suggest cheaper swaps for things people already buy.

Product: ${product.brand ? `${product.brand} ` : ""}${product.name}
Category: ${product.category || "unknown"}
Bought at: ${product.retailer || "unknown"}
Price paid: ${product.price ? `$${product.price.toFixed(2)}` : "unknown"}

Suggest the ONE best cheaper option that a normal shopper can buy in the US today. Return at most one suggestion.
Rules:
- Only suggest real products you are confident exist and are widely sold. If you are not confident, return fewer or none.
- Prefer, in order: the same store's own brand, then another store's own brand, then a cheaper name brand known as a dupe.
- Store brands: ${storeBrands}
- Match the type, form and size class (for example 6 rolls vs 6 rolls, 12 oz vs 10 to 14 oz).
- "matchType": "Dupe" only when key ingredients or specs closely match a well-known product. Otherwise "Cheaper option".
- "whySimilar": 2 or 3 short, specific, checkable facts (form, size, key ingredients, specs). No marketing words, no claims that it is made by the same company, no "identical".
- "differences": one short sentence with the honest trade-off, or "".
- "typicalPrice": the usual US shelf price in dollars only if you are fairly sure, otherwise null. Never guess precise prices.
- Never suggest something that is not actually cheaper.
- For medicine, supplements, baby formula and allergy-related food, only suggest store-brand equivalents with the same active ingredient and strength.

Return JSON only:
{"category": string, "sizeText": string, "typicalPrice": number|null,
 "suggestions": [{"name": string, "brand": string, "retailer": string, "matchType": "Dupe"|"Cheaper option", "sizeText": string, "typicalPrice": number|null, "whySimilar": string[], "differences": string, "confidence": "high"|"medium"|"low"}]}`;
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      max_completion_tokens: 1800,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`Swap AI request failed with ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const raw = JSON.parse(payload.choices?.[0]?.message?.content || "{}") as Record<string, unknown>;
  const price = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 && n < 5000 ? Math.round(n * 100) / 100 : null; };
  const list = Array.isArray(raw.suggestions) ? raw.suggestions as Record<string, unknown>[] : [];
  const originalPrice = product.price ?? price(raw.typicalPrice);
  return {
    category: clean(String(raw.category || product.category || ""), 80),
    sizeText: clean(String(raw.sizeText || ""), 60),
    typicalPrice: price(raw.typicalPrice),
    suggestions: list.slice(0, 1).map((item) => ({
      name: clean(String(item.name || ""), 160),
      brand: clean(String(item.brand || ""), 100),
      retailer: clean(String(item.retailer || product.retailer || ""), 80),
      matchType: (item.matchType === "Dupe" ? "Dupe" : "Cheaper option") as EngineSuggestion["matchType"],
      sizeText: clean(String(item.sizeText || ""), 60),
      typicalPrice: price(item.typicalPrice),
      whySimilar: (Array.isArray(item.whySimilar) ? item.whySimilar : []).map((line) => clean(String(line), 160)).filter(Boolean).slice(0, 3),
      differences: clean(String(item.differences || ""), 200),
      confidence: (["high", "medium", "low"].includes(String(item.confidence)) ? item.confidence : "low") as EngineSuggestion["confidence"],
    })).filter((item) => item.name && item.whySimilar.length
      && item.confidence !== "low"
      && !(originalPrice && item.typicalPrice && item.typicalPrice >= originalPrice)),
  };
}

/* ---------------- Public API ---------------- */

export async function cachedLookups(keys: string[]): Promise<SwapLookup[]> {
  if (!keys.length) return [];
  return db.select().from(swapLookupsTable).where(inArray(swapLookupsTable.productKey, Array.from(new Set(keys)).slice(0, 200)));
}

async function underDailyLimit(userId: string | null) {
  if (!userId) return true;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(swapLookupsTable)
    .where(and(eq(swapLookupsTable.createdBy, userId), gt(swapLookupsTable.createdAt, since)));
  return (row?.count ?? 0) < DAILY_NEW_LOOKUPS_PER_USER;
}

/** Returns the cached lookup for a product, creating it with the AI when needed. */
export async function findSwaps(input: ProductInput, userId: string | null): Promise<SwapLookup | null> {
  const name = clean(input.name, 200);
  if (name.length < 3) return null;
  const brand = clean(input.brand, 120);
  const key = productKey(name, brand);
  const [existing] = await db.select().from(swapLookupsTable).where(eq(swapLookupsTable.productKey, key)).limit(1);
  const fresh = existing && existing.status !== "error" && Date.now() - existing.updatedAt.getTime() < CACHE_DAYS * 86_400_000;
  if (existing && (fresh || existing.source === "admin")) return existing;
  if (inflight.has(key)) return inflight.get(key)!;
  if (!(await underDailyLimit(userId))) return existing ?? null;

  const job = (async () => {
    let status: SwapLookup["status"] = "ready";
    let result: Awaited<ReturnType<typeof askAi>> = null;
    try { result = await askAi({ ...input, name, brand }); } catch { status = "error"; }
    if (status !== "error" && !result) return existing ?? null; // AI not configured
    const suggestions: EngineSuggestion[] = (result?.suggestions ?? []).map((item) => ({
      ...item,
      // Amazon only allows prices that come from its own API, so never show a typical price for Amazon.
      typicalPrice: /amazon/i.test(item.retailer) ? null : item.typicalPrice,
      url: storeLink(item.retailer, item.name, item.brand),
      upVotes: 0,
      downVotes: 0,
    }));
    if (status === "ready" && !suggestions.length) status = "none";
    const values = {
      productKey: key, productName: name, brand,
      category: clean(result?.category || input.category, 80),
      sizeText: clean(result?.sizeText, 60),
      barcode: input.barcode ? clean(input.barcode, 40) : null,
      retailer: clean(input.retailer, 80),
      typicalPrice: input.price ? input.price.toFixed(2) : result?.typicalPrice ? result.typicalPrice.toFixed(2) : null,
      status, suggestions, source: "ai", createdBy: userId,
    };
    const [saved] = await db.insert(swapLookupsTable).values(values)
      .onConflictDoUpdate({ target: swapLookupsTable.productKey, set: { ...values, createdBy: existing?.createdBy ?? userId, updatedAt: new Date() } })
      .returning();
    return saved ?? null;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** Remembers that this person bought, scanned or searched this product. */
export async function rememberForUser(userId: string, lookupId: string, source: "receipt" | "barcode" | "search") {
  await db.insert(userSwapsTable).values({ userId, lookupId, source }).onConflictDoNothing();
}

/** Runs lookups one at a time in the background, e.g. after a receipt is saved. */
export function findSwapsInBackground(items: ProductInput[], userId: string) {
  void (async () => {
    for (const item of items.slice(0, 20)) {
      try {
        const lookup = await findSwaps(item, userId);
        if (lookup) await rememberForUser(userId, lookup.id, "receipt");
      } catch { /* keep going */ }
    }
  })();
}

export async function voteOnSuggestion(lookupId: string, index: number, vote: 1 | -1) {
  const [row] = await db.select().from(swapLookupsTable).where(eq(swapLookupsTable.id, lookupId)).limit(1);
  if (!row || !row.suggestions[index]) return null;
  const suggestions = row.suggestions.map((item, i) => i !== index ? item : vote === 1 ? { ...item, upVotes: item.upVotes + 1 } : { ...item, downVotes: item.downVotes + 1 });
  const [saved] = await db.update(swapLookupsTable).set({ suggestions }).where(eq(swapLookupsTable.id, lookupId)).returning();
  return saved ?? null;
}
