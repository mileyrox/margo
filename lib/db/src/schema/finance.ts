import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export type StoredReceiptItem = {
  productName: string;
  brand: string | null;
  category: string;
  unitPrice: number;
  unitsPerYear: number;
};

export const transactionsTable = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 12 }).$type<"income" | "expense">().notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    amount: numeric("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
    category: varchar("category", { length: 60 }).notNull(),
    date: date("date", { mode: "string" }).notNull(),
    isTaxable: boolean("is_taxable").notNull().default(false),
    source: varchar("source", { length: 120 }),
    plaidTransactionId: varchar("plaid_transaction_id", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("transactions_user_date_idx").on(table.userId, table.date),
    index("transactions_user_type_idx").on(table.userId, table.type),
    uniqueIndex("transactions_user_plaid_id_idx").on(table.userId, table.plaidTransactionId),
  ],
);

export const financeSettingsTable = pgTable("finance_settings", {
  userId: varchar("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  taxReserveRate: numeric("tax_reserve_rate", {
    precision: 5,
    scale: 2,
    mode: "number",
  })
    .notNull()
    .default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const receiptsTable = pgTable(
  "receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    merchant: varchar("merchant", { length: 120 }).notNull(),
    purchasedAt: date("purchased_at", { mode: "string" }).notNull(),
    total: numeric("total", { precision: 12, scale: 2, mode: "number" }).notNull(),
    objectPath: varchar("object_path", { length: 500 }),
    items: jsonb("items").$type<StoredReceiptItem[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("receipts_user_date_idx").on(table.userId, table.purchasedAt)],
);

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({
  id: true,
  createdAt: true,
});
export const insertReceiptSchema = createInsertSchema(receiptsTable).omit({
  id: true,
  createdAt: true,
});
export const insertFinanceSettingsSchema = createInsertSchema(financeSettingsTable);

export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
export type InsertReceipt = z.infer<typeof insertReceiptSchema>;
export type Receipt = typeof receiptsTable.$inferSelect;
export type FinanceSettings = typeof financeSettingsTable.$inferSelect;
