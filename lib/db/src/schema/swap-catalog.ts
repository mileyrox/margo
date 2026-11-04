import { index, numeric, pgTable, text, varchar } from "drizzle-orm/pg-core";

export const swapCatalogTable = pgTable("swap_catalog_items", {
  id: varchar("id", { length: 40 }).primaryKey(),
  groupName: varchar("group_name", { length: 40 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  originalBrand: text("original_brand").notNull().default(""),
  originalProduct: text("original_product").notNull(),
  originalRetailer: text("original_retailer").notNull().default(""),
  originalPrice: numeric("original_price", { precision: 12, scale: 2, mode: "number" }),
  swapBrand: text("swap_brand").notNull().default(""),
  swapProduct: text("swap_product").notNull(),
  swapRetailer: text("swap_retailer").notNull().default(""),
  swapPrice: numeric("swap_price", { precision: 12, scale: 2, mode: "number" }),
  originalPricePerOz: numeric("original_price_per_oz", { precision: 12, scale: 4, mode: "number" }),
  swapPricePerOz: numeric("swap_price_per_oz", { precision: 12, scale: 4, mode: "number" }),
  savingsPerOzPct: numeric("savings_per_oz_pct", { precision: 7, scale: 2, mode: "number" }),
  matchType: varchar("match_type", { length: 40 }).notNull(),
  similarity: numeric("similarity", { precision: 5, scale: 2, mode: "number" }),
  confidence: varchar("confidence", { length: 40 }).notNull().default(""),
  whySimilar: text("why_similar").notNull().default(""),
  differences: text("differences").notNull().default(""),
  status: varchar("status", { length: 80 }).notNull(),
  flags: text("flags").notNull().default(""),
}, (table) => [
  index("swap_catalog_status_group_idx").on(table.status, table.groupName),
]);
