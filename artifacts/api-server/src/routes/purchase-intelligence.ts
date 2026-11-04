import {
  GetProductAlternativesParams, GetProductAlternativesResponse,
  GetPurchaseHistoryResponse, ProductVote,
  VoteOnProductAlternativeBody, VoteOnProductAlternativeParams,
  VoteOnProductAlternativeResponse,
} from "@workspace/api-zod";
import {
  affiliateLinksTable, db, productAlternativesTable, productVotesTable,
  productsTable, userProductPurchasesTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();
function requireUser(req: Request, res: Response): req is Request & { user: Express.User } {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Authentication required" }); return false; }
  return true;
}

router.get("/purchase-history", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const rows = await db.select({
    id: userProductPurchasesTable.id,
    productId: userProductPurchasesTable.productId,
    productName: sql<string>`coalesce(${productsTable.name}, ${userProductPurchasesTable.productNameSnapshot})`,
    brand: sql<string>`coalesce(${productsTable.brand}, '')`,
    category: sql<string>`coalesce(${productsTable.category}, 'Other')`,
    unitPrice: userProductPurchasesTable.unitPrice,
    quantity: userProductPurchasesTable.quantity,
    purchasedAt: userProductPurchasesTable.purchasedAt,
    source: userProductPurchasesTable.source,
  }).from(userProductPurchasesTable)
    .leftJoin(productsTable, eq(userProductPurchasesTable.productId, productsTable.id))
    .where(eq(userProductPurchasesTable.userId, req.user.id))
    .orderBy(sql`${userProductPurchasesTable.purchasedAt} desc`);
  res.json(GetPurchaseHistoryResponse.parse(rows.map((row) => ({
    ...row, purchasedAt: new Date(`${row.purchasedAt}T00:00:00.000Z`),
  }))));
});

router.get("/products/:productId/alternatives", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const params = GetProductAlternativesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const rows = await db.select({
    id: productAlternativesTable.id,
    productId: productAlternativesTable.alternativeProductId,
    name: productsTable.name,
    brand: productsTable.brand,
    category: productsTable.category,
    similarityScore: productAlternativesTable.similarityScore,
    savingsScore: productAlternativesTable.savingsScore,
    isVerified: productAlternativesTable.isVerified,
  }).from(productAlternativesTable)
    .innerJoin(productsTable, eq(productAlternativesTable.alternativeProductId, productsTable.id))
    .where(eq(productAlternativesTable.productId, params.data.productId));
  const ids = rows.map((row) => row.id);
  const [votes, links] = ids.length ? await Promise.all([
    db.select({
      alternativeId: productVotesTable.alternativeId,
      positiveVotes: sql<number>`count(*) filter (where ${productVotesTable.vote} = 1)::int`,
      negativeVotes: sql<number>`count(*) filter (where ${productVotesTable.vote} = -1)::int`,
    }).from(productVotesTable).where(sql`${productVotesTable.alternativeId} = any(${ids}::uuid[])`).groupBy(productVotesTable.alternativeId),
    db.select({ productId: affiliateLinksTable.productId, affiliateUrl: affiliateLinksTable.affiliateUrl })
      .from(affiliateLinksTable).where(and(eq(affiliateLinksTable.active, true), sql`${affiliateLinksTable.productId} = any(${rows.map((row) => row.productId)}::uuid[])`)),
  ]) : [[], []];
  const voteMap = new Map(votes.map((row) => [row.alternativeId, row]));
  const linkMap = new Map(links.map((row) => [row.productId, row.affiliateUrl]));
  res.json(GetProductAlternativesResponse.parse(rows.map((row) => ({
    ...row,
    positiveVotes: voteMap.get(row.id)?.positiveVotes ?? 0,
    negativeVotes: voteMap.get(row.id)?.negativeVotes ?? 0,
    affiliateUrl: linkMap.get(row.productId) ?? null,
  }))));
});

router.put("/product-alternatives/:alternativeId/vote", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const params = VoteOnProductAlternativeParams.safeParse(req.params);
  const body = VoteOnProductAlternativeBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid alternative vote" }); return; }
  await db.insert(productVotesTable).values({
    alternativeId: params.data.alternativeId, userId: req.user.id, vote: body.data.vote,
  }).onConflictDoUpdate({
    target: [productVotesTable.alternativeId, productVotesTable.userId],
    set: { vote: body.data.vote },
  });
  res.json(VoteOnProductAlternativeResponse.parse({
    alternativeId: params.data.alternativeId, vote: body.data.vote,
  } satisfies ProductVote));
});

export default router;
