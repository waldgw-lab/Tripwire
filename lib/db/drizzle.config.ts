import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: [path.join(__dirname, "./src/schema/tripwire.ts"), path.join(__dirname, "./src/schema/tripwire-content.ts")],
  dialect: "postgresql",
  // Entity graph uses versioned SQL migrations: current drizzle-kit introspection
  // cross-joins composite FK columns and proposes unsafe constraint recreation.
  tablesFilter: ["tripwire_records", "tripwire_content"],
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
