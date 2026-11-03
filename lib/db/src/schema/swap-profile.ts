import { sql } from "drizzle-orm";
import { jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export type SwapProfileData = {
  savingFor: string;
  monthlySavingsGoal: number;
  nonNegotiables: string[];
  swapCategories: string[];
  favoriteBrands: string[];
  values: string[];
  dietaryNeeds: string;
  productPreferences: string;
};

export const emptySwapProfile: SwapProfileData = {
  savingFor: "",
  monthlySavingsGoal: 0,
  nonNegotiables: [],
  swapCategories: [],
  favoriteBrands: [],
  values: [],
  dietaryNeeds: "",
  productPreferences: "",
};

export const swapProfilesTable = pgTable("swap_profiles", {
  userId: varchar("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  profile: jsonb("profile").$type<SwapProfileData>().notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
