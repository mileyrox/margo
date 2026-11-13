import { db, swapLookupsTable, userSwapsTable, type EngineSuggestion, type SwapLookup } from "@workspace/db";
import { and, eq, gt, inArray, sql } from "drizzle-orm";

/**
 * Margo's swap engine.
 * 1. Identify the product (receipt line, search text, or barcode via Open Food Facts / Open Beauty Facts).
 * 2. Ask the AI for up to 3 cheaper options, preferring the same store's own brand.
 * 3. Attach a store link automatically, wrapped in an affiliate link when a network is configured.
 * 4. Cache the result by product so every later user gets it instantly.
 */

export type ProductInput = { name: string; brand?: string | null; category?: string | null; retailer?: string | null; price?: number | null; barcode?: string | null; imageUrl?: string | null };

const CACHE_DAYS = 30;
const DAILY_NEW_LOOKUPS_PER_USER = 40;
const inflight = new Map<string, Promise<SwapLookup | null>>();

const clean = (value: string | null | undefined, max: number) => (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function productKey(name: string, brand?: string | null) {
  const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9.% ]+/g, " ").replace(/\s+/g, " ").trim();
  return `${norm(brand ?? "")}|${norm(name)}`.slice(0, 260);
}

/* ---------------- Barcodes (free, no key) ---------------- */

const httpsImage = (value: unknown): string | null => typeof value === "string" && /^https:\/\/[^\s"']+$/.test(value) ? value.slice(0, 500) : null;

/** Finds a product photo in the open product databases by name. Best effort: returns null when there's no clear match. */
export async function findProductImage(name: string, brand: string): Promise<string | null> {
  const terms = `${brand} ${name}`.replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ");
  if (terms.length < 3) return null;
  const firstWord = (brand || name).toLowerCase().split(/\s+/)[0] || "";
  for (const host of ["world.openfoodfacts.org", "world.openbeautyfacts.org"]) {
    try {
      const response = await fetch(`https://${host}/cgi/search.pl?search_terms=${encodeURIComponent(terms)}&search_simple=1&action=process&json=1&page_size=5&fields=product_name,brands,image_front_small_url`, {
        headers: { "User-Agent": "Margo/0.1 (budgeting app)" }, signal: AbortSignal.timeout(6000),
      });
      if (!response.ok) continue;
      const body = await response.json() as { products?: Array<{ product_name?: string; brands?: string; image_front_small_url?: string }> };
      // Only trust a photo when the brand matches, so the picture is never of a different product.
      const match = body.products?.find((item) => item.image_front_small_url && firstWord && `${item.brands} ${item.product_name}`.toLowerCase().includes(firstWord));
      const image = httpsImage(match?.image_front_small_url);
      if (image) return image;
    } catch { /* try the next database */ }
  }
  // Everyday US products (cleaners, paper goods, beauty) that the open databases don't have photos for.
  try {
    const response = await fetch(`https://api.upcitemdb.com/prod/trial/search?s=${encodeURIComponent(terms)}&match_mode=1&type=product`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
    if (response.ok) {
      const body = await response.json() as { items?: Array<{ title?: string; brand?: string; images?: string[] }> };
      const match = body.items?.find((item) => firstWord && `${item.brand} ${item.title}`.toLowerCase().includes(firstWord) && item.images?.some((link) => /^https:/.test(link)));
      const image = httpsImage(match?.images?.find((link) => /^https:/.test(link)));
      if (image) return image;
    }
  } catch { /* no photo */ }
  return null;
}

/** Reads the main photo from a store's product page (the image the store itself shares for link previews). Not used for Amazon, which only allows photos from its own API. */
export async function pagePhoto(productUrl: string): Promise<string | null> {
  try {
    const url = new URL(productUrl);
    if (url.protocol !== "https:" || /(^|\.)amazon\./i.test(url.hostname)) return null;
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; MargoBot/0.1; link preview)", Accept: "text/html" }, signal: AbortSignal.timeout(7000), redirect: "follow" });
    if (!response.ok || !/text\/html/i.test(response.headers.get("content-type") || "")) return null;
    const html = (await response.text()).slice(0, 400_000);
    const tag = html.match(/<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]*>/i)?.[0] || "";
    const link = tag.match(/content=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, "&");
    return httpsImage(link ? new URL(link, url).toString() : null);
  } catch { return null; }
}

