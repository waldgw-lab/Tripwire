/** Local, deterministic extraction. No network/model, fuzzy joining or truth/independence inference. */
export const CLAIM_POLICY = "local-reporting-v1";
export const DIRECTIONS = ["positive", "negative", "neutral", "mixed", "unassessed"] as const;
export type Direction = typeof DIRECTIONS[number];
export type LocalClaim = {
 proposition: string; excerpt: string; start: number; end: number;
 descriptor: string | null; subject: string | null; direction: Direction; reason: string;
 stance: "reported" | "alleged" | "disputed" | "opinion";
};
export const propositionKey = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[“”‘’]/g, "'")
 .replace(/[^\p{L}\p{N}'\s]/gu, " ").replace(/\s+/g, " ").trim();
const positive = /\b(improved|strengthened|protected|succeeded|restored|prevented|rescued|saved|outperformed|effective|successful)\b/gi;
const negative = /\b(failed|weakened|endangered|undermined|harmed|damaged|worsened|misled|ineffective|unlawful|killed|injured)\b/gi;

export function claimDirection(proposition: string) {
 const p = [...proposition.matchAll(positive)], n = [...proposition.matchAll(negative)];
 const terms = [...p, ...n].sort((a,b)=>a.index!-b.index!);
 const first = terms[0];
 const subject = first ? proposition.slice(0, first.index).trim().replace(/\b(?:has|have|had|was|were|is|are|did|not|never)\s*$/i,"").trim() : null;
 const uncertain = /\b(may|might|could|would|allegedly|alleged|reportedly|denied|denies|expected|hoped|aimed|intended)\b/i.test(proposition)
  || terms.some(t => /\b(not|never|no)\b/i.test(proposition.slice(Math.max(0,t.index!-32),t.index)));
 if (!first || !subject || subject.length>160 || uncertain)
  return { subject: subject && subject.length<=160 ? subject : null, direction:"unassessed" as Direction,
   reason: uncertain ? "Conditional, disputed or negated wording; no automatic directional conclusion." : "No explicit, unambiguous evaluative wording about a subject." };
 return { subject, direction: (p.length && n.length ? "mixed" : p.length ? "positive" : "negative") as Direction,
  reason:`Explicit wording in this passage: ${terms.map(t=>t[0]).join(", ")}. Describes reporting, not verified truth.` };
}

export function extractLocalClaims(text: string): LocalClaim[] {
 const result: LocalClaim[] = [], seen = new Set<string>();
 const segmenter = new Intl.Segmenter("en", {granularity:"sentence"});
 // Bounded output and input; offsets remain relative to the full retained body.
 const input=text.slice(0,32000);
 for (const match of input.matchAll(/[^\n]+/g)) {
  for (const segment of segmenter.segment(match[0])) {
   const raw=segment.segment, left=raw.length-raw.trimStart().length;
   const excerpt=raw.trim();
   if(excerpt.length<45 || excerpt.length>1400 || excerpt.split(/\s+/).length<8 || /[?]$/.test(excerpt))continue;
   if(/^(?:subscribe|sign up|read more|related articles|advertisement|copyright|all rights|share this|by\s)/i.test(excerpt))continue;
   if(!/\b(said|stated|reported|announced|warned|confirmed|denied|found|approved|ordered|rejected|improved|strengthened|protected|failed|weakened|endangered|undermined|harmed|damaged|worsened|misled|killed|injured|restored|prevented|rescued|saved|succeeded|outperformed|was|were|is|are|has|have)\b/i.test(excerpt))continue;
   const according=/\baccording to\s+([^,;!?\n]{3,180})/i.exec(excerpt);
   const speaker=/^[^\p{L}\p{N}]*((?:(?:The|A|An)\s+)?[\p{Lu}][\p{L}.'’\-]*(?:\s+[\p{L}.'’\-]+){0,8}?)\s+(said|stated|reported|announced|warned|confirmed|denied)\s+(?:that\s+)?/u.exec(excerpt);
   let descriptor=according?.[1]?.replace(/[.\s]+$/,"") ?? speaker?.[1] ?? null;
   if(descriptor && !excerpt.includes(descriptor))descriptor=null;
   // Preserve the full proposition when stripping an attribution would erase a denial/qualification.
   let proposition = speaker && /^(said|stated|reported|announced)$/i.test(speaker[2])
    ? excerpt.slice(speaker[0].length).replace(/^["“]|["”][.]?$/g,"").trim() : excerpt;
   if(according && !speaker)proposition=according.index === 0
    ? excerpt.slice(according[0].length).replace(/^[,\s]+/,"").trim()
    : excerpt.slice(0,according.index).replace(/[,\s]+$/,"");
   if(proposition.length<40 || proposition.split(/\s+/).length<7)proposition=excerpt;
   const key=propositionKey(proposition);
   if(seen.has(key))continue;
   seen.add(key);
   const start=match.index!+segment.index+left, end=start+excerpt.length;
   const stance = /\b(denied|denies|disputed|rebutted)\b/i.test(excerpt) ? "disputed"
    : /\b(alleged|accused|claimed)\b/i.test(excerpt) ? "alleged"
    : /\b(argued|opinion|believe|believes)\b/i.test(excerpt) ? "opinion" : "reported";
   const assessment=claimDirection(proposition);
   if(stance!=="reported"){ assessment.direction="unassessed";assessment.reason="Preserves a dispute, allegation or opinion rather than asserting its directional interpretation."; }
   result.push({proposition,excerpt,start,end,descriptor,...assessment,stance});
   if(result.length>=20)return result;
  }
 }
 return result;
}

/** Resume at an exact sentence boundary; no article text is silently truncated by the worker. */
export function extractClaimChunk(text:string,cursor=0) {
 let end=Math.min(text.length,cursor+32000);
 if(end<text.length) {
  const segments=[...new Intl.Segmenter("en",{granularity:"sentence"}).segment(text.slice(cursor,end))];
  const last=segments.at(-1);
  if(last && !/[.!?]["”']?\s*$/.test(last.segment))end=cursor+last.index;
  if(end<=cursor)throw new Error("A sentence exceeds the local processing window; retain it for manual passage linkage");
 }
 const claims=extractLocalClaims(text.slice(cursor,end)).map(c=>({...c,start:c.start+cursor,end:c.end+cursor}));
 const nextCursor=claims.length>=20 ? claims.at(-1)!.end : end;
 return {claims,nextCursor};
}
