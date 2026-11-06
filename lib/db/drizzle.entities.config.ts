import { defineConfig } from "drizzle-kit";
import path from "node:path";
export default defineConfig({
  schema: path.join(__dirname, "./src/schema/tripwire-entities.ts"),
  dialect: "postgresql",
  out: "./migrations/entities",
});
