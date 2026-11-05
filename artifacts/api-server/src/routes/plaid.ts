import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from "plaid";
import { and, eq } from "drizzle-orm";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, incomePayerPreferencesTable, plaidItemsTable, transactionsTable } from "@workspace/db";

const router: IRouter = Router();
const knownGigPayers = ["instawork", "qwick", "instacart", "uber", "doordash", "paypal", "venmo", "zelle", "cash app"];
const normalizePayer = (label: string) => label.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
const isKnownGigPayer = (label: string) => knownGigPayers.some((payer) => normalizePayer(label).includes(payer));

function isUsualPaycheck(label: string, amount: number, history: Array<{ label: string; amount: number }>): boolean {
  if (/payroll|paycheck|salary/i.test(label) && !isKnownGigPayer(label)) return true;
  const groups = new Map<string, number[]>();
  for (const entry of history) {
    if (isKnownGigPayer(entry.label)) continue;
    const key = normalizePayer(entry.label);
    groups.set(key, [...(groups.get(key) || []), Number(entry.amount)]);
  }
  const regular = [...groups.entries()].filter(([, values]) => values.length >= 2).sort((a, b) => b[1].length - a[1].length)[0];
  if (!regular || normalizePayer(label) !== regular[0]) return false;
  const amounts = regular[1].slice().sort((a, b) => a - b);
  const median = amounts[Math.floor(amounts.length / 2)];
  return Math.abs(amount - median) <= Math.max(25, median * 0.08);
}

function classifyIncome(label: string, amount: number, history: Array<{ label: string; amount: number }>, preferences: Map<string, "set-aside" | "not-taxable">) {
  const payerKey = normalizePayer(label);
  const preference = preferences.get(payerKey);
  if (preference) return { incomePayerKey: payerKey, incomeReviewStatus: preference, isTaxable: preference === "set-aside" };
  const unusual = isKnownGigPayer(label) || !isUsualPaycheck(label, amount, history);
  return { incomePayerKey: payerKey, incomeReviewStatus: unusual ? "pending" as const : "none" as const, isTaxable: false };
}

function requireUser(req: Request, res: Response): req is Request & { user: Express.User } {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Authentication required" }); return false; }
  return true;
}

function plaidClient(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) throw new Error("Plaid credentials are not configured");
  return new PlaidApi(new Configuration({
    basePath: PlaidEnvironments.sandbox,
    baseOptions: { headers: { "PLAID-CLIENT-ID": clientId, "PLAID-SECRET": secret } },
  }));
}

function encryptionKey(): Buffer {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) throw new Error("Session encryption key is unavailable");
  return createHash("sha256").update(sessionSecret).update("margo-plaid-access-token-v1").digest();
}

function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptToken(value: string): string {
  const [version, iv, tag, data] = value.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Stored Plaid token format is invalid");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

function transactionCategory(primary?: string | null, detailed?: string | null): string {
  const category = (primary || "").toUpperCase();
  const detail = (detailed || "").toUpperCase();
  if (detail.includes("RENT") || category === "RENT") return "Rent";
  if (detail.includes("UTILIT") || category === "UTILITIES") return "Utilities";
  if (detail.includes("GROCER") || category === "GROCERIES") return "Groceries";
  if (detail.includes("RESTAURANT") || detail.includes("COFFEE") || category === "FOOD_AND_DRINK") return "Dining out";
  if (category === "TRANSPORTATION") return "Transportation";
  if (category === "PERSONAL_CARE") return "Personal care";
  if (detail.includes("SUBSCRIPTION") || category === "ENTERTAINMENT") return "Subscriptions";
  return "Shopping";
}

router.post("/plaid/link-token", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  try {
    const response = await plaidClient().linkTokenCreate({
      user: { client_user_id: req.user.id },
      client_name: "Margo",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    });
    res.json({ linkToken: response.data.link_token });
  } catch (error) {
    req.log.error("Could not create Plaid Link token");
    res.status(502).json({ error: "Could not start a bank connection" });
  }
});

router.post("/plaid/exchange", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const publicToken = typeof req.body?.publicToken === "string" ? req.body.publicToken : "";
  if (!publicToken) { res.status(400).json({ error: "A Plaid public token is required" }); return; }
  try {
    const exchange = await plaidClient().itemPublicTokenExchange({ public_token: publicToken });
    const institutionId = typeof req.body?.institutionId === "string" ? req.body.institutionId.slice(0, 120) : null;
    const institutionName = typeof req.body?.institutionName === "string" ? req.body.institutionName.slice(0, 160) : "Connected bank";
    const [item] = await db.insert(plaidItemsTable).values({
      userId: req.user.id, itemId: exchange.data.item_id, accessTokenEncrypted: encryptToken(exchange.data.access_token),
      institutionId, institutionName,
    }).returning({ id: plaidItemsTable.id });
    res.status(201).json({ connected: true, itemId: item?.id });
  } catch (error) {
    req.log.error("Could not exchange Plaid public token");
    res.status(502).json({ error: "Could not finish the bank connection" });
  }
});

