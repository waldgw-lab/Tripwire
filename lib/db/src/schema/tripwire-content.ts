import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, customType, index } from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
// PostgreSQL TOAST compresses large text outside the metadata rows. Content is
// immutable and addressed by its SHA-256, so repeated captures do not copy bodies.
export const tripwireContent = pgTable("tripwire_content", {
  hash: text("hash").primaryKey(),
  text: text("text").notNull(),
  raw: text("raw"),
  search: tsvector("search").generatedAlwaysAs(sql`to_tsvector('english'::regconfig, "text")`),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("tripwire_content_search_idx").using("gin", table.search)]);