/** When no product database knows a barcode, asks the AI to look the number up on the web. */
export async function identifyBarcodeOnline(barcode: string): Promise<ProductInput | null> {
  const code = barcode.replace(/\D/g, "");
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey || !baseUrl || code.length < 8 || code.length > 14 || process.env.SWAP_WEB_SEARCH === "off") return null;
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: process.env.SWAP_AI_MODEL || "gpt-5.6-terra", tools: [{ type: "web_search" }], reasoning: { effort: "low" }, max_output_tokens: 4000,
        input: `Search the web for the retail product with UPC/EAN barcode ${code} (try "UPC ${code}" and "${code}"). Reply with JSON only: {"name": product name with size, "brand": brand, "category": short category}. Only answer if search results clearly show this exact barcode number with a product; otherwise reply {}. Never guess.`,
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
    const text = (payload.output ?? []).filter((item) => item.type === "message").flatMap((item) => item.content ?? []).map((part) => part.text ?? "").join("");
    const raw = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1) || "{}") as Record<string, unknown>;
    const name = clean(String(raw.name ?? ""), 200);
    return name.length >= 3 ? { name, brand: clean(String(raw.brand ?? ""), 120), category: clean(String(raw.category ?? ""), 80), barcode: code } : null;
  } catch { return null; }
}

