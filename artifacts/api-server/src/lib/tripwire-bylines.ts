export type CreditRole = 'author' | 'contributor' | 'reporting' | 'research' | 'photography' | 'editing' | 'other';
export type ParsedCredit = { name: string; role: CreditRole; attribution?: string };

/** Parse only supplied credit text, never infer contributors from article prose. */
export function parseByline(raw: string): ParsedCredit[] {
  if (!raw.trim()) return [];
  const markers = /\b(additional reporting by|reporting contributed by|contributed reporting by|with reporting from|reporting by|contributions? (?:from|by)|with contributions from|contributed by|research by|photographs? by|photos? by|photography by|edited by|editing by)\s+/gi;
  const segments: { text: string; role: CreditRole; marker?: string }[] = [];
  let start = 0;
  let role: CreditRole = 'author';
  let marker: string | undefined;
  for (const match of raw.matchAll(markers)) {
    segments.push({ text: raw.slice(start, match.index), role, marker });
    marker = match[1];
    role = /research/i.test(marker) ? 'research' : /photo/i.test(marker) ? 'photography' : /edit/i.test(marker) ? 'editing' : /reporting/i.test(marker) ? 'reporting' : 'contributor';
    start = match.index! + match[0].length;
  }
  segments.push({ text: raw.slice(start), role, marker });
  const credits: ParsedCredit[] = [];
  for (const segment of segments.flatMap(part => part.text.split(';').map(text => ({ ...part, text })))) {
    let text = segment.text.replace(/^\s*by\s+/i, '').replace(/^[\s;:.–—-]+|[\s;:–—-]+$/g, '').trim();
    if (!text) continue;
    if (text.endsWith('.') && !/\b(?:Jr|Sr|[A-Z])\.$/.test(text)) text = text.slice(0, -1);
    let actualRole = segment.role;
    if (/\s+contributed(?:\s+(?:reporting|research))?\s+to\s+(?:this|the)\s+(?:report|article|story)\.?$/i.test(text)) {
      actualRole = 'contributor';
      text = text.replace(/\s+contributed(?:\s+(?:reporting|research))?\s+to\s+(?:this|the)\s+(?:report|article|story)\.?$/i, '');
    }
    const protectedSuffixes = text.replace(/,\s*(Jr\.?|Sr\.?|II|III|IV)(?=\s*(?:,|;|&|\band\b|$))/gi, '\u0000$1');
    for (const part of protectedSuffixes.split(/\s+(?:and|&)\s+|[,;]\s*/i)) {
      const name = part.replace(/\u0000/g, ', ').trim();
      if (!name || /^(?:Jr\.?|Sr\.?|II|III|IV)$/i.test(name)) continue;
      if (credits.some(c => c.name.toLowerCase() === name.toLowerCase() && c.role === actualRole)) continue;
      credits.push({ name, role: actualRole, ...(segment.marker || actualRole !== 'author' ? { attribution: `${segment.marker ?? ''} ${segment.text}`.trim() } : {}) });
    }
  }
  return credits;
}

export function reviewedContributors(credits: ParsedCredit[], input?: string): ParsedCredit[] {
  if (input === undefined) return credits;
  const supplied = parseByline(input).map(c => {
    const previous = credits.find(old => old.role === "contributor" && old.name.toLowerCase() === c.name.toLowerCase());
    return previous ?? { ...c, role: "contributor" as const, attribution: `Contributors: ${input.trim()}` };
  });
  return [...credits.filter(c => c.role !== "contributor"), ...supplied];
}
