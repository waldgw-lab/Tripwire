/** A timeline capture is reporting, never a truth/independence decision.
 * These guards also run on explicit processing, so a retry cannot bypass them.
 */
export function xClaimSkipReason(data: {
  sourceType?: string;
  xPost?: { textTruncated?: boolean; references: { type: string }[] };
}, text: string): string | undefined {
  if (data.sourceType !== "x" && !data.xPost) return;
  if (data.xPost?.references.some(r => r.type === "retweeted") || /^RT\s+@/i.test(text.trim())) {
    return "Repost retained for context, not processed as a new statement by this account.";
  }
  if (data.xPost?.textTruncated || /(?:…|\.{3})(?:\s+https:\/\/t\.co\/\S+)?\s*$/.test(text)) {
    return "Truncated X text retained for context; Claims processing needs the complete statement.";
  }
  return undefined;
}
