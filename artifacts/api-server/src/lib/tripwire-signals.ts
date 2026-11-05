export function mentionsTerm(text: string, term: string) {
  if (term.trim().length < 3) return false;
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(text);
}
export function inferArticleTopic(title: string, body: string, section = "") {
  if (/^politics(?:\s*&\s*policy)?$/i.test(section.trim())) return "Politics";
  const intelligence = /\b(?:intelligence|CIA|ODNI|spies|spy|classified|declassified)\b/i;
  const operations = /\b(?:military|operations?|strikes?|troops)\b/i;
  const foreign = /\b(?:diplomacy|diplomatic|foreign policy|state department)\b/i;
  const defense = /\b(?:pentagon|defen[cs]e|munitions|weapons|procurement|industrial base)\b/i;
  const politics = /\b(?:elections?|midterms?|2028|MAGA|GOP|congress|senate|presidential race)\b/i;
  if (intelligence.test(title)) return "Intelligence";
  if (operations.test(title)) return "Military Operations";
  if (foreign.test(title)) return "Foreign Policy";
  if (defense.test(title)) return "Defense";
  if (politics.test(title)) return "Politics";
  const text = `${title}\n${body}`;
  return intelligence.test(text) ? "Intelligence" : operations.test(text) ? "Military Operations" : foreign.test(text) ? "Foreign Policy"
    : defense.test(text) ? "Defense" : /\b(?:iran|israel|ukraine|russia|china|NATO)\b/i.test(text) ? "Geopolitics" : "Politics";
}
export function mentionedEntities(text: string, watches: { title: string; position?: string; individual?: string; aliases?: string[]; watchType?: string; enabled?: boolean }[]) {
  return watches.filter(w => w.enabled !== false && w.watchType !== "journalist" && w.watchType !== "x-account" &&
    [w.title, w.position ?? "", w.individual ?? "", ...w.aliases ?? []].some(term =>
      mentionsTerm(text, term) || w.watchType === "attribution" && /official$/i.test(term) && mentionsTerm(text, `${term}s`))).map(w => w.title);
}
