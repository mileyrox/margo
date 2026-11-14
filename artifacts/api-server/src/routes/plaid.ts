import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from "plaid";
import { and, asc, eq, gte, lt, desc, inArray } from "drizzle-orm";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { balanceSnapshotsTable, bankAccountsTable, db, incomePayerPreferencesTable, payeeRulesTable, plaidItemsTable, PLAID_SORT_VERSION, transactionsTable } from "@workspace/db";

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

function requireUser(req: Request, res: Response): boolean {
  if (!req.dbUser) { res.status(401).json({ error: "Authentication required" }); return false; }
  return true;
}

function plaidClient(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) throw new Error("Plaid credentials are not configured");
  return new PlaidApi(new Configuration({
    basePath: process.env.PLAID_ENV === "production" ? PlaidEnvironments.production : PlaidEnvironments.sandbox,
    baseOptions: { headers: { "PLAID-CLIENT-ID": clientId, "PLAID-SECRET": secret } },
  }));
}

// New tokens are encrypted with PLAID_TOKEN_KEY when it is set. Tokens saved earlier
// with the session-derived key still decrypt, so adding the secret never breaks a connection.
function encryptionKeys(): Buffer[] {
  const keys: Buffer[] = [];
  if (process.env.PLAID_TOKEN_KEY) keys.push(createHash("sha256").update(process.env.PLAID_TOKEN_KEY).update("margo-plaid-access-token-v2").digest());
  if (process.env.SESSION_SECRET) keys.push(createHash("sha256").update(process.env.SESSION_SECRET).update("margo-plaid-access-token-v1").digest());
  if (!keys.length) throw new Error("Plaid token encryption key is unavailable");
  return keys;
}

function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKeys()[0], iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptToken(value: string): string {
  const [version, iv, tag, data] = value.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Stored Plaid token format is invalid");
  for (const key of encryptionKeys()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
    } catch { /* Try the next key. */ }
  }
  throw new Error("Stored Plaid token could not be decrypted");
}

/*
 * Sorting bank transactions. Paying a card or loan, paying rent, and moving money to savings or between your own
 * accounts are NOT spending, and money coming back (transfers in, refunds) is NOT income.
 * When Margo can't tell (a Zelle or Venmo to a person, a cash withdrawal, a low-confidence match), it's marked
 * "Needs a look" and the app asks. The answer is remembered for that payee.
 */
export const NOT_SPENDING = ["Rent", "Utilities", "Debt payment", "Savings", "Transfer", "Needs a look"];
const P2P = /\b(venmo|zelle|cash ?app|square cash|paypal|apple cash)\b/i;
type PlaidTx = { amount: number; name?: string | null; merchant_name?: string | null; personal_finance_category?: { primary?: string | null; detailed?: string | null; confidence_level?: string | null } | null };

export function sortTransaction(tx: PlaidTx, rules: Map<string, string>): { type: "expense" | "income"; category: string } {
  const label = tx.merchant_name || tx.name || "";
  const primary = (tx.personal_finance_category?.primary || "").toUpperCase();
  const detail = (tx.personal_finance_category?.detailed || "").toUpperCase();
  const confidence = (tx.personal_finance_category?.confidence_level || "").toUpperCase();
  if (tx.amount < 0) {
    // Money in. Transfers from your own accounts, card payments landing on the card, and refunds aren't income.
    if (primary === "TRANSFER_IN" || primary === "LOAN_PAYMENTS" || /payment (thank you|received)|transfer from/i.test(label)) return { type: "income", category: "Transfer" };
    if (primary && primary !== "INCOME" && !P2P.test(label)) return { type: "income", category: "Refund" };
    return { type: "income", category: "Income" };
  }
  const rule = rules.get(normalizePayer(label));
  if (rule) return { type: "expense", category: rule };
  if (primary === "LOAN_PAYMENTS") return { type: "expense", category: detail.includes("MORTGAGE") ? "Rent" : "Debt payment" };
  if (/payment thank you|autopay|card ?payment|crd ?pmt|cardmember serv|loan pmt|epay/i.test(label) && !primary) return { type: "expense", category: "Debt payment" };
  if (primary === "TRANSFER_OUT") {
    if (detail.includes("SAVINGS") || detail.includes("INVESTMENT") || detail.includes("RETIREMENT")) return { type: "expense", category: "Savings" };
    if (P2P.test(label) || detail.includes("WITHDRAWAL") || detail.includes("OTHER")) return { type: "expense", category: "Needs a look" };
    return { type: "expense", category: "Transfer" };
  }
  if (P2P.test(label)) return { type: "expense", category: "Needs a look" };
  if (primary === "RENT_AND_UTILITIES") return { type: "expense", category: detail === "RENT_AND_UTILITIES_RENT" ? "Rent" : "Utilities" };
  if (!primary && /transfer to (sav|savings)|to savings/i.test(label)) return { type: "expense", category: "Savings" };
  if (!primary && /online transfer|xfer|transfer to/i.test(label)) return { type: "expense", category: "Transfer" };
  if (confidence === "LOW" || confidence === "UNKNOWN" || primary === "OTHER") return { type: "expense", category: "Needs a look" };
  return { type: "expense", category: transactionCategory(primary, detail) };
}

