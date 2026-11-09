-- Original bytes are append-only. Improved extraction must create a new hash.
-- Metadata-only maintenance and deliberate retention DELETE remain permitted.
CREATE FUNCTION tripwire_protect_retained_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.hash IS DISTINCT FROM OLD.hash
     OR NEW.text IS DISTINCT FROM OLD.text
     OR NEW.raw IS DISTINCT FROM OLD.raw THEN
    RAISE EXCEPTION 'Retained originals are immutable; insert a new content version instead'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tripwire_retained_content_immutable
BEFORE UPDATE OF hash, text, raw ON tripwire_content
FOR EACH ROW EXECUTE FUNCTION tripwire_protect_retained_content();
