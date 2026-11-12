import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import { db, productsTable, receiptInboxesTable, receiptsTable, userProductPurchasesTable } from "@workspace/db";
import { findSwapsInBackground } from "../lib/swap-engine";

/*
 * Receipts by email.
 * Each person gets a private address like receipts+<token>@<inbound domain>. They forward order
 * emails there (or set an automatic forwarding rule). The email service (Postmark Inbound) posts
 * each email to /api/email/inbound, Margo reads the receipt with AI, saves it, and finds swaps.
 * The email itself is never stored.
 *
 * Replit Secrets:
 *   INBOUND_EMAIL_ADDRESS  the inbound address from the email service, like abc123@inbound.postmarkapp.com
 *   INBOUND_EMAIL_SECRET   a long random password, also put in the webhook URL so only the service can post
 */

const router: IRouter = Router();

const newToken = () => randomBytes(10).toString("hex"); // 20 lowercase characters, safe in an email address

function addressFor(token: string): string | null {
  const base = (process.env.INBOUND_EMAIL_ADDRESS || "").trim();
  const at = base.indexOf("@");
  if (at < 1) return null;
  return `${base.slice(0, at).split("+")[0]}+${token}${base.slice(at)}`;
}

async function inboxFor(userId: string) {
  const [existing] = await db.select().from(receiptInboxesTable).where(eq(receiptInboxesTable.userId, userId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(receiptInboxesTable).values({ userId, token: newToken() })
    .onConflictDoNothing({ target: receiptInboxesTable.userId }).returning();
  if (created) return created;
  const [again] = await db.select().from(receiptInboxesTable).where(eq(receiptInboxesTable.userId, userId)).limit(1);
  return again!;
}

function inboxView(inbox: typeof receiptInboxesTable.$inferSelect) {
  const recentCode = inbox.gmailCode && inbox.gmailCodeAt && Date.now() - inbox.gmailCodeAt.getTime() < 3 * 24 * 3600 * 1000;
  return {
    address: addressFor(inbox.token),
    gmailCode: recentCode ? inbox.gmailCode : null,
    lastReceivedAt: inbox.lastReceivedAt,
    lastResult: inbox.lastResult,
  };
}

router.get("/receipts/inbox", async (req, res): Promise<void> => {
  if (!req.dbUser) { res.status(401).json({ error: "Please sign in." }); return; }
  res.json(inboxView(await inboxFor(req.dbUser.id)));
});

/** Makes a new address and turns off the old one, in case someone else got hold of it. */
router.post("/receipts/inbox/reset", async (req, res): Promise<void> => {
  if (!req.dbUser) { res.status(401).json({ error: "Please sign in." }); return; }
  await inboxFor(req.dbUser.id);
  const [updated] = await db.update(receiptInboxesTable)
    .set({ token: newToken(), gmailCode: null, gmailCodeAt: null })
    .where(eq(receiptInboxesTable.userId, req.dbUser.id)).returning();
  res.json(inboxView(updated!));
});

/* ---------------- The webhook the email service calls ---------------- */

function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(req: Request): boolean {
  const secret = process.env.INBOUND_EMAIL_SECRET || "";
  if (secret.length < 16) return false;
  const fromQuery = typeof req.query.key === "string" ? req.query.key : "";
  const basic = /^Basic (.+)$/i.exec(req.headers.authorization || "")?.[1];
  const fromBasic = basic ? Buffer.from(basic, "base64").toString().split(":").slice(1).join(":") : "";
  return (fromQuery !== "" && sameSecret(fromQuery, secret)) || (fromBasic !== "" && sameSecret(fromBasic, secret));
}

type InboundEmail = {
  From?: string; FromFull?: { Email?: string };
  To?: string; Cc?: string; OriginalRecipient?: string; MailboxHash?: string;
  ToFull?: Array<{ Email?: string; MailboxHash?: string }>;
  Subject?: string; TextBody?: string; HtmlBody?: string; StrippedTextReply?: string; Date?: string;
  // Generic field names used by other email services
  from?: string; to?: string; subject?: string; text?: string; html?: string;
};

export function findToken(mail: InboundEmail): string | null {
  const candidates = [
    mail.MailboxHash, ...(mail.ToFull || []).map((to) => to.MailboxHash),
    mail.OriginalRecipient, mail.To, mail.Cc, mail.to, ...(mail.ToFull || []).map((to) => to.Email),
  ];
  for (const value of candidates) {
    if (!value) continue;
    const plain = /^[a-f0-9]{20}$/.exec(value.trim());
    if (plain) return plain[0];
    const tagged = /\+([a-f0-9]{20})@/i.exec(value);
    if (tagged) return tagged[1]!.toLowerCase();
  }
  return null;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " \t ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#36;|&dollar;/gi, "$").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

/** Gmail asks you to confirm a new forwarding address by email. Pull out the code so Margo can show it. */
export function gmailConfirmation(mail: InboundEmail): string | null {
  const from = `${mail.From || ""} ${mail.FromFull?.Email || ""} ${mail.from || ""}`;
  if (!/forwarding-noreply@google\.com/i.test(from)) return null;
  const body = `${mail.Subject || ""}\n${mail.TextBody || htmlToText(mail.HtmlBody || "")}`;
  return /confirmation code[^0-9]{0,20}(\d{6,12})/i.exec(body)?.[1] || /#(\d{6,12})/.exec(body)?.[1] || null;
}

type ParsedReceipt = { merchant: string; purchasedAt: string; total: number; items: Array<{ productName: string; brand: string | null; category: string; unitPrice: number; unitsPerYear: number }> };

async function readReceipt(subject: string, from: string, text: string, sentAt: string): Promise<ParsedReceipt | null> {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey || !baseUrl) return null;
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      max_completion_tokens: 2500,
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: `This email was forwarded to a budgeting app. Decide if it is a receipt or order confirmation for things the person bought (not a shipping update, ad, newsletter, return, or refund).
Return JSON only: {"isReceipt": boolean, "merchant": string, "purchasedAt": "YYYY-MM-DD" or "", "total": number, "items": [{"productName": string, "brand": string or null, "category": one of Groceries, Dining out, Shopping, Beauty, Transportation, Subscriptions, Utilities, Other, "unitPrice": number, "unitsPerYear": 12}]}
Use the full product name as written. unitPrice is the price of one item. Leave out taxes, shipping, tips, discounts and gift cards as items. Do not guess anything you can't read; leave it out.

Subject: ${subject}
From: ${from}
Sent: ${sentAt}

${text.slice(0, 30_000)}`,
      }],
    }),
  });
  if (!response.ok) throw new Error(`Receipt reader returned ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const result = JSON.parse(payload.choices?.[0]?.message?.content || "{}") as Record<string, unknown>;
  if (!result.isReceipt) return null;
  const items = (Array.isArray(result.items) ? result.items : []).filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      productName: String(item.productName || "").trim().slice(0, 120),
      brand: typeof item.brand === "string" && item.brand.trim() ? item.brand.trim().slice(0, 80) : null,
      category: String(item.category || "Other").slice(0, 60),
      unitPrice: Math.max(0, Number(item.unitPrice) || 0),
      unitsPerYear: Math.min(1000, Math.max(1, Number(item.unitsPerYear) || 12)),
    })).filter((item) => item.productName && item.unitPrice > 0).slice(0, 60);
  const sentDay = /^\d{4}-\d{2}-\d{2}/.exec(new Date(sentAt || Date.now()).toISOString())?.[0] || new Date().toISOString().slice(0, 10);
  const purchasedAt = typeof result.purchasedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(result.purchasedAt) ? result.purchasedAt : sentDay;
  const total = Math.max(0, Number(result.total) || items.reduce((sum, item) => sum + item.unitPrice, 0));
  const merchant = String(result.merchant || "").trim().slice(0, 120) || "Email receipt";
  return items.length || total > 0 ? { merchant, purchasedAt, total, items } : null;
}

async function saveReceipt(userId: string, receipt: ParsedReceipt): Promise<"saved" | "duplicate"> {
  const [duplicate] = await db.select({ id: receiptsTable.id }).from(receiptsTable).where(and(
    eq(receiptsTable.userId, userId), eq(receiptsTable.merchant, receipt.merchant),
    eq(receiptsTable.purchasedAt, receipt.purchasedAt), eq(receiptsTable.total, receipt.total),
  )).limit(1);
  if (duplicate) return "duplicate";
  await db.transaction(async (tx) => {
    const [saved] = await tx.insert(receiptsTable).values({
      userId, merchant: receipt.merchant, purchasedAt: receipt.purchasedAt, total: receipt.total, objectPath: null, items: receipt.items,
    }).returning();
    if (!saved) return;
    for (const item of receipt.items) {
      const brand = item.brand ?? "";
      const normalizedName = item.productName.toLowerCase().replace(/\s+/g, " ");
      const [inserted] = await tx.insert(productsTable).values({ name: item.productName, normalizedName, brand, category: item.category })
        .onConflictDoNothing({ target: [productsTable.normalizedName, productsTable.brand] }).returning();
      const [product] = inserted ? [inserted] : await tx.select().from(productsTable)
        .where(and(eq(productsTable.normalizedName, normalizedName), eq(productsTable.brand, brand))).limit(1);
      await tx.insert(userProductPurchasesTable).values({
        userId, productId: product?.id ?? null, receiptId: saved.id, source: "email",
        productNameSnapshot: item.productName, unitPrice: item.unitPrice, quantity: 1, purchasedAt: receipt.purchasedAt,
      });
    }
  });
  findSwapsInBackground(receipt.items.map((item) => ({
    name: item.productName, brand: item.brand, category: item.category, retailer: receipt.merchant, price: item.unitPrice,
  })), userId);
  return "saved";
}

router.post("/email/inbound", async (req, res): Promise<void> => {
  if (!authorized(req)) { res.status(401).json({ error: "Not allowed." }); return; }
  const mail = (req.body || {}) as InboundEmail;
  const token = findToken(mail);
  // Always answer 200 for mail we can't use, so the email service doesn't keep retrying it.
  if (!token) { res.json({ ok: true, result: "no-inbox" }); return; }
  const [inbox] = await db.select().from(receiptInboxesTable).where(eq(receiptInboxesTable.token, token)).limit(1);
  if (!inbox) { res.json({ ok: true, result: "unknown-inbox" }); return; }

  const code = gmailConfirmation(mail);
  if (code) {
    await db.update(receiptInboxesTable).set({ gmailCode: code, gmailCodeAt: new Date() }).where(eq(receiptInboxesTable.userId, inbox.userId));
    res.json({ ok: true, result: "gmail-code" });
    return;
  }

  const subject = String(mail.Subject || mail.subject || "").slice(0, 300);
  const from = String(mail.From || mail.from || "").slice(0, 300);
  const text = mail.TextBody || mail.text || htmlToText(mail.HtmlBody || mail.html || "");
  let result = "Not a receipt, skipped";
  try {
    const receipt = await readReceipt(subject, from, mail.HtmlBody ? htmlToText(mail.HtmlBody) : text, String(mail.Date || ""));
    if (receipt) {
      const outcome = await saveReceipt(inbox.userId, receipt);
      result = outcome === "saved" ? `Saved ${receipt.merchant}, ${receipt.items.length} items` : `Already had ${receipt.merchant}`;
    }
  } catch (error) {
    req.log.error({ err: error }, "Could not read emailed receipt");
    result = "Couldn't read that email";
  }
  await db.update(receiptInboxesTable).set({ lastReceivedAt: new Date(), lastResult: result.slice(0, 200) }).where(eq(receiptInboxesTable.userId, inbox.userId));
  res.json({ ok: true, result });
});

export default router;