function transactionCategory(primary?: string | null, detailed?: string | null): string {
  const category = (primary || "").toUpperCase();
  const detail = (detailed || "").toUpperCase();
  if (detail === "RENT_AND_UTILITIES_RENT") return "Rent";
  if (detail.includes("UTILIT") || category === "UTILITIES") return "Utilities";
  if (detail.includes("GROCER") || category === "GROCERIES") return "Groceries";
  if (detail.includes("RESTAURANT") || detail.includes("COFFEE") || category === "FOOD_AND_DRINK") return "Dining out";
  if (category === "TRANSPORTATION") return "Transportation";
  if (category === "PERSONAL_CARE") return "Personal care";
  if (detail.includes("SUBSCRIPTION") || category === "ENTERTAINMENT") return "Subscriptions";
  return "Shopping";
}

/** Turns Plaid's error into a plain-words reason the app can show (never includes keys or tokens). */
function plaidReason(error: unknown, fallback: string): string {
  const message = String((error as Error)?.message || "");
  if (/credentials are not configured/i.test(message)) return "Bank connections aren't set up yet: PLAID_CLIENT_ID or PLAID_SECRET is missing in Replit Secrets.";
  const data = (error as { response?: { data?: { error_code?: string; error_message?: string } } })?.response?.data;
  const code = data?.error_code || "";
  const env = process.env.PLAID_ENV === "production" ? "production" : "sandbox";
  if (code === "INVALID_API_KEYS") return `Plaid didn't accept the keys. PLAID_ENV is "${env}", so PLAID_SECRET must be your ${env} secret from the Plaid Dashboard (each environment has its own secret).`;
  if (/redirect/i.test(data?.error_message || "")) return "PLAID_REDIRECT_URI doesn't match the Plaid Dashboard. Add it exactly (including https:// and /plaid-oauth) under Developers > API > Allowed redirect URIs, or remove the secret for now.";
  if (code === "INVALID_PRODUCT" || code === "PRODUCTS_NOT_SUPPORTED" || code === "PRODUCT_NOT_ENABLED") return "Transactions isn't enabled on your Plaid account for this environment yet. Check your Plaid Dashboard or request access.";
  if (code === "UNAUTHORIZED_ENVIRONMENT" || code === "INVALID_ENVIRONMENT") return "Your Plaid account isn't approved for production yet. Set PLAID_ENV to sandbox for now, or finish Plaid's production request.";
  if (code === "RATE_LIMIT_EXCEEDED") return "Plaid is rate limiting right now. Try again in a minute.";
  if (code) return `${fallback} (Plaid: ${code}${data?.error_message ? `, ${data.error_message}` : ""})`;
  return fallback;
}