export async function lookupBarcode(barcode: string): Promise<ProductInput | null> {
  const code = barcode.replace(/\D/g, "");
  if (code.length < 8 || code.length > 14) return null;
  for (const host of ["world.openfoodfacts.org", "world.openbeautyfacts.org"]) {
    try {
      const response = await fetch(`https://${host}/api/v2/product/${code}.json?fields=product_name,brands,quantity,categories,image_front_small_url,image_front_url`, {
        headers: { "User-Agent": "Margo/0.1 (budgeting app)" },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) continue;
      const body = await response.json() as { status?: number; product?: { product_name?: string; brands?: string; quantity?: string; categories?: string; image_front_small_url?: string; image_front_url?: string } };
      const product = body.product;
      if (body.status !== 1 || !product?.product_name) continue;
      const size = product.quantity ? `, ${product.quantity}` : "";
      return {
        name: `${product.product_name}${size}`,
        brand: (product.brands || "").split(",")[0]?.trim() || "",
        category: (product.categories || "").split(",").pop()?.trim() || (host.includes("beauty") ? "Personal care" : "Groceries"),
        barcode: code,
        imageUrl: httpsImage(product.image_front_small_url || product.image_front_url),
      };
    } catch { /* try the next database */ }
  }
  // Fallback for everyday US products the open databases don't have (free tier, about 100 lookups a day).
  try {
    const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${code}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (response.ok) {
      const body = await response.json() as { items?: Array<{ title?: string; brand?: string; category?: string; size?: string; images?: string[] }> };
      const item = body.items?.[0];
      if (item?.title) return { name: item.title, brand: item.brand || "", category: (item.category || "").split(">").pop()?.trim() || "", barcode: code, imageUrl: httpsImage(item.images?.find((link) => /^https:/.test(link))) };
    }
  } catch { /* not found anywhere */ }
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

/** Miley's IDs. These are public (they show up in every link), so they live here; a Replit Secret overrides them. */
const AMAZON_TAG = process.env.AMAZON_ASSOCIATE_TAG || "margo0ba-20";
const SKIMLINKS_ID = process.env.SKIMLINKS_PUBLISHER_ID || "312805X1801438";

export function storeLink(retailer: string, productName: string, brand: string) {
  const q = encodeURIComponent(`${brand} ${productName}`.trim());
  const match = searchUrls.find(([pattern]) => pattern.test(retailer));
  // No exact page: send people to Amazon's search for it (earns on the Amazon tag), unless the store has its own search.
  if (!match || AMAZON_TAG) return affiliate(`https://www.amazon.com/s?k=${q}`);
  return affiliate(match[1](q));
}

/** Adds the Amazon tag to Amazon links, and wraps other store links with Skimlinks or Sovrn once approved. */
export function affiliate(link: string): string {
  let url = link;
  try {
    const parsed = new URL(link);
    if (/(^|\.)amazon\.com$/i.test(parsed.hostname)) {
      if (AMAZON_TAG) parsed.searchParams.set("tag", AMAZON_TAG);
      return parsed.toString();
    }
  } catch { return link; }
  if (/(^|\.)skimresources\.com$|(^|\.)viglink\.com$/i.test(new URL(link).hostname)) return link; // already wrapped
  if (SKIMLINKS_ID) url = `https://go.skimresources.com/?id=${encodeURIComponent(SKIMLINKS_ID)}&xs=1&url=${encodeURIComponent(url)}`;
  else if (process.env.SOVRN_API_KEY) url = `https://redirect.viglink.com?key=${encodeURIComponent(process.env.SOVRN_API_KEY)}&u=${encodeURIComponent(url)}`;
  return url;
}

/* ---------------- AI ---------------- */

const storeBrands = "Target: Up & Up, Good & Gather, Favorite Day, Everspring. Walmart: Great Value, Equate, Mainstays. Kroger: Kroger, Simple Truth, Private Selection. Costco: Kirkland Signature. Amazon: Amazon Basics, Solimo, Amazon Elements. CVS: CVS Health. Walgreens: Walgreens brand. Aldi: Aldi exclusive brands. Trader Joe's: Trader Joe's. Ulta: Ulta Beauty Collection. Sephora: Sephora Collection. Whole Foods: 365 by Whole Foods Market.";

export async function askAi(product: ProductInput, evidence: Evidence[] = [], strict = false): Promise<{ category: string; sizeText: string; typicalPrice: number | null; originalPageUrl?: string; traits: string[]; suggestions: Array<Omit<EngineSuggestion, "url" | "upVotes" | "downVotes"> & { productUrl: string; photoPageUrl?: string; evidenceIndex: number | null; whyItsADupe: string }> } | null> {
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
- First, work out the 2 or 3 things that make the original what it is: its key ingredient or technology, its main claim, and its scent, finish or texture when they matter (for example "bond-building repair", "sulfate-free", "vanilla coconut scent"). Put them in "traits". A swap must share ALL of them. Same category and size is not enough: there are thousands of 10 oz daily shampoos, and a random one is not a dupe.
- Only suggest real products that exist and are widely sold.
${strict
  ? `- This is a product where formula, scent and finish matter, so only a REAL dupe counts: a product that people or reviewers specifically call a dupe or alternative for THIS exact product. It must be named in one of the search results below. Put that result's number in "evidenceIndex". If none of the results names a cheaper dupe for this exact product, return "suggestions": []. Saying nothing is much better than a generic match.`
  : `- For everyday basics (paper goods, cleaning, groceries, medicine), the same store's own brand or another store's own brand is a fine swap when it is the direct equivalent (labeled "compare to" this product, or the same active ingredient and strength). Otherwise use a cheaper product that the search results below name as a dupe, and put that result's number in "evidenceIndex". Return none when the product is already a store brand or already the cheapest of its kind.`}
${evidence.length ? `
Search results for "${product.brand ? `${product.brand} ` : ""}${product.name} dupe" (real pages; only trust what they actually say):
${evidence.map((item, i) => `[${i}] ${item.site}: ${item.title}. ${item.snippet}`).join("\n")}
` : strict ? `
No search results were found. Only suggest a dupe if it is very widely known as a dupe for this exact product (for example in beauty press), otherwise return none.
` : ""}
- Store brands: ${storeBrands}
- Match the type, form and size class (for example 6 rolls vs 6 rolls, 12 oz vs 10 to 14 oz). Same form: stick for stick, spray for spray, pods for pods, liquid for liquid. Same scent or flavor family when it matters (for example unscented for unscented).
- It must be cheaper per unit, not just a smaller package.
- "matchType": "Dupe" when it is named as a dupe for this exact product. Otherwise "Cheaper option".
- "whyItsADupe": one short sentence on what the source said, in your own words.
- "whySimilar": 2 or 3 short, specific, checkable facts (form, size, key ingredients, specs). No marketing words, no claims that it is made by the same company, no "identical".
- "shortReason": 2 to 4 lowercase words for a shelf label, like "same 6 rolls" or "similar formula". Never "same formula" unless the maker says so.
- "differences": one short sentence with the honest trade-off, or "".
- "typicalPrice": the usual US shelf price in dollars only if you are fairly sure, otherwise null. Never guess precise prices.
- Never suggest something that is not actually cheaper.
- For medicine, supplements, baby formula and allergy-related food, only suggest store-brand equivalents with the same active ingredient and strength.

Return JSON only:
{"category": string, "sizeText": string, "typicalPrice": number|null, "traits": string[],
 "suggestions": [{"evidenceIndex": number|null, "name": string, "brand": string, "retailer": string, "matchType": "Dupe"|"Cheaper option", "sizeText": string, "typicalPrice": number|null, "whySimilar": string[], "shortReason": string, "differences": string, "confidence": "high"|"medium"|"low"}]}`;
  // First choice: search the web for "dupe for ..." so the swap is current and links to the exact product page.
  const searched = await webSearchSwap(product, prompt, baseUrl, apiKey).catch((error) => { console.error("[swap-engine] web search", (error as Error).message); return null; });
  if (searched) return parseAnswer(searched.text, product, searched.cited, evidence);
  const call = (extra: Record<string, unknown>) => fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: process.env.SWAP_AI_MODEL || "gpt-5.6-terra",
      // Reasoning models spend part of this budget thinking, so leave plenty of room for the answer.
      max_completion_tokens: 8000,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
      ...extra,
    }),
  });
  let response = await call({ reasoning_effort: "low" });
  if (response.status === 400) response = await call({});
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`Swap AI request failed with ${response.status}: ${detail}`);
  }
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
  const content = payload.choices?.[0]?.message?.content?.trim();
  // An empty answer is a failure, not "no swap", so it isn't saved as "nothing found".
  if (!content) throw new Error(`Swap AI returned no answer (${payload.choices?.[0]?.finish_reason || "unknown"})`);
  return parseAnswer(content, product, null, evidence);
}

/** Asks the AI with web search turned on. Returns null when web search isn't available, so the plain AI is used instead. */
async function webSearchSwap(product: ProductInput, basePrompt: string, baseUrl: string, apiKey: string): Promise<{ text: string; cited: string[] } | null> {
  if (process.env.SWAP_WEB_SEARCH === "off") return null;
  const name = `${product.brand ? `${product.brand} ` : ""}${product.name}`;
  const prompt = `${basePrompt}

Before answering, also search the web for "dupe for ${name}" and "${name} cheaper alternative" (Reddit, TikTok and beauty sites), and check the store page of the one you pick to confirm it shares the traits.
Then search Amazon for that exact swap. In the suggestion object, also include "productUrl": its Amazon product page (amazon.com/dp/... or amazon.com/.../dp/...), copied from your search results. If it truly isn't sold on Amazon, use its product page at another big store instead. Never a search page, a blog post or a made-up link. Use "" if you can't find the exact page.
For photos, also include two more links copied from your search results, never Amazon: in the suggestion object "photoPageUrl" (the swap's product page at Target, Walmart, Ulta, CVS, Walgreens or the brand's own site), and at the top level "originalPageUrl" (a product page for the original product at one of those stores or its brand's site). Use "" when you can't find one.
For "typicalPrice", use the usual price you saw for the swap at stores other than Amazon (for example Target, Walmart or the brand's site), otherwise null. Do not copy Amazon's price.`;
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model: process.env.SWAP_AI_MODEL || "gpt-5.6-terra",
      tools: [{ type: "web_search" }],
      reasoning: { effort: "low" },
      max_output_tokens: 8000,
      input: prompt,
    }),
  });
  // Web search not offered on this connection: fall back quietly.
  if ([400, 404, 405, 422, 501].includes(response.status)) { console.warn("[swap-engine] web search unavailable", response.status); return null; }
  if (!response.ok) throw new Error(`Web search request failed with ${response.status}`);
  const payload = await response.json() as { output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; annotations?: Array<{ type?: string; url?: string }> }> }> };
  let text = "";
  const cited: string[] = [];
  for (const item of payload.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type !== "output_text") continue;
      text += part.text ?? "";
      for (const note of part.annotations ?? []) if (note.url) cited.push(note.url);
    }
  }
  return text.trim() ? { text, cited } : null;
}

/** Keeps a product link only if it's a real store product page the search actually found. */
function checkedProductUrl(value: unknown, cited: string[] | null): string {
  if (!cited || typeof value !== "string") return "";
  let url: URL;
  try { url = new URL(value.trim()); } catch { return ""; }
  if (url.protocol !== "https:") return "";
  if (/\/(s|search|searchpage|catalogsearch)(\/|$)|[?&](q|k|searchterm|keyword|query|ntt)=/i.test(`${url.pathname}${url.search}`)) return "";
  const host = url.hostname.replace(/^www\./, "");
  const found = cited.some((link) => { try { const c = new URL(link); return c.hostname.replace(/^www\./, "") === host && (c.pathname === url.pathname || c.href.startsWith(url.href.split("?")[0])); } catch { return false; } });
  // It must look like a product page (not a blog or list), and the search must have seen this page or this store.
  const productPage = /\/(dp|gp\/product|p|ip|product|products|prd)\/|\/A-\d+|\/pdp\/|\.html?$/i.test(url.pathname) && !/\/(blog|blogs|story|stories|article|articles|news|best-|list)/i.test(url.pathname);
  const sameStore = cited.some((link) => { try { return new URL(link).hostname.replace(/^www\./, "") === host; } catch { return false; } });
  return productPage && (found || sameStore) ? url.toString().split("#")[0] : "";
}

/** A store page the search actually visited, used only to read that store's product photo. Never Amazon. */
function photoPage(value: unknown, cited: string[] | null): string {
  if (!cited || typeof value !== "string") return "";
  try {
    const url = new URL(value.trim());
    const host = url.hostname.replace(/^www\./, "");
    if (url.protocol !== "https:" || /(^|\.)amazon\./i.test(host)) return "";
    return cited.some((link) => { try { return new URL(link).hostname.replace(/^www\./, "") === host; } catch { return false; } }) ? url.toString().split("#")[0] : "";
  } catch { return ""; }
}

const isProductPath = (link: string) => { try { const u = new URL(link); return /\/(dp|gp\/product|p|ip|product|products|prd)\/|\/A-\d+|\/pdp\/|\.html?$/i.test(u.pathname) && !/\/(blog|blogs|story|stories|article|articles|news|best-|list)/i.test(u.pathname); } catch { return false; } };
const storeName = (link: string, fallback: string) => {
  const host = (() => { try { return new URL(link).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const known: Record<string, string> = { "target.com": "Target", "walmart.com": "Walmart", "ulta.com": "Ulta", "cvs.com": "CVS", "walgreens.com": "Walgreens", "costco.com": "Costco", "kroger.com": "Kroger", "sephora.com": "Sephora", "samsclub.com": "Sam's Club" };
  return known[host] || fallback || host;
};

/* ---------------- Serper: Google Shopping and Google search (photos, prices, exact Amazon pages) ---------------- */

type ShoppingHit = { title?: string; source?: string; link?: string; price?: string; imageUrl?: string };
type OrganicHit = { title?: string; link?: string };

async function serper<T>(kind: "shopping" | "search", q: string): Promise<T | null> {
  const key = process.env.SERPER_API_KEY;
  if (!key || q.trim().length < 3) return null;
  try {
    const response = await fetch(`https://google.serper.dev/${kind}`, {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(9000),
      body: JSON.stringify({ q: q.slice(0, 200), gl: "us", hl: "en", num: 10 }),
    });
    return response.ok ? await response.json() as T : null;
  } catch { return null; }
}

/* ---------------- Real dupes: what people actually call a dupe ---------------- */
export type Evidence = { url: string; site: string; title: string; snippet: string };

/** Products where people care about the exact formula, scent or finish. These need a real, named dupe. */
export function needsRealDupe(text: string): boolean {
  return /shampoo|conditioner|hair|curl|scalp|serum|moisturi[sz]er|cream|lotion|cleanser|face|skin|spf|sunscreen|retinol|toner|mask|makeup|foundation|concealer|mascara|lip|blush|bronzer|primer|powder|brow|nail|perfume|fragrance|cologne|eau de|body wash|deodorant|beauty|cosmetic|dry shampoo|oil|balm|leggings|sneaker|bag|candle/i.test(text);
}

/** Google results for "<product> dupe": real people and sites naming dupes for this exact product. */
export async function dupeEvidence(name: string, brand: string): Promise<Evidence[]> {
  if (!process.env.SERPER_API_KEY) return [];
  const full = `${brand && !name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ` : ""}${name}`.replace(/\s+/g, " ").trim();
  type Organic = { organic?: Array<{ title?: string; link?: string; snippet?: string }> };
  const [web, reddit] = await Promise.all([serper<Organic>("search", `${full} dupe`), serper<Organic>("search", `${full} dupe reddit`)]);
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const hit of [...(web?.organic ?? []), ...(reddit?.organic ?? [])]) {
    if (!hit.link || seen.has(hit.link) || !/dupe|alternative|instead|similar|cheaper|same as|vs\.? /i.test(`${hit.title} ${hit.snippet}`)) continue;
    seen.add(hit.link);
    let site = "";
    try { site = new URL(hit.link).hostname.replace(/^www\./, ""); } catch { continue; }
    out.push({ url: hit.link, site, title: clean(hit.title || "", 160), snippet: clean(hit.snippet || "", 320) });
    if (out.length >= 10) break;
  }
  return out;
}

/** True when a search result really names this swap (its brand, plus a word from its name, appear in the result). */
export function evidenceNames(item: Evidence, swapBrand: string, swapName: string): boolean {
  const text = `${item.title} ${item.snippet}`.toLowerCase();
  const brandWord = firstWord(swapBrand);
  if (!brandWord || brandWord.length < 2 || !text.includes(brandWord)) return false;
  const words = swapName.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 3 && w !== brandWord && !/^(with|for|and|the|shampoo|conditioner|cream|serum|lotion|spray|ounce|pack)$/.test(w));
  return !words.length || words.some((w) => text.includes(w));
}

const firstWord = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/)[0] || "";
const dollars = (value?: string) => { const n = Number(String(value || "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) && n > 0 && n < 5000 ? Math.round(n * 100) / 100 : null; };

/** Google Shopping: the product's photo, a current price and where it's sold. Only trusts a hit whose title has the brand. */
export async function shoppingMatch(name: string, brand: string, size = ""): Promise<{ imageUrl: string | null; price: number | null; link: string | null; source: string } | null> {
  const body = await serper<{ shopping?: ShoppingHit[] }>("shopping", [brand, name, size].filter(Boolean).join(" "));
  const word = firstWord(brand || name);
  const hits = (body?.shopping ?? []).filter((hit) => hit.title && (!word || `${hit.title} ${hit.source}`.toLowerCase().includes(word)));
  // Prefer the big stores people trust.
  const rank = (hit: ShoppingHit) => /target|walmart|amazon|ulta|cvs|walgreens|kroger|costco|sephora/i.test(hit.source || "") ? 0 : 1;
  const hit = hits.sort((a, b) => rank(a) - rank(b))[0];
  if (!hit) return null;
  const link = hit.link && /^https:/.test(hit.link) && !/(^|\.)google\./i.test(new URL(hit.link).hostname) ? hit.link : null;
  return { imageUrl: httpsImage(hit.imageUrl), price: dollars(hit.price), link, source: clean(hit.source || "", 60) };
}

/** Google search limited to Amazon: the exact Amazon product page, as a clean amazon.com/dp/ link. */
export async function findAmazonPage(name: string, brand: string, size = ""): Promise<string | null> {
  const body = await serper<{ organic?: OrganicHit[] }>("search", `site:amazon.com ${[brand, name, size].filter(Boolean).join(" ")}`);
  const word = firstWord(brand || name);
  for (const hit of body?.organic ?? []) {
    const asin = hit.link?.match(/amazon\.com\/(?:[^?#]*\/)?(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1];
    if (asin && (!word || (hit.title || "").toLowerCase().includes(word))) return `https://www.amazon.com/dp/${asin.toUpperCase()}`;
  }
  return null;
}

