import { index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
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
