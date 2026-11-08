/** Version context describes retained wording, not truth, completeness or independence. */
export type EvidenceScope = "selected" | "retained-excerpt" | "superseded" | "unknown";
type Row = Record<string, any>;

export function evidenceVersion(e: Row | undefined, capture: Row | undefined, article: Row | undefined, bodies: Map<string, string>) {
  const original = capture ? bodies.get(capture.hash) : undefined;
  const selected = article?.fullTextHash ? bodies.get(article.fullTextHash) : undefined;
  const valid = !!e?.excerpt && original !== undefined && original.slice(e.start, e.end) === e.excerpt;
  let scope: EvidenceScope = "unknown";
  if (valid && selected !== undefined) {
    if (selected.includes(e!.excerpt)) scope = "selected";
    else if (/^(page:|paste(?:$|:)|url(?:$|:)|file(?:$|:)|upload(?:$|:)|pdf(?:$|:))/.test(capture!.source)) scope = "superseded";
    else scope = "retained-excerpt";
  }
  return {
    evidenceId: e?.id ?? null, captureId: capture?.id ?? null, scope,
    bodyHash: capture?.hash ?? null, selectedBodyHash: article?.fullTextHash ?? null,
    source: capture?.source ?? null,
    capturedAt: capture?.captured_at ? new Date(capture.captured_at).toISOString() : null,
    excerpt: e?.excerpt ?? null, start: e?.start ?? null, end: e?.end ?? null,
  };
}

export function claimEvidenceScope(versions: { scope: EvidenceScope }[]): EvidenceScope {
  for (const scope of ["selected", "retained-excerpt", "superseded"] as const) {
    if (versions.some(v => v.scope === scope)) return scope;
  }
  return "unknown";
}