router.post("/plaid/link-token", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  try {
    const response = await plaidClient().linkTokenCreate({
      user: { client_user_id: req.dbUser.id },
      client_name: "Margo",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
      // Lets big banks (Chase, Bank of America, Wells Fargo...) send people back to Margo after they sign in.
      // Must exactly match an Allowed redirect URI in the Plaid Dashboard, e.g. https://your-app.replit.app/plaid-oauth
      ...(process.env.PLAID_REDIRECT_URI ? { redirect_uri: process.env.PLAID_REDIRECT_URI } : {}),
    });
    res.json({ linkToken: response.data.link_token });
  } catch (error) {
    const reason = plaidReason(error, "Could not start a bank connection.");
    req.log.error({ plaid: (error as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code, reason }, "Could not create Plaid Link token");
    res.status(502).json({ error: reason });
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
      userId: req.dbUser.id, itemId: exchange.data.item_id, accessTokenEncrypted: encryptToken(exchange.data.access_token),
      institutionId, institutionName,
    }).returning({ id: plaidItemsTable.id });
    res.status(201).json({ connected: true, itemId: item?.id });
  } catch (error) {
    req.log.error("Could not exchange Plaid public token");
    res.status(502).json({ error: plaidReason(error, "Could not finish the bank connection.") });
  }
});

router.get("/plaid/items", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const items = await db.select({ id: plaidItemsTable.id, institutionName: plaidItemsTable.institutionName, lastSyncAt: plaidItemsTable.lastSyncAt })
    .from(plaidItemsTable).where(eq(plaidItemsTable.userId, req.dbUser.id));
  res.json(items);
});

type PlaidItemRow = typeof plaidItemsTable.$inferSelect;

async function syncItem(userId: string, item: PlaidItemRow): Promise<number> {
  const client = plaidClient();
  const [incomeRows, payerPreferences] = await Promise.all([
    db.select({ label: transactionsTable.label, amount: transactionsTable.amount })
      .from(transactionsTable)
      .where(and(eq(transactionsTable.userId, userId), eq(transactionsTable.type, "income"), eq(transactionsTable.source, "Plaid"), eq(transactionsTable.category, "Income"))),
    db.select().from(incomePayerPreferencesTable).where(eq(incomePayerPreferencesTable.userId, userId)),
  ]);
  const incomeHistory = incomeRows.map((row) => ({ label: row.label, amount: Number(row.amount) }));
  const preferences = new Map(payerPreferences.map((row) => [row.payerKey, row.decision]));
  const rules = new Map((await db.select().from(payeeRulesTable).where(eq(payeeRulesTable.userId, userId))).map((rule) => [rule.payeeKey, rule.category]));
  // When the sorting rules improve, go through the bank's full history once more so old transactions get re-sorted.
  const resort = (item.sortVersion ?? 0) < PLAID_SORT_VERSION;
  let cursor = resort ? undefined : item.cursor || undefined;
  let hasMore = true;
  let imported = 0;
  while (hasMore) {
    const page = await client.transactionsSync({ access_token: decryptToken(item.accessTokenEncrypted), cursor, count: 500 });
    const allKnownIncome = [...incomeHistory, ...page.data.added.filter((tx) => tx.amount < 0).map((tx) => ({ label: tx.merchant_name || tx.name || "Bank transaction", amount: Math.abs(tx.amount) }))];
    for (const tx of page.data.added) {
      const sorted = sortTransaction(tx, rules);
      const expense = sorted.type === "expense";
      const label = (tx.merchant_name || tx.name || "Bank transaction").slice(0, 120);
      const realIncome = !expense && sorted.category === "Income";
      const review = !realIncome ? { incomePayerKey: null, incomeReviewStatus: "none" as const, isTaxable: false } : classifyIncome(label, Math.abs(tx.amount), allKnownIncome, preferences);
      await db.insert(transactionsTable).values({
        userId: userId,
        type: expense ? "expense" : "income",
        label,
        amount: Math.abs(tx.amount),
        category: sorted.category,
        date: tx.date,
        ...review,
        source: "Plaid",
        plaidTransactionId: tx.transaction_id,
      }).onConflictDoUpdate({
        target: [transactionsTable.userId, transactionsTable.plaidTransactionId],
        set: {
          type: expense ? "expense" : "income", label,
          amount: Math.abs(tx.amount), category: sorted.category,
          date: tx.date, source: "Plaid", ...review,
        },
      });
      imported += 1;
      if (realIncome) incomeHistory.push({ label, amount: Math.abs(tx.amount) });
    }
    for (const tx of page.data.modified) {
      const sorted = sortTransaction(tx, rules);
      await db.update(transactionsTable).set({
        type: sorted.type, label: (tx.merchant_name || tx.name || "Bank transaction").slice(0, 120),
        amount: Math.abs(tx.amount), category: sorted.category,
        date: tx.date,
      }).where(and(eq(transactionsTable.userId, userId), eq(transactionsTable.plaidTransactionId, tx.transaction_id)));
    }
    for (const removed of page.data.removed) {
      await db.delete(transactionsTable).where(and(eq(transactionsTable.userId, userId), eq(transactionsTable.plaidTransactionId, removed.transaction_id)));
    }
    cursor = page.data.next_cursor;
    hasMore = page.data.has_more;
  }
  await db.update(plaidItemsTable).set({ cursor: cursor || null, lastSyncAt: new Date(), sortVersion: PLAID_SORT_VERSION }).where(eq(plaidItemsTable.id, item.id));
  await refreshAccounts(userId, item).catch(() => { /* balances are best-effort; transactions already synced */ });
  return imported;
}

