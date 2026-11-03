import {
  CreateReceiptBody,
  CreateReceiptResponse,
  CreateTransactionBody,
  CreateTransactionResponse,
  BudgetPlan as ApiBudgetPlan,
  GetBudgetPlanResponse,
  DeleteReceiptParams,
  DeleteReceiptResponse,
  DeleteTransactionParams,
  DeleteTransactionResponse,
  FinanceDashboard,
  GetFinanceDashboardResponse,
  GetFinanceSettingsResponse,
  GetProductComparisonsResponse,
  GetReceiptsResponse,
  GetSwapProfileResponse,
  GetTransactionsQueryParams,
  GetTransactionsResponse,
  ProductComparison,
  Receipt as ApiReceipt,
  Transaction as ApiTransaction,
  UpdateBudgetPlanBody,
  UpdateBudgetPlanResponse,
  UpdateFinanceSettingsBody,
  UpdateFinanceSettingsResponse,
  UpdateSwapProfileBody,
  UpdateSwapProfileResponse,
} from "@workspace/api-zod";
import {
  db,
  budgetPlansTable,
  financeSettingsTable,
  receiptsTable,
  emptySwapProfile,
  swapProfilesTable,
  transactionsTable,
  type SwapProfileData,
  type StoredReceiptItem,
  type Transaction as DbTransaction,
} from "@workspace/db";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const spendingCategories = [
  { category: "Housing", weight: 28 },
  { category: "Groceries", weight: 14 },
  { category: "Dining & coffee", weight: 6 },
  { category: "Transportation", weight: 10 },
  { category: "Utilities", weight: 8 },
  { category: "Health", weight: 7 },
  { category: "Debt payments", weight: 7 },
  { category: "Personal care", weight: 4 },
  { category: "Shopping", weight: 5 },
  { category: "Entertainment", weight: 4 },
  { category: "Travel", weight: 3 },
  { category: "Family & giving", weight: 2 },
  { category: "Other", weight: 2 },
] as const;

function requireUser(
  req: Request,
  res: Response,
): req is Request & { user: Express.User } {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
  return true;
}

function serializeTransaction(transaction: DbTransaction): ApiTransaction {
  return {
    ...transaction,
    date: new Date(`${transaction.date}T00:00:00.000Z`),
    createdAt: transaction.createdAt,
  };
}

function serializeReceipt(receipt: typeof receiptsTable.$inferSelect): ApiReceipt {
  return {
    ...receipt,
    purchasedAt: new Date(`${receipt.purchasedAt}T00:00:00.000Z`),
    createdAt: receipt.createdAt,
    items: receipt.items,
  };
}

function buildComparisons(items: StoredReceiptItem[]): ProductComparison[] {
  const categories = new Map<string, Map<string, StoredReceiptItem>>();

  for (const item of items) {
    const category = item.category.trim().toLowerCase();
    const identity = `${item.productName.trim().toLowerCase()}|${(item.brand ?? "").trim().toLowerCase()}`;
    const candidates = categories.get(category) ?? new Map();
    const existing = candidates.get(identity);
    if (!existing || item.unitPrice < existing.unitPrice) {
      candidates.set(identity, item);
    } else if (item.unitsPerYear > existing.unitsPerYear) {
      candidates.set(identity, { ...existing, unitsPerYear: item.unitsPerYear });
    }
    categories.set(category, candidates);
  }

  const suggestions: ProductComparison[] = [];
  for (const [category, candidates] of categories) {
    if (candidates.size < 2) continue;
    const sorted = [...candidates.values()].sort((a, b) => a.unitPrice - b.unitPrice);
    const cheaper = sorted[0];
    const pricier = sorted[sorted.length - 1];
    if (!cheaper || !pricier || cheaper.unitPrice >= pricier.unitPrice) continue;

    const unitsPerYear = Math.min(cheaper.unitsPerYear, pricier.unitsPerYear);
    suggestions.push({
      category: pricier.category,
      productName: pricier.productName,
      brand: pricier.brand,
      unitPrice: pricier.unitPrice,
      alternativeName: cheaper.productName,
      alternativeBrand: cheaper.brand,
      alternativePrice: cheaper.unitPrice,
      unitsPerYear,
      annualSavings: Math.round((pricier.unitPrice - cheaper.unitPrice) * unitsPerYear * 100) / 100,
    });
  }

  return suggestions.sort((a, b) => b.annualSavings - a.annualSavings);
}

