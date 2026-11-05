import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod/v4";

export const tripwireRecords = pgTable("tripwire_records", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  kind: text("kind").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export const insertTripwireSchema = createInsertSchema(tripwireRecords);
export type InsertTripwire = z.infer<typeof insertTripwireSchema>;
export type TripwireRecord = typeof tripwireRecords.$inferSelect;
