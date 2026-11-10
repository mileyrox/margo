import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export type EngineSuggestion = {
  name: string;
  brand: string;
  retailer: string;
  matchType: "Dupe" | "Cheaper option";
  sizeText: string;
  typicalPrice: number | null;
  whySimilar: string[];
  differences: string;
  confidence: "high" | "medium" | "low";
  url: string;
  upVotes: number;
  downVotes: number;
};

/**
 * One row per product Margo has looked up. Every user who buys, scans or searches the same
 * product gets the cached result, so each product costs one AI call, not one per person.
 */
export const swapLookupsTable = pgTable("swap_lookups", {
  id: uuid("id").primaryKey().defaultRandom(),
  productKey: varchar("product_key", { length: 260 }).notNull(),
  productName: varchar("product_name", { length: 200 }).notNull(),
  brand: varchar("brand", { length: 120 }).notNull().default(""),
  category: varchar("category", { length: 80 }).notNull().default(""),
  sizeText: varchar("size_text", { length: 60 }).notNull().default(""),
  barcode: varchar("barcode", { length: 40 }),
  retailer: varchar("retailer", { length: 80 }).notNull().default(""),
  typicalPrice: varchar("typical_price", { length: 20 }),
  status: varchar("status", { length: 16 }).$type<"ready" | "none" | "error">().notNull().default("ready"),
  suggestions: jsonb("suggestions").$type<EngineSuggestion[]>().notNull().default(sql`'[]'::jsonb`),
  source: varchar("source", { length: 24 }).notNull().default("ai"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("swap_lookups_product_key_idx").on(table.productKey),
  index("swap_lookups_barcode_idx").on(table.barcode),
  index("swap_lookups_created_by_idx").on(table.createdBy, table.createdAt),
]);

export type SwapLookup = typeof swapLookupsTable.$inferSelect;