async function getUserComparisons(userId: string): Promise<ProductComparison[]> {
  const [receipts, [savedProfile]] = await Promise.all([
    db.select({ items: receiptsTable.items }).from(receiptsTable).where(eq(receiptsTable.userId, userId)),
    db.select({ profile: swapProfilesTable.profile }).from(swapProfilesTable).where(eq(swapProfilesTable.userId, userId)),
  ]);
  const profile = savedProfile?.profile as SwapProfileData | undefined;
  if (!profile?.swapCategories?.length) return [];
  // Current receipt data has no ingredient, certification, shade, or size metadata.
  // Hold suggestions rather than risk violating a preference we cannot verify.
  if (profile.values?.length || profile.dietaryNeeds?.trim() || profile.productPreferences?.trim()) return [];
  const categoryAliases: Record<string, string[]> = {
    beauty: ["beauty", "personal care", "makeup", "skin", "hair"],
    groceries: ["grocery", "groceries", "food", "pantry", "produce"],
    clothes: ["clothes", "clothing", "apparel", "shoes"],
    household: ["household", "cleaning", "home"],
    travel: ["travel"],
    subscriptions: ["subscription", "streaming"],
  };
  const allowed = new Set(profile.swapCategories);
  const normalizedItems = receipts.flatMap((receipt) => receipt.items).filter((item) => {
    const category = item.category.toLowerCase();
    if (!Object.entries(categoryAliases).some(([key, aliases]) => allowed.has(key) && aliases.some((alias) => category.includes(alias)))) return false;
    const searchable = `${item.productName} ${item.brand ?? ""} ${item.category}`.toLowerCase();
    return !(profile.nonNegotiables || []).some((term) => term.trim() && searchable.includes(term.trim().toLowerCase()));
  });
  const comparisons = buildComparisons(normalizedItems);
  if (!profile.favoriteBrands?.length) return comparisons;
  const preferredBrands = new Set(profile.favoriteBrands.map((brand) => brand.trim().toLowerCase()));
  return comparisons.filter((item) => item.alternativeBrand && preferredBrands.has(item.alternativeBrand.trim().toLowerCase()));
}

function buildBudgetPlan(
  annualIncome: number,
  annualSavingsGoal: number,
  monthlyRent: number,
  priorityCategories: string[],
  spendingRows: Array<{ category: string; amount: number }>,
): ApiBudgetPlan {
  const goalFeasible = annualSavingsGoal + monthlyRent * 12 <= annualIncome;
  const monthlyIncomeTarget = Math.round((annualIncome / 12) * 100) / 100;
  const monthlySavingsTarget = Math.round((annualSavingsGoal / 12) * 100) / 100;
  const monthlySpendingTarget = goalFeasible
    ? Math.round((Math.max(0, annualIncome - annualSavingsGoal - monthlyRent * 12) / 12) * 100) / 100
    : 0;
  const priorities = new Set(priorityCategories);
  const weightedCategories = spendingCategories.map((entry) => ({
    ...entry,
    adjustedWeight: entry.weight * (priorities.has(entry.category) ? 1.4 : 1),
  }));
  const totalWeight = weightedCategories.reduce((sum, entry) => sum + entry.adjustedWeight, 0);
  const spendingByCategory = new Map<string, number>();
  for (const row of spendingRows) {
    const match = spendingCategories.find(
      (entry) => entry.category.toLowerCase() === row.category.trim().toLowerCase(),
    );
    const category = match?.category ?? "Other";
    spendingByCategory.set(category, (spendingByCategory.get(category) ?? 0) + row.amount);
  }

  let allocated = 0;
  const categories = weightedCategories.map((entry, index) => {
    const sharePercent = (entry.adjustedWeight / totalWeight) * 100;
    const monthlyTarget = index === weightedCategories.length - 1
      ? Math.round((monthlySpendingTarget - allocated) * 100) / 100
      : Math.round((monthlySpendingTarget * sharePercent / 100) * 100) / 100;
    allocated += monthlyTarget;
    return {
      category: entry.category,
      monthlyTarget,
      spentThisMonth: Math.round((spendingByCategory.get(entry.category) ?? 0) * 100) / 100,
      priority: priorities.has(entry.category),
      sharePercent: Math.round(sharePercent * 10) / 10,
    };
  });

  return {
    annualIncome,
    annualSavingsGoal,
    monthlyRent,
    priorityCategories,
    monthlyIncomeTarget,
    monthlySavingsTarget,
    monthlySpendingTarget,
    goalFeasible,
    categories,
  };
}