/** Link order: the exact Amazon page, then the exact page at another store, then an Amazon search for it. */
export function chooseLink(productUrl: string, photoPageUrl: string, item: { name: string; brand: string; sizeText: string; retailer: string }) {
  const host = (link: string) => { try { return new URL(link).hostname; } catch { return ""; } };
  const amazonPage = productUrl && /(^|\.)amazon\./i.test(host(productUrl)) ? productUrl : "";
  const storePage = !amazonPage ? (productUrl || (photoPageUrl && isProductPath(photoPageUrl) ? photoPageUrl : "")) : "";
  const link = amazonPage || storePage;
  return {
    retailer: amazonPage ? "Amazon" : storePage ? storeName(storePage, item.retailer) : "Amazon",
    url: link ? affiliate(link) : affiliate(`https://www.amazon.com/s?k=${encodeURIComponent([item.brand, item.name, item.sizeText].filter(Boolean).join(" "))}`),
    linkKind: (amazonPage ? "amazon-page" : storePage ? "store-page" : "search") as NonNullable<EngineSuggestion["linkKind"]>,
  };
}

/** A quick second opinion from the AI (no web search): is this swap really the same kind of product, and cheaper? */
export async function checkMatch(product: ProductInput, swap: { name: string; brand: string; sizeText: string; typicalPrice: number | null; whySimilar: string[]; matchType: string }, originalSize: string, traits: string[] = [], strict = false, proof = ""): Promise<{ ok: boolean; note: string } | null> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey || !baseUrl || process.env.SWAP_CHECK === "off") return null;
  const prompt = `You check product swaps for a budgeting app. Be strict: a shopper should be able to buy the swap instead and be happy.

Original: ${product.brand ? `${product.brand} ` : ""}${product.name}${originalSize ? ` (${originalSize})` : ""}${product.price ? `, paid $${product.price.toFixed(2)}` : ""}
Swap: ${swap.brand ? `${swap.brand} ` : ""}${swap.name}${swap.sizeText ? ` (${swap.sizeText})` : ""}${swap.typicalPrice != null ? `, about $${swap.typicalPrice.toFixed(2)}` : ""}
Claimed: ${swap.whySimilar.join("; ")}
${traits.length ? `What makes the original what it is: ${traits.join("; ")}. The swap must share every one of these.\n` : ""}${proof ? `A source calling it a dupe: ${proof}\n` : ""}
Reject if ANY is true: a different kind of product; a different form (for example stick vs spray, liquid vs pods, wipes vs spray); a size more than about 40% smaller or bigger without saying so; a different scent or flavor family that matters for this product; not actually cheaper per unit; for medicine or supplements, a different active ingredient or strength; a product you don't believe exists; it is missing one of the original's defining traits${strict ? "; it is just a generic product of the same type rather than a real dupe people name for this exact product" : ""}.
Reply with JSON only: {"ok": true|false, "note": "under 12 words, plain"}`;
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ model: process.env.SWAP_CHECK_MODEL || process.env.SWAP_AI_MODEL || "gpt-5.6-terra", max_completion_tokens: 2000, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
  });
  if (!response.ok) return null;
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const raw = JSON.parse(payload.choices?.[0]?.message?.content || "{}") as { ok?: unknown; note?: unknown };
  if (typeof raw.ok !== "boolean") return null;
  return { ok: raw.ok, note: clean(String(raw.note || ""), 120) };
}

