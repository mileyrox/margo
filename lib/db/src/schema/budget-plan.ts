import { sql } from "drizzle-orm";
import { jsonb, numeric, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export type SavedCategoryBudget = { category: string; monthlyTarget: number };

export const budgetPlansTable = pgTable("budget_plans", {
  userId: varchar("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  annualIncome: numeric("annual_income", {
    precision: 12,
    scale: 2,
    mode: "number",
  })
    .notNull()
    .default(0),
  annualSavingsGoal: numeric("annual_savings_goal", {
    precision: 12,
    scale: 2,
    mode: "number",
  })
    .notNull()
    .default(0),
  monthlyRent: numeric("monthly_rent", {
    precision: 12,
    scale: 2,
    mode: "number",
  })
    .notNull()
    .default(0),
  priorityCategories: jsonb("priority_categories")
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  categoryBudgets: jsonb("category_budgets")
    .$type<SavedCategoryBudget[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertBudgetPlanSchema = createInsertSchema(budgetPlansTable).omit({
  updatedAt: true,
});

export type InsertBudgetPlan = z.infer<typeof insertBudgetPlanSchema>;
export type BudgetPlanRecord = typeof budgetPlansTable.$inferSelect;