async function getBudgetPlanForUser(userId: string): Promise<ApiBudgetPlan> {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [savedPlans, spendingRows] = await Promise.all([
    db.select().from(budgetPlansTable).where(eq(budgetPlansTable.userId, userId)),
    db
      .select({ category: transactionsTable.category, amount: transactionsTable.amount })
      .from(transactionsTable)
      .where(and(
        eq(transactionsTable.userId, userId),
        eq(transactionsTable.type, "expense"),
        gte(transactionsTable.date, monthStart),
        lte(transactionsTable.date, today),
      )),
  ]);
  const saved = savedPlans[0];
  return buildBudgetPlan(
    saved?.annualIncome ?? 0,
    saved?.annualSavingsGoal ?? 0,
    saved?.monthlyRent ?? 0,
    saved?.priorityCategories ?? [],
    spendingRows,
  );
}

router.get("/finance/dashboard", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const [monthlyExpenses, yearIncome, recent, settings, comparisons] = await Promise.all([
    db
      .select({ amount: transactionsTable.amount })
      .from(transactionsTable)
      .where(and(
        eq(transactionsTable.userId, req.user.id),
        eq(transactionsTable.type, "expense"),
        gte(transactionsTable.date, monthStart),
        lte(transactionsTable.date, today),
      )),
    db
      .select({ amount: transactionsTable.amount })
      .from(transactionsTable)
      .where(and(
        eq(transactionsTable.userId, req.user.id),
        eq(transactionsTable.type, "income"),
        eq(transactionsTable.isTaxable, true),
        gte(transactionsTable.date, yearStart),
        lte(transactionsTable.date, today),
      )),
    db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.userId, req.user.id))
      .orderBy(desc(transactionsTable.date), desc(transactionsTable.createdAt))
      .limit(8),
    db
      .select()
      .from(financeSettingsTable)
      .where(eq(financeSettingsTable.userId, req.user.id)),
    getUserComparisons(req.user.id),
  ]);
  const [savedSettings] = settings;
  const taxReserveRate = savedSettings?.taxReserveRate ?? 25;
  const taxableIncomeThisYear = yearIncome.reduce((total, row) => total + row.amount, 0);
  const dashboard: FinanceDashboard = {
    monthlySpending: monthlyExpenses.reduce((total, row) => total + row.amount, 0),
    taxableIncomeThisYear,
    taxSetAside: Math.round(taxableIncomeThisYear * (taxReserveRate / 100) * 100) / 100,
    annualSavings: comparisons.reduce((total, comparison) => total + comparison.annualSavings, 0),
    recentTransactions: recent.map(serializeTransaction),
  };

  res.json(GetFinanceDashboardResponse.parse(dashboard));
});

router.get("/transactions", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const query = GetTransactionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const filters = [eq(transactionsTable.userId, req.user.id)];
  if (query.data.type) filters.push(eq(transactionsTable.type, query.data.type));
  const rows = await db
    .select()
    .from(transactionsTable)
    .where(and(...filters))
    .orderBy(desc(transactionsTable.date), desc(transactionsTable.createdAt));
  res.json(GetTransactionsResponse.parse(rows.map(serializeTransaction)));
});

router.post("/transactions", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const parsed = CreateTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [transaction] = await db
    .insert(transactionsTable)
    .values({
      ...parsed.data,
      date: parsed.data.date.toISOString().slice(0, 10),
      source: parsed.data.source ?? null,
      userId: req.user.id,
    })
    .returning();
  if (!transaction) {
    res.status(500).json({ error: "Could not save transaction" });
    return;
  }
  res.status(201).json(CreateTransactionResponse.parse(serializeTransaction(transaction)));
});

router.delete("/transactions/:id", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const params = DeleteTransactionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(transactionsTable)
    .where(and(
      eq(transactionsTable.id, params.data.id),
      eq(transactionsTable.userId, req.user.id),
    ))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  DeleteTransactionResponse.parse(undefined);
  res.sendStatus(204);
});

router.get("/settings", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const [settings] = await db
    .select()
    .from(financeSettingsTable)
    .where(eq(financeSettingsTable.userId, req.user.id));
  res.json(GetFinanceSettingsResponse.parse({
    taxReserveRate: settings?.taxReserveRate ?? 25,
  }));
});

router.put("/settings", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const parsed = UpdateFinanceSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [settings] = await db
    .insert(financeSettingsTable)
    .values({ userId: req.user.id, taxReserveRate: parsed.data.taxReserveRate })
    .onConflictDoUpdate({
      target: financeSettingsTable.userId,
      set: { taxReserveRate: parsed.data.taxReserveRate, updatedAt: new Date() },
    })
    .returning();
  res.json(UpdateFinanceSettingsResponse.parse({
    taxReserveRate: settings?.taxReserveRate ?? parsed.data.taxReserveRate,
  }));
});