/* ---------------- When Margo asks "what was this?" ---------------- */
const SORT_CHOICES = ["Rent", "Debt payment", "Savings", "Transfer", "Groceries", "Dining out", "Shopping", "Personal care", "Beauty", "Transportation", "Subscriptions", "Utilities", "Gifts", "Other spending"];

/** The person tells Margo what a transaction was. With remember, the same payee is sorted that way from now on. */
router.post("/transactions/:id/sort", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const category = String(req.body?.category || "");
  if (!SORT_CHOICES.includes(category)) { res.status(400).json({ error: "Pick one of the options." }); return; }
  const [tx] = await db.select().from(transactionsTable).where(and(eq(transactionsTable.id, String(req.params.id)), eq(transactionsTable.userId, req.dbUser.id))).limit(1);
  if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
  await db.update(transactionsTable).set({ category }).where(eq(transactionsTable.id, tx.id));
  let alsoSorted = 0;
  if (req.body?.remember !== false && tx.type === "expense") {
    const payeeKey = normalizePayer(tx.label);
    if (payeeKey) {
      await db.insert(payeeRulesTable).values({ userId: req.dbUser.id, payeeKey, category })
        .onConflictDoUpdate({ target: [payeeRulesTable.userId, payeeRulesTable.payeeKey], set: { category } });
      // Sort the other open questions for the same payee the same way.
      const others = await db.select({ id: transactionsTable.id, label: transactionsTable.label }).from(transactionsTable)
        .where(and(eq(transactionsTable.userId, req.dbUser.id), eq(transactionsTable.category, "Needs a look")));
      const same = others.filter((row) => normalizePayer(row.label) === payeeKey).map((row) => row.id);
      if (same.length) { await db.update(transactionsTable).set({ category }).where(inArray(transactionsTable.id, same)); alsoSorted = same.length; }
    }
  }
  res.json({ ok: true, category, alsoSorted });
});

/* ---------------- Balances ---------------- */
const SAVINGS_SUBTYPES = ["savings", "money market", "cd", "cash management", "hsa"];
const num = (value: string | null | undefined) => (value == null ? null : Number(value));
const today = () => new Date().toISOString().slice(0, 10);

/** Reads each account's latest balance from the bank (included with Transactions, no extra cost) and keeps one snapshot a day. */
async function refreshAccounts(userId: string, item: { id: string; accessTokenEncrypted: string }) {
  const { data } = await plaidClient().accountsGet({ access_token: decryptToken(item.accessTokenEncrypted) });
  for (const account of data.accounts) {
    const values = {
      userId, plaidItemId: item.id, accountId: account.account_id,
      name: (account.official_name || account.name || "Account").slice(0, 160), mask: account.mask?.slice(0, 8) ?? null,
      type: String(account.type).slice(0, 24), subtype: account.subtype ? String(account.subtype).slice(0, 40) : null,
      current: account.balances.current != null ? account.balances.current.toFixed(2) : null,
      available: account.balances.available != null ? account.balances.available.toFixed(2) : null,
      creditLimit: account.balances.limit != null ? account.balances.limit.toFixed(2) : null,
      updatedAt: new Date(),
    };
    const [saved] = await db.insert(bankAccountsTable).values(values).onConflictDoUpdate({
      target: bankAccountsTable.accountId,
      set: { name: values.name, mask: values.mask, type: values.type, subtype: values.subtype, current: values.current, available: values.available, creditLimit: values.creditLimit, updatedAt: values.updatedAt },
    }).returning();
    if (saved && values.current != null) {
      await db.insert(balanceSnapshotsTable).values({ accountId: saved.id, day: today(), current: values.current })
        .onConflictDoUpdate({ target: [balanceSnapshotsTable.accountId, balanceSnapshotsTable.day], set: { current: values.current } });
    }
  }
}

