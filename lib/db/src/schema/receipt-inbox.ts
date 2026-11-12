import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

/**
 * Each person's private receipt email address. Mail sent to receipts+<token>@... is read as a
 * receipt for that person. The email itself is never stored, only the receipt Margo reads from it.
 */
export const receiptInboxesTable = pgTable("receipt_inboxes", {
  userId: varchar("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 40 }).notNull().unique(),
  /** Gmail sends a code to confirm a forwarding address. Margo shows it so the person can finish setup. */
  gmailCode: varchar("gmail_code", { length: 40 }),
  gmailCodeAt: timestamp("gmail_code_at", { withTimezone: true }),
  lastReceivedAt: timestamp("last_received_at", { withTimezone: true }),
  lastResult: varchar("last_result", { length: 200 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
