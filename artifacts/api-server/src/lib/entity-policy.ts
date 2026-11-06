// Pure deterministic policy. Extractor labels never establish sourcing quality.
export const POLICY_VERSION = "evidence-v1";
export const FACTORS = ["authority", "relationship", "involvement", "significance", "continuing"] as const;
export const DEFAULT_POLICY: Record<string, number> = { authority: 1, relationship: 1, involvement: 1, significance: 1, continuing: 1, promotion: 12 };
export const PREDICATES = ["occupies", "commands", "advises", "oversees", "appointed", "met-with", "negotiated-with", "criticized", "investigated", "supplies-capability", "reportedly-discussed", "involved-in", "alias", "identifier"] as const;
export const CERTAINTIES = ["asserted", "attributed", "alleged", "disputed", "inferred", "confirmed"] as const;
export function exactEvidence(text: string, excerpt: string, start: number, end: number) {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= text.length
    && excerpt.length >= 20 && excerpt.length <= 4000 && text.slice(start, end) === excerpt;
}
export function dimensions(input: Record<string, number> = {}) {
  if (Object.keys(input).some(k => !FACTORS.includes(k as typeof FACTORS[number]))) throw new Error("Unknown relevance factor");
  return Object.fromEntries(FACTORS.map(k => {
    const value = input[k] ?? 0;
    if (!Number.isInteger(value) || value < 0 || value > 4) throw new Error("Factors must be integers from 0 to 4");
    return [k, value];
  }));
}
export type PromotionEvidence = {
  valid: boolean; complete: boolean; resolved: boolean; assessed: boolean;
  route: string; certainty: string; tenure?: string | null; approvedAnchor?: boolean;
  origins?: string[]; independentAdditions?: boolean; substantive: boolean;
};
export function promotionGate(e: PromotionEvidence) {
  if (!e.valid || !e.complete || !e.resolved || !e.assessed || !e.substantive) return false;
  if (e.route === "authoritative-appointment")
    return e.certainty === "confirmed" && !!e.approvedAnchor && ["current", "acting", "interim", "concurrent"].includes(e.tenure ?? "");
  if (e.route === "original") return !["inferred", "disputed"].includes(e.certainty);
  return e.route === "addition" && !!e.independentAdditions && new Set(e.origins).size >= 2;
}
export function triage(input: { novelty: string; consequence: number; assessed: boolean; complete: boolean; mode: string; certainty: string; relation: string }) {
  if (input.novelty === "repetition" || ["syndication", "commentary", "citation"].includes(input.relation)) return "Collection";
  if (input.mode !== "autonomous" || !input.assessed || !input.complete || input.novelty !== "material"
    || ["inferred", "disputed"].includes(input.certainty)) return "Review";
  return input.consequence >= 3 ? "Immediate" : "Review";
}
export function canAutoArchive(e: { classification: string; pinned: boolean; unresolved: boolean }, currentAuthority: boolean, collectionHealthy: boolean) {
  return e.classification !== "structural" && !e.pinned && !e.unresolved && !currentAuthority && collectionHealthy;
}
export function identityRoute(input: { externalMatch?: boolean; exactAlias?: boolean; collisions: number; anonymous?: boolean; reportingCredit?: boolean }) {
  if (input.anonymous || input.reportingCredit) return "source-only";
  if (input.externalMatch && input.collisions === 1) return "resolved";
  // Name/alias equality is a review hint, never proof of identity.
  return input.collisions || input.exactAlias ? "collision" : "new";
}