export function isSavings(account: { type: string; subtype: string | null }) {
  return account.type === "depository" && SAVINGS_SUBTYPES.includes((account.subtype || "").toLowerCase());
}
export function isDebt(account: { type: string }) {
  return account.type === "credit" || account.type === "loan";
}

/**
 * Real savings this month: how much the savings balances went up, compared with the last balance before the month began
 * (or the first one we saw this month, if the bank was connected mid-month).
 */
async function savingsProgress(accounts: Array<{ id: string; type: string; subtype: string | null; current: string | null }>) {
  const savings = accounts.filter(isSavings);
  if (!savings.length) return null;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  let total = 0, start = 0, sinceConnected = false;
  // Look up every savings account's starting balance at the same time.
  const starts = await Promise.all(savings.map(async (account) => {
    const current = num(account.current) ?? 0;
    const [[before], [first]] = await Promise.all([
      db.select().from(balanceSnapshotsTable).where(and(eq(balanceSnapshotsTable.accountId, account.id), lt(balanceSnapshotsTable.day, monthStart))).orderBy(desc(balanceSnapshotsTable.day)).limit(1),
      db.select().from(balanceSnapshotsTable).where(and(eq(balanceSnapshotsTable.accountId, account.id), gte(balanceSnapshotsTable.day, monthStart))).orderBy(asc(balanceSnapshotsTable.day)).limit(1),
    ]);
    return { current, start: before ? Number(before.current) : first ? Number(first.current) : current, connectedThisMonth: !before };
  }));
  for (const row of starts) { total += row.current; start += row.start; if (row.connectedThisMonth) sinceConnected = true; }
  return { total: Math.round(total * 100) / 100, changeThisMonth: Math.round((total - start) * 100) / 100, sinceConnected };
}

router.get("/accounts", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const rows = await db.select().from(bankAccountsTable).where(eq(bankAccountsTable.userId, req.dbUser.id)).orderBy(asc(bankAccountsTable.type), asc(bankAccountsTable.name));
  const items = rows.length ? await db.select({ id: plaidItemsTable.id, institutionName: plaidItemsTable.institutionName }).from(plaidItemsTable).where(inArray(plaidItemsTable.id, [...new Set(rows.map((row) => row.plaidItemId))])) : [];
  const bank = new Map(items.map((item) => [item.id, item.institutionName]));
  const visible = rows.filter((row) => !row.hidden);
  res.json({
    accounts: visible.map((row) => ({
      id: row.id, name: row.name, mask: row.mask, type: row.type, subtype: row.subtype, institution: bank.get(row.plaidItemId) || null,
      current: num(row.current), available: num(row.available), creditLimit: num(row.creditLimit),
      apr: num(row.apr), minPayment: num(row.minPayment), isSavings: isSavings(row), isDebt: isDebt(row), updatedAt: row.updatedAt,
    })),
    savings: await savingsProgress(visible),
  });
});

/** The person sets a debt's interest rate or minimum payment, or hides an account. */
router.patch("/accounts/:id", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const body = req.body ?? {};
  const set: Partial<typeof bankAccountsTable.$inferInsert> = {};
  const pct = Number(body.apr), min = Number(body.minPayment);
  if (body.apr === null) set.apr = null; else if (body.apr !== undefined) { if (!Number.isFinite(pct) || pct < 0 || pct > 99) { res.status(400).json({ error: "Interest rate should be between 0 and 99%." }); return; } set.apr = pct.toFixed(2); }
  if (body.minPayment === null) set.minPayment = null; else if (body.minPayment !== undefined) { if (!Number.isFinite(min) || min < 0 || min > 100000) { res.status(400).json({ error: "Check the minimum payment." }); return; } set.minPayment = min.toFixed(2); }
  if (typeof body.hidden === "boolean") set.hidden = body.hidden;
  if (!Object.keys(set).length) { res.status(400).json({ error: "Nothing to change." }); return; }
  const [saved] = await db.update(bankAccountsTable).set(set).where(and(eq(bankAccountsTable.id, String(req.params.id)), eq(bankAccountsTable.userId, req.dbUser.id))).returning();
  if (!saved) { res.status(404).json({ error: "Account not found" }); return; }
  res.json({ ok: true });
});