router.get("/plaid/items", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const items = await db.select({ id: plaidItemsTable.id, institutionName: plaidItemsTable.institutionName, lastSyncAt: plaidItemsTable.lastSyncAt })
    .from(plaidItemsTable).where(eq(plaidItemsTable.userId, req.user.id));
  res.json(items);
});

router.post("/plaid/sync", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const itemId = typeof req.body?.itemId === "string" ? req.body.itemId : "";
  const [item] = await db.select().from(plaidItemsTable).where(and(eq(plaidItemsTable.id, itemId), eq(plaidItemsTable.userId, req.user.id)));
  if (!item) { res.status(404).json({ error: "Connected bank not found" }); return; }
  try {
    const client = plaidClient();
    const [incomeRows, payerPreferences] = await Promise.all([
      db.select({ label: transactionsTable.label, amount: transactionsTable.amount })
        .from(transactionsTable)
        .where(and(eq(transactionsTable.userId, req.user.id), eq(transactionsTable.type, "income"), eq(transactionsTable.source, "Plaid"))),
      db.select().from(incomePayerPreferencesTable).where(eq(incomePayerPreferencesTable.userId, req.user.id)),
    ]);
    const incomeHistory = incomeRows.map((row) => ({ label: row.label, amount: Number(row.amount) }));
    const preferences = new Map(payerPreferences.map((row) => [row.payerKey, row.decision]));
    let cursor = item.cursor || undefined;
    let hasMore = true;
    let imported = 0;
    while (hasMore) {
      const page = await client.transactionsSync({ access_token: decryptToken(item.accessTokenEncrypted), cursor, count: 500 });
      const allKnownIncome = [...incomeHistory, ...page.data.added.filter((tx) => tx.amount < 0).map((tx) => ({ label: tx.merchant_name || tx.name || "Bank transaction", amount: Math.abs(tx.amount) }))];
      for (const tx of page.data.added) {
        const expense = tx.amount > 0;
        const label = (tx.merchant_name || tx.name || "Bank transaction").slice(0, 120);
        const review = expense ? { incomePayerKey: null, incomeReviewStatus: "none" as const, isTaxable: false } : classifyIncome(label, Math.abs(tx.amount), allKnownIncome, preferences);
        await db.insert(transactionsTable).values({
          userId: req.user.id,
          type: expense ? "expense" : "income",
          label,
          amount: Math.abs(tx.amount),
          category: expense ? transactionCategory(tx.personal_finance_category?.primary, tx.personal_finance_category?.detailed) : "Income",
          date: tx.date,
          ...review,
          source: "Plaid",
          plaidTransactionId: tx.transaction_id,
        }).onConflictDoUpdate({
          target: [transactionsTable.userId, transactionsTable.plaidTransactionId],
          set: {
            type: expense ? "expense" : "income", label,
            amount: Math.abs(tx.amount), category: expense ? transactionCategory(tx.personal_finance_category?.primary, tx.personal_finance_category?.detailed) : "Income",
            date: tx.date, source: "Plaid", ...review,
          },
        });
        imported += 1;
        if (!expense) incomeHistory.push({ label, amount: Math.abs(tx.amount) });
      }
      for (const tx of page.data.modified) {
        const expense = tx.amount > 0;
        await db.update(transactionsTable).set({
          type: expense ? "expense" : "income", label: (tx.merchant_name || tx.name || "Bank transaction").slice(0, 120),
          amount: Math.abs(tx.amount), category: expense ? transactionCategory(tx.personal_finance_category?.primary, tx.personal_finance_category?.detailed) : "Income",
          date: tx.date,
        }).where(and(eq(transactionsTable.userId, req.user.id), eq(transactionsTable.plaidTransactionId, tx.transaction_id)));
      }
      for (const removed of page.data.removed) {
        await db.delete(transactionsTable).where(and(eq(transactionsTable.userId, req.user.id), eq(transactionsTable.plaidTransactionId, removed.transaction_id)));
      }
      cursor = page.data.next_cursor;
      hasMore = page.data.has_more;
    }
    await db.update(plaidItemsTable).set({ cursor: cursor || null, lastSyncAt: new Date() }).where(eq(plaidItemsTable.id, item.id));
    res.json({ imported });
  } catch (error) {
    req.log.error("Could not sync bank transactions");
    res.status(502).json({ error: "Could not sync transactions. Try again shortly." });
  }
});

router.delete("/plaid/items/:id", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const [item] = await db.select().from(plaidItemsTable).where(and(eq(plaidItemsTable.id, req.params.id as string), eq(plaidItemsTable.userId, req.user.id)));
  if (!item) { res.status(404).json({ error: "Connected bank not found" }); return; }
  try {
    await plaidClient().itemRemove({ access_token: decryptToken(item.accessTokenEncrypted) });
  } catch {
    req.log.warn("Plaid could not revoke an item during local disconnect");
  }
  await db.delete(plaidItemsTable).where(and(eq(plaidItemsTable.id, req.params.id as string), eq(plaidItemsTable.userId, req.user.id)));
  res.sendStatus(204);
});

export default router;
