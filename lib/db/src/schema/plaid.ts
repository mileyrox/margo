import { boolean, date, index, numeric, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const plaidItemsTable = pgTable("plaid_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  itemId: varchar("item_id", { length: 120 }).notNull().unique(),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  institutionId: varchar("institution_id", { length: 120 }),
  institutionName: varchar("institution_name", { length: 160 }),
  cursor: text("cursor"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("plaid_items_user_idx").on(table.userId)]);

export type PlaidItem = typeof plaidItemsTable.$inferSelect;

/** Each bank account from a connected bank, with its latest balance. Rates and minimums for debts can be set by the person. */
export const bankAccountsTable = pgTable("bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  plaidItemId: uuid("plaid_item_id").notNull().references(() => plaidItemsTable.id, { onDelete: "cascade" }),
  accountId: varchar("account_id", { length: 120 }).notNull().unique(),
  name: varchar("name", { length: 160 }).notNull(),
  mask: varchar("mask", { length: 8 }),
  type: varchar("type", { length: 24 }).notNull(),
  subtype: varchar("subtype", { length: 40 }),
  current: numeric("current", { precision: 14, scale: 2 }),
  available: numeric("available", { precision: 14, scale: 2 }),
  creditLimit: numeric("credit_limit", { precision: 14, scale: 2 }),
  /** Set by the person for debts (yearly interest rate, as a percent, and monthly minimum). */
  apr: numeric("apr", { precision: 6, scale: 2 }),
  minPayment: numeric("min_payment", { precision: 12, scale: 2 }),
  hidden: boolean("hidden").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("bank_accounts_user_idx").on(table.userId)]);

/** One balance per account per day, so Margo can see money actually moving into savings or debts going down. */
export const balanceSnapshotsTable = pgTable("balance_snapshots", {
  accountId: uuid("account_id").notNull().references(() => bankAccountsTable.id, { onDelete: "cascade" }),
  day: date("day").notNull(),
  current: numeric("current", { precision: 14, scale: 2 }).notNull(),
}, (table) => [primaryKey({ columns: [table.accountId, table.day] })]);

export type BankAccount = typeof bankAccountsTable.$inferSelect;
