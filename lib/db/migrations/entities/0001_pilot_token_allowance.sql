ALTER TABLE "tripwire_entity_automation" ALTER COLUMN "daily_tokens" SET DEFAULT 750000;
--> statement-breakpoint
-- Upgrade only the untouched, unauthorized shared-workspace pilot defaults.
-- Do not overwrite a previously configured custom budget or enable processing.
UPDATE "tripwire_entity_automation"
SET "daily_tokens" = 750000
WHERE "workspace" = 'workspace'
  AND "daily_tokens" = 50000
  AND "daily_micros" = 1000000
  AND "authorized" = false;