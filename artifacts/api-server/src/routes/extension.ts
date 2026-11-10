import {
  CreateExtensionTokenBody, CreateExtensionTokenResponse, ExtensionProductLookupBody,
  ExtensionProductLookupHeader, ExtensionProductLookupResponse, GetExtensionTokensResponse,
  RevokeExtensionTokenParams,
} from "@workspace/api-zod";
import {
  affiliateLinksTable, db, extensionTokensTable, productAlternativesTable,
  productVotesTable, productsTable,
} from "@workspace/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
function requireUser(req: Request, res: Response): boolean {
  if (!req.dbUser) { res.status(401).json({ error: "Authentication required" }); return false; }
  return true;
}

router.get("/extension/tokens", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const rows = await db.select({
    id: extensionTokensTable.id, label: extensionTokensTable.label,
    createdAt: extensionTokensTable.createdAt, expiresAt: extensionTokensTable.expiresAt,
    lastUsedAt: extensionTokensTable.lastUsedAt,
  }).from(extensionTokensTable).where(eq(extensionTokensTable.userId, req.dbUser.id));
  res.json(GetExtensionTokensResponse.parse(rows));
});

router.post("/extension/tokens", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const body = CreateExtensionTokenBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const existing = await db.select({ id: extensionTokensTable.id }).from(extensionTokensTable)
    .where(eq(extensionTokensTable.userId, req.dbUser.id));
  if (existing.length >= 5) { res.status(409).json({ error: "You can have up to five extension tokens" }); return; }
  const token = `alienext_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const [created] = await db.insert(extensionTokensTable).values({
    userId: req.dbUser.id, tokenHash: hashToken(token), label: body.data.label.trim(), expiresAt,
  }).returning({
    id: extensionTokensTable.id, label: extensionTokensTable.label,
    createdAt: extensionTokensTable.createdAt, expiresAt: extensionTokensTable.expiresAt,
  });
  if (!created) { res.status(500).json({ error: "Could not create extension token" }); return; }
  res.status(201).json(CreateExtensionTokenResponse.parse({ ...created, token }));
});

router.delete("/extension/tokens/:tokenId", async (req, res): Promise<void> => {
  if (!requireUser(req, res)) return;
  const params = RevokeExtensionTokenParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const deleted = await db.delete(extensionTokensTable).where(and(
    eq(extensionTokensTable.id, params.data.tokenId), eq(extensionTokensTable.userId, req.dbUser.id),
  )).returning({ id: extensionTokensTable.id });
  if (!deleted.length) { res.status(404).json({ error: "Extension token not found" }); return; }
  res.status(204).end();
});

router.post("/extension/lookup", async (req, res): Promise<void> => {
  const header = ExtensionProductLookupHeader.safeParse({ Authorization: req.headers.authorization });
  const body = ExtensionProductLookupBody.safeParse(req.body);
  const bearer = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!header.success || !bearer) { res.status(401).json({ error: "Extension token required" }); return; }
  if (!body.success || (!body.data.barcode && !body.data.productName)) {
    res.status(400).json({ error: "Provide a product name or barcode" }); return;
  }
  const [token] = await db.select({ id: extensionTokensTable.id }).from(extensionTokensTable).where(and(
    eq(extensionTokensTable.tokenHash, hashToken(bearer)), gt(extensionTokensTable.expiresAt, new Date()),
  )).limit(1);
  if (!token) { res.status(401).json({ error: "Invalid or expired extension token" }); return; }
  await db.update(extensionTokensTable).set({ lastUsedAt: new Date() }).where(eq(extensionTokensTable.id, token.id));
  const productQuery = body.data.barcode
    ? db.select().from(productsTable).where(eq(productsTable.barcode, body.data.barcode)).limit(1)
    : db.select().from(productsTable).where(eq(
      productsTable.normalizedName,
      (body.data.productName ?? "").trim().toLowerCase().replace(/\s+/g, " "),
    )).limit(1);
  const [product] = await productQuery;
  if (!product) {
    res.json(ExtensionProductLookupResponse.parse({ matchedProduct: null, alternatives: [] }));
    return;
  }
  const alternatives = await db.select({
    id: productAlternativesTable.id, productId: productAlternativesTable.alternativeProductId,
    name: productsTable.name, brand: productsTable.brand, category: productsTable.category,
    similarityScore: productAlternativesTable.similarityScore, savingsScore: productAlternativesTable.savingsScore,
    isVerified: productAlternativesTable.isVerified,
  }).from(productAlternativesTable)
    .innerJoin(productsTable, eq(productAlternativesTable.alternativeProductId, productsTable.id))
    .where(eq(productAlternativesTable.productId, product.id));
  const ids = alternatives.map((item) => item.id);
  const altProductIds = alternatives.map((item) => item.productId);
  const [votes, links] = ids.length ? await Promise.all([
    db.select({
      alternativeId: productVotesTable.alternativeId,
      positiveVotes: sql<number>`count(*) filter (where ${productVotesTable.vote} = 1)::int`,
      negativeVotes: sql<number>`count(*) filter (where ${productVotesTable.vote} = -1)::int`,
    }).from(productVotesTable)
      .where(sql`${productVotesTable.alternativeId} = any(${ids}::uuid[])`).groupBy(productVotesTable.alternativeId),
    db.select({ productId: affiliateLinksTable.productId, affiliateUrl: affiliateLinksTable.affiliateUrl })
      .from(affiliateLinksTable).where(and(
        eq(affiliateLinksTable.active, true),
        sql`${affiliateLinksTable.productId} = any(${altProductIds}::uuid[])`,
      )),
  ]) : [[], []];
  const voteMap = new Map(votes.map((item) => [item.alternativeId, item]));
  const linkMap = new Map(links.map((item) => [item.productId, item.affiliateUrl]));
  res.json(ExtensionProductLookupResponse.parse({
    matchedProduct: { id: product.id, name: product.name, brand: product.brand, category: product.category },
    alternatives: alternatives.map((item) => ({
      ...item, positiveVotes: voteMap.get(item.id)?.positiveVotes ?? 0,
      negativeVotes: voteMap.get(item.id)?.negativeVotes ?? 0,
      affiliateUrl: linkMap.get(item.productId) ?? null,
    })),
  }));
});

export default router;