function parseAnswer(content: string, product: ProductInput, cited: string[] | null, evidence: Evidence[] = []) {
  const json = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  const raw = JSON.parse(json || "{}") as Record<string, unknown>;
  const price = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 && n < 5000 ? Math.round(n * 100) / 100 : null; };
  const list = Array.isArray(raw.suggestions) ? raw.suggestions as Record<string, unknown>[] : [];
  const originalPrice = product.price ?? price(raw.typicalPrice);
  return {
    category: clean(String(raw.category || product.category || ""), 80),
    sizeText: clean(String(raw.sizeText || ""), 60),
    typicalPrice: price(raw.typicalPrice),
    originalPageUrl: photoPage(raw.originalPageUrl, cited),
    traits: (Array.isArray(raw.traits) ? raw.traits : []).map((line) => clean(String(line), 60)).filter(Boolean).slice(0, 3),
    suggestions: list.slice(0, 1).map((item) => ({
      evidenceIndex: Number.isInteger(item.evidenceIndex) && Number(item.evidenceIndex) >= 0 && Number(item.evidenceIndex) < evidence.length ? Number(item.evidenceIndex) : null,
      whyItsADupe: clean(String(item.whyItsADupe || ""), 200),
      name: clean(String(item.name || ""), 160),
      brand: clean(String(item.brand || ""), 100),
      retailer: clean(String(item.retailer || product.retailer || ""), 80),
      matchType: (item.matchType === "Dupe" ? "Dupe" : "Cheaper option") as EngineSuggestion["matchType"],
      sizeText: clean(String(item.sizeText || ""), 60),
      typicalPrice: price(item.typicalPrice),
      whySimilar: (Array.isArray(item.whySimilar) ? item.whySimilar : []).map((line) => clean(String(line), 160)).filter(Boolean).slice(0, 3),
      shortReason: clean(String(item.shortReason || ""), 40).toLowerCase(),
      differences: clean(String(item.differences || ""), 200),
      confidence: (["high", "medium", "low"].includes(String(item.confidence)) ? item.confidence : "low") as EngineSuggestion["confidence"],
      productUrl: checkedProductUrl(item.productUrl, cited),
      photoPageUrl: photoPage(item.photoPageUrl, cited),
      check: undefined as string | undefined,
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
const photoTried = new Set<string>();
/** Adds missing photos to a saved swap without asking the AI again. */
async function backfillPhotos(row: SwapLookup, knownImage: string | null) {
  try {
    const imageUrl = row.imageUrl || knownImage || (await shoppingMatch(row.productName, row.brand))?.imageUrl || await findProductImage(row.productName, row.brand);
    const first = row.suggestions[0];
    const swapImage = first && !first.imageUrl ? (await shoppingMatch(first.name, first.brand, first.sizeText))?.imageUrl ?? (await pagePhoto(first.url)) ?? await findProductImage(first.name, first.brand) : first?.imageUrl ?? null;
    if (imageUrl === row.imageUrl && swapImage === (first?.imageUrl ?? null)) return;
    const suggestions = row.suggestions.map((item, index) => index === 0 ? { ...item, imageUrl: swapImage } : item);
    await db.update(swapLookupsTable).set({ imageUrl, suggestions }).where(eq(swapLookupsTable.id, row.id));
  } catch { /* photos are a nice-to-have */ }
}

/** Options for testing: skip saved answers and the daily limit. */
export type FindOptions = { fresh?: boolean; skipLimit?: boolean };

export async function findSwaps(input: ProductInput, userId: string | null, options: FindOptions = {}): Promise<SwapLookup | null> {
  const name = clean(input.name, 200);
  if (name.length < 3) return null;
  const brand = clean(input.brand, 120);
  const key = productKey(name, brand);
  const [existing] = await db.select().from(swapLookupsTable).where(eq(swapLookupsTable.productKey, key)).limit(1);
  // A found swap is reused for 30 days; "nothing found" is re-checked after 3 days; errors are always retried.
  const age = existing ? Date.now() - existing.updatedAt.getTime() : Infinity;
  const fresh = existing && (existing.status === "ready" ? age < CACHE_DAYS * 86_400_000 : existing.status === "none" ? age < 3 * 86_400_000 : false);
  // Swaps found before the real-dupe rules (no traits saved) are looked up again.
  const oldRules = existing?.status === "ready" && existing.source !== "admin" && !existing.suggestions.some((item) => Array.isArray(item.traits));
  if (existing && !options.fresh && !oldRules && (fresh || existing.source === "admin")) {
    // Saved before photos existed: look for them quietly, so they show up next time.
    if (existing.status === "ready" && (!existing.imageUrl || !existing.suggestions[0]?.imageUrl) && !photoTried.has(key)) { photoTried.add(key); void backfillPhotos(existing, input.imageUrl ?? null); }
    return existing;
  }
  if (inflight.has(key)) return inflight.get(key)!;
  if (!options.skipLimit && !(await underDailyLimit(userId))) return existing ?? null;

  const job = (async () => {
    let status: SwapLookup["status"] = "ready";
    let result: Awaited<ReturnType<typeof askAi>> = null;
    // Real dupes: what Reddit, TikTok and beauty sites call a dupe for this exact product.
    const strict = needsRealDupe(`${brand} ${name} ${input.category || ""}`);
    const evidence = await dupeEvidence(name, brand).catch(() => [] as Evidence[]);
    try { result = await askAi({ ...input, name, brand }, evidence, strict); } catch (error) { status = "error"; console.error("[swap-engine]", (error as Error).message); }
    if (status !== "error" && !result) return existing ?? null; // AI not configured
    // Keep a swap only if a real page names it (required for beauty, hair, skin and the like).
    let proof: Evidence | null = null;
    if (result?.suggestions?.[0]) {
      const top = result.suggestions[0];
      const picked = top.evidenceIndex != null ? evidence[top.evidenceIndex] : undefined;
      proof = picked && evidenceNames(picked, top.brand, top.name) ? picked : evidence.find((item) => evidenceNames(item, top.brand, top.name)) ?? null;
      if (strict && !proof && evidence.length) {
        console.warn("[swap-engine] no source names this dupe", name, "->", top.name);
        result.suggestions = [];
      }
    }
    // A second look: drop a swap that isn't truly the same kind of product, or isn't cheaper.
    if (result?.suggestions?.[0]) {
      const verdict = await checkMatch({ ...input, name, brand }, result.suggestions[0], result.sizeText, result.traits, strict, proof ? `${proof.site}: ${proof.title}. ${proof.snippet}` : "").catch(() => null);
      if (verdict && !verdict.ok) { console.warn("[swap-engine] check rejected", name, "->", result.suggestions[0].name, verdict.note); result.suggestions = []; }
      else if (verdict) result.suggestions[0] = { ...result.suggestions[0], check: verdict.note };
    }
    const firstPage = result?.suggestions?.[0]?.productUrl || "";
    const swapPhotoPage = result?.suggestions?.[0]?.photoPageUrl || "";
    const suggestions: EngineSuggestion[] = (result?.suggestions ?? []).map(({ productUrl, photoPageUrl, evidenceIndex: _index, whyItsADupe, ...item }) => {
      const chosen = chooseLink(productUrl, photoPageUrl || "", item);
      return {
        ...item,
        // A typical price from other stores' pages, never Amazon's own price (Amazon only allows prices from its API).
        typicalPrice: item.typicalPrice,
        ...chosen,
        matchType: proof ? "Dupe" as const : item.matchType,
        evidence: proof ? { url: proof.url, site: proof.site, quote: whyItsADupe || clean(proof.snippet, 160) } : null,
        traits: result?.traits ?? [],
        upVotes: 0,
        downVotes: 0,
      };
    });
    if (status === "ready" && !suggestions.length) status = "none";
    // With Serper: find the exact Amazon page, and a real photo and current price from Google Shopping.
    let shoppingOriginal: Awaited<ReturnType<typeof shoppingMatch>> = null;
    if (process.env.SERPER_API_KEY) {
      const top = suggestions[0];
      const [amazon, swapShop, origShop] = await Promise.all([
        top && top.linkKind !== "amazon-page" ? findAmazonPage(top.name, top.brand, top.sizeText) : Promise.resolve(null),
        top ? shoppingMatch(top.name, top.brand, top.sizeText) : Promise.resolve(null),
        !input.imageUrl && !existing?.imageUrl ? shoppingMatch(name, brand) : Promise.resolve(null),
      ]);
      shoppingOriginal = origShop;
      if (top && amazon) Object.assign(top, { url: affiliate(amazon), retailer: "Amazon", linkKind: "amazon-page" });
      if (top && swapShop) {
        if (!top.imageUrl && swapShop.imageUrl) top.imageUrl = swapShop.imageUrl;
        // A live price, but never Amazon's own (Amazon only allows prices from its API).
        if (top.typicalPrice == null && swapShop.price && !/amazon/i.test(swapShop.source)) top.typicalPrice = swapShop.price;
        if (top.linkKind === "search" && swapShop.link && !/amazon\./i.test(swapShop.link)) Object.assign(top, { url: affiliate(swapShop.link), retailer: swapShop.source || top.retailer, linkKind: "store-page" });
      }
    }
    // Photos: the scanned product's own photo if we have it, and a best-effort photo for the swap.
    if (suggestions[0] && !suggestions[0].imageUrl) suggestions[0].imageUrl = (swapPhotoPage ? await pagePhoto(swapPhotoPage) : null) ?? (firstPage ? await pagePhoto(firstPage) : null) ?? await findProductImage(suggestions[0].name, suggestions[0].brand).catch(() => null);
    const imageUrl = input.imageUrl || existing?.imageUrl || shoppingOriginal?.imageUrl || (result?.originalPageUrl ? await pagePhoto(result.originalPageUrl) : null) || await findProductImage(name, brand).catch(() => null);
    const values = {
      productKey: key, productName: name, brand,
      category: clean(result?.category || input.category, 80),
      sizeText: clean(result?.sizeText, 60),
      barcode: input.barcode ? clean(input.barcode, 40) : null,
      retailer: clean(input.retailer, 80),
      typicalPrice: input.price ? input.price.toFixed(2) : result?.typicalPrice ? result.typicalPrice.toFixed(2) : null,
      status, suggestions, imageUrl, source: "ai", createdBy: userId,
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