router.get("/budget-plan", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const plan = await getBudgetPlanForUser(req.user.id);
  res.json(GetBudgetPlanResponse.parse(plan));
});

router.put("/budget-plan", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const parsed = UpdateBudgetPlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await db
    .insert(budgetPlansTable)
    .values({
      userId: req.user.id,
      annualIncome: parsed.data.annualIncome,
      annualSavingsGoal: parsed.data.annualSavingsGoal,
      monthlyRent: parsed.data.monthlyRent,
      priorityCategories: parsed.data.priorityCategories,
    })
    .onConflictDoUpdate({
      target: budgetPlansTable.userId,
      set: {
        annualIncome: parsed.data.annualIncome,
        annualSavingsGoal: parsed.data.annualSavingsGoal,
        monthlyRent: parsed.data.monthlyRent,
        priorityCategories: parsed.data.priorityCategories,
        updatedAt: new Date(),
      },
    });
  const plan = await getBudgetPlanForUser(req.user.id);
  res.json(UpdateBudgetPlanResponse.parse(plan));
});

router.get("/swap-profile", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const [saved] = await db.select({ profile: swapProfilesTable.profile }).from(swapProfilesTable).where(eq(swapProfilesTable.userId, req.user.id));
  res.json(GetSwapProfileResponse.parse(saved?.profile ?? emptySwapProfile));
});

router.put("/swap-profile", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const parsed = UpdateSwapProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const profile = parsed.data;
  await db.insert(swapProfilesTable).values({ userId: req.user.id, profile }).onConflictDoUpdate({
    target: swapProfilesTable.userId,
    set: { profile, updatedAt: new Date() },
  });
  res.json(UpdateSwapProfileResponse.parse(profile));
});

router.get("/receipts", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const rows = await db
    .select()
    .from(receiptsTable)
    .where(eq(receiptsTable.userId, req.user.id))
    .orderBy(desc(receiptsTable.purchasedAt), desc(receiptsTable.createdAt));
  res.json(GetReceiptsResponse.parse(rows.map(serializeReceipt)));
});

router.post("/receipts", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const parsed = CreateReceiptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const objectPath = parsed.data.objectPath ?? null;
  if (objectPath && !objectPath.startsWith("/objects/")) {
    res.status(400).json({ error: "Invalid receipt image path" });
    return;
  }
  try {
    if (objectPath) {
      await objectStorageService.trySetObjectEntityAclPolicy(objectPath, {
        owner: req.user.id,
        visibility: "private",
      });
    }
  } catch (error) {
    req.log.warn({ err: error }, "Could not secure receipt image");
    res.status(400).json({ error: "Receipt image is not available yet" });
    return;
  }

  const [receipt] = await db
    .insert(receiptsTable)
    .values({
      userId: req.user.id,
      merchant: parsed.data.merchant,
      purchasedAt: parsed.data.purchasedAt.toISOString().slice(0, 10),
      total: parsed.data.total,
      objectPath,
      items: parsed.data.items.map((item) => ({
        ...item,
        brand: item.brand ?? null,
      })),
    })
    .returning();
  if (!receipt) {
    res.status(500).json({ error: "Could not save receipt" });
    return;
  }
  res.status(201).json(CreateReceiptResponse.parse(serializeReceipt(receipt)));
});

router.delete("/receipts/:id", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const params = DeleteReceiptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [receipt] = await db
    .select()
    .from(receiptsTable)
    .where(and(
      eq(receiptsTable.id, params.data.id),
      eq(receiptsTable.userId, req.user.id),
    ));
  if (!receipt) {
    res.status(404).json({ error: "Receipt not found" });
    return;
  }
  if (receipt.objectPath) {
    try {
      const file = await objectStorageService.getObjectEntityFile(receipt.objectPath);
      await file.delete({ ignoreNotFound: true });
    } catch (error) {
      req.log.warn({ err: error }, "Could not remove receipt image");
    }
  }
  await db
    .delete(receiptsTable)
    .where(and(
      eq(receiptsTable.id, params.data.id),
      eq(receiptsTable.userId, req.user.id),
    ));
  DeleteReceiptResponse.parse(undefined);
  res.sendStatus(204);
});

router.get("/comparisons", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const comparisons = await getUserComparisons(req.user.id);
  res.json(GetProductComparisonsResponse.parse(comparisons));
});

export default router;
