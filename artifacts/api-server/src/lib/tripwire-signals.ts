export function mentionsTerm(text: string, term: string) {
  if (term.trim().length < 3) return false;
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(text);
}
import { inferTopic, subjectText } from "./tripwire-impact-policy";
export const inferArticleTopic = inferTopic;
export function mentionedEntities(text: string, watches: { title: string; position?: string; individual?: string; aliases?: string[]; watchType?: string; enabled?: boolean }[]) {
  text = subjectText(text).replace(/\bHarry Trump\s*\/?\s*Getty\b/gi, "");
  return watches.filter(w => w.enabled !== false && w.watchType !== "journalist" && w.watchType !== "x-account" &&
    [w.title, w.individual ?? "", ...w.aliases ?? []].filter(term => !/^(?:president|defen[cs]e|intelligence|operations?|cooper|caine|telle)$/i.test(term.trim())).some(term =>
      mentionsTerm(text, term) || w.watchType === "attribution" && /official$/i.test(term) && mentionsTerm(text, `${term}s`))).map(w => w.title);
}