/** Fetches fresh balances from every connected bank. */
router.post("/accounts/refresh", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const items = await db.select().from(plaidItemsTable).where(eq(plaidItemsTable.userId, req.dbUser.id));
  let failed = 0;
  for (const item of items) { try { await refreshAccounts(req.dbUser.id, item); } catch { failed += 1; } }
  res.json({ banks: items.length, failed });
});

router.post("/plaid/sync", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const itemId = typeof req.body?.itemId === "string" ? req.body.itemId : "";
  const [item] = await db.select().from(plaidItemsTable).where(and(eq(plaidItemsTable.id, itemId), eq(plaidItemsTable.userId, req.dbUser.id)));
  if (!item) { res.status(404).json({ error: "Connected bank not found" }); return; }
  try {
    res.json({ imported: await syncItem(req.dbUser.id, item) });
  } catch {
    req.log.error("Could not sync bank transactions");
    res.status(502).json({ error: "Could not sync transactions. Try again shortly." });
  }
});

// Refreshes every connected bank that hasn't synced in the last few hours. The app calls this when it opens.
router.post("/plaid/sync-all", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const staleBefore = Date.now() - 4 * 60 * 60 * 1000;
  const items = await db.select().from(plaidItemsTable).where(eq(plaidItemsTable.userId, req.dbUser.id));
  let imported = 0, refreshed = 0, failed = 0;
  for (const item of items) {
    // A bank whose history hasn't been sorted with the newest rules syncs now, even if it synced recently.
    if (item.lastSyncAt && item.lastSyncAt.getTime() > staleBefore && (item.sortVersion ?? 0) >= PLAID_SORT_VERSION) {
      // Transactions are fresh, but make sure there's a balance snapshot for today.
      const [account] = await db.select({ id: bankAccountsTable.id }).from(bankAccountsTable).where(eq(bankAccountsTable.plaidItemId, item.id)).limit(1);
      const [snap] = account ? await db.select().from(balanceSnapshotsTable).where(and(eq(balanceSnapshotsTable.accountId, account.id), eq(balanceSnapshotsTable.day, today()))).limit(1) : [];
      if (!snap) await refreshAccounts(req.dbUser.id, item).catch(() => undefined);
      continue;
    }
    try { imported += await syncItem(req.dbUser.id, item); refreshed += 1; } catch { failed += 1; req.log.warn("Could not refresh one connected bank"); }
  }
  res.json({ banks: items.length, refreshed, failed, imported });
});

router.delete("/plaid/items/:id", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const [item] = await db.select().from(plaidItemsTable).where(and(eq(plaidItemsTable.id, req.params.id as string), eq(plaidItemsTable.userId, req.dbUser.id)));
  if (!item) { res.status(404).json({ error: "Connected bank not found" }); return; }
  try {
    await plaidClient().itemRemove({ access_token: decryptToken(item.accessTokenEncrypted) });
  } catch {
    req.log.warn("Plaid could not revoke an item during local disconnect");
  }
  await db.delete(plaidItemsTable).where(and(eq(plaidItemsTable.id, req.params.id as string), eq(plaidItemsTable.userId, req.dbUser.id)));
  res.sendStatus(204);
});

/** Tells Plaid to cut off Margo's access to every bank this person connected. Used when they delete their data. */
export async function revokeAllPlaidItems(userId: string): Promise<void> {
  const items = await db.select().from(plaidItemsTable).where(eq(plaidItemsTable.userId, userId));
  for (const item of items) {
    try { await plaidClient().itemRemove({ access_token: decryptToken(item.accessTokenEncrypted) }); } catch { /* already revoked or Plaid unreachable; the local copy is still deleted */ }
  }
}

export default router;
