import { sql } from "drizzle-orm";
import {
  boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp,
  uniqueIndex, uuid, varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { receiptsTable, transactionsTable } from "./finance";

export const productsTable = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 180 }).notNull(),
  normalizedName: varchar("normalized_name", { length: 220 }).notNull(),
  brand: varchar("brand", { length: 120 }).notNull().default(""),
  category: varchar("category", { length: 80 }).notNull(),
  barcode: varchar("barcode", { length: 80 }),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("products_normalized_brand_idx").on(table.normalizedName, table.brand),
  uniqueIndex("products_barcode_idx").on(table.barcode),
  index("products_category_idx").on(table.category),
]);

export const productAlternativesTable = pgTable("product_alternatives", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  alternativeProductId: uuid("alternative_product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  similarityScore: numeric("similarity_score", { precision: 5, scale: 2, mode: "number" }).notNull(),
  savingsScore: numeric("savings_score", { precision: 5, scale: 2, mode: "number" }).notNull(),
  evidence: jsonb("evidence").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  isVerified: boolean("is_verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("product_alternatives_pair_idx").on(table.productId, table.alternativeProductId),
  index("product_alternatives_product_idx").on(table.productId, table.similarityScore),
]);

export const userProductPurchasesTable = pgTable("user_product_purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  receiptId: uuid("receipt_id").references(() => receiptsTable.id, { onDelete: "set null" }),
  transactionId: uuid("transaction_id").references(() => transactionsTable.id, { onDelete: "set null" }),
  source: varchar("source", { length: 24 }).notNull().default("receipt"),
  productNameSnapshot: varchar("product_name_snapshot", { length: 180 }).notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 2, mode: "number" }).notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2, mode: "number" }).notNull(),
  purchasedAt: date("purchased_at", { mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("user_product_purchases_user_date_idx").on(table.userId, table.purchasedAt),
  index("user_product_purchases_product_idx").on(table.productId, table.userId),
]);

export const productVotesTable = pgTable("product_votes", {
  id: uuid("id").primaryKey().defaultRandom(),
  alternativeId: uuid("alternative_id").notNull().references(() => productAlternativesTable.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  vote: integer("vote").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("product_votes_user_alternative_idx").on(table.alternativeId, table.userId),
]);

export const affiliateLinksTable = pgTable("affiliate_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  network: varchar("network", { length: 24 }).$type<"amazon" | "impact" | "cj">().notNull(),
  destinationUrl: text("destination_url").notNull(),
  affiliateUrl: text("affiliate_url").notNull(),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("affiliate_links_product_active_idx").on(table.productId, table.active)]);

export const integrationConnectionsTable = pgTable("integration_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 24 }).$type<"plaid" | "gmail" | "outlook">().notNull(),
  providerAccountId: varchar("provider_account_id", { length: 180 }),
  encryptedCredential: text("encrypted_credential").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  syncCursor: text("sync_cursor"),
  status: varchar("status", { length: 24 }).notNull().default("connected"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [uniqueIndex("integration_connections_user_provider_idx").on(table.userId, table.provider)]);

export const recurringSubscriptionsTable = pgTable("recurring_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  transactionId: uuid("transaction_id").references(() => transactionsTable.id, { onDelete: "set null" }),
  merchant: varchar("merchant", { length: 180 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  cadence: varchar("cadence", { length: 24 }).notNull(),
  nextExpectedAt: date("next_expected_at", { mode: "string" }),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("recurring_subscriptions_user_status_idx").on(table.userId, table.status)]);

export const billingSubscriptionsTable = pgTable("billing_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  stripeCustomerId: varchar("stripe_customer_id", { length: 180 }).notNull(),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 180 }).notNull().unique(),
  status: varchar("status", { length: 32 }).notNull(),
  periodEndsAt: timestamp("period_ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("billing_subscriptions_user_status_idx").on(table.userId, table.status)]);

export const extensionTokensTable = pgTable("browser_extension_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
  label: varchar("label", { length: 80 }).notNull().default("Browser extension"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("browser_extension_tokens_user_idx").on(table.userId)]);
