# Grouped Feed: reference review and implementation

Reviewed 9 November 2026 using the supplied screenshots and direct reads of:
[NewsCord](https://newscord.org/), [Ground News](https://ground.news/),
[Verity](https://www.verity.news/), [The Balanced News](https://thebalanced.news/),
[Google News](https://news.google.com/) and [Axios](https://www.axios.com/).
This is a UI-pattern review, not an endorsement or validation of their ratings.

## Useful patterns

| Reference | Useful for Tripwire | What not to import without evidence |
| --- | --- | --- |
| Google News | Shared development heading; several original outlet headlines; time and publisher above the article; explicit full-coverage access | Personalization that hides relevant, quieter reporting |
| Ground News | Article/outlet breadth, scan-friendly bundles and full-coverage navigation | Left/right bars without a sourced, transparent rating system; counts presented as corroboration |
| NewsCord | Development cards, source comparison and progressive disclosure | Large hero stories dominating monitoring; unattributed synthesized conclusions |
| Verity | Source-logo clusters and a clear hierarchy between reporting and context | Forced binary framing, speculative prompts or account overlays |
| The Balanced News | Compare actual outlet framing within one development | Unsupported political-bias, sentiment or loaded-language scores |
| Axios | Concise headings and short paths to deeper reporting | Generated “why it matters” claims that exceed retained evidence |

## Three implemented layout hypotheses

**Briefing — recommended:** a vertical list of compact development bundles,
with original article headlines beneath each. Best for daily relevance/recency
monitoring. Three articles preview a group; expansion exposes all members.

**Compare:** outlet-oriented sections within each development. Best for looking
at differences in original headline wording. It costs vertical space; the app
does not interpret differences as political bias or intentional omission.

**Board:** a responsive, multi-column development overview with source-logo
stacks and expandable cards. Best for broad scanning. It is deliberately not a
different palette on the same list.

All three use the same eligible article set and grouping result. All open the
existing article reader, with publisher links, flags, editing and deletion.
Fresh `/feed` navigation defaults to Chronological. An explicit grouped URL can
restore a layout; this does not change the default.

## Grouping and ordering

- Use the already-filtered Feed articles, not a Claims-only subset. Default Low
  exclusion and all user-selected filters still apply. Unenriched, video,
  opinion and unlinked articles remain eligible.
- Recognize specific headline-level developments, not just a shared politician
  or country. Examples distinguish Hegseth leadership pressure from partisan
  video reporting, Iran diplomacy from operations, and the Miller/Wiles
  transition from communications-staffing reporting.
- Available retained summary context may resolve an ambiguous CEO reference.
  This does not authorize new source fetching or model processing.
- Otherwise require strong headline-token overlap with one anchor, not
  transitive similarity chaining. Distinct explicit place names in
  sentence-case headlines prevent generic incident matches.
- Dated groups span at most 72 hours from their latest article. The same
  development can recur as a separate time-bounded bundle. Unknown dates stay
  standalone; ingestion or later extraction does not become publication time.
- Uncertain items retain their original headline as visible singletons. Every
  distinct eligible article has exactly one group membership. This is
  provisional navigation, not evidence that all articles assert the same fact.
- Relevant order uses latest publication time plus a bounded Critical boost
  of 90 minutes or High boost of 30 minutes, and up to 20 minutes for outlet
  breadth. Old, heavily covered stories cannot accumulate an unlimited volume
  boost. Newest uses publication time; Coverage explicitly prioritizes outlet
  breadth. Flagged-first remains an explicit override.
- Thirty groups load initially, with a working load-more control and no hard
  result cutoff. A selected article and its group remain visible beyond a
  preview or page limit.

## Claims, tone and bias

Feed developments and Claims focus groups have different purposes. The former
organize current reporting; the latter organize article focus and passage-backed
statements. Only exact article-attribution links offer related Claims navigation.
Claims availability or linkage failure does not gate grouped article eligibility,
unless the user explicitly selected a Claims filter.

Article and outlet counts are not independent-source counts. Syndication,
shared sourcing, commentary and repeated claims can increase article counts
without adding independent evidence.

Existing positive/negative/neutral/mixed article assessments may be counted as
**recorded tone**. Missing assessments are **unassessed**, not neutral. These
are neither new model judgments nor political-bias ratings.

Political-bias analysis should wait for an explicit unit of assessment
(article vs outlet), provenance, a reproducible methodology, uncertainty,
user correction, and a clear separation from factual accuracy and source
independence. No invented left/right bars or percentages are implemented.

## Limits and verification

Deterministic headline indicators will miss some related reporting and may
occasionally group too broadly. Conservative singleton fallback prevents those
misses from hiding articles. This view does not alter article identity, retained
versions, Claims, permissions, capture authorization or autonomous decisions.
No additional publisher or model requests are made by grouping.

Pure regressions cover lossless membership, exact Claims links, no-Claims
content, dated/undated ordering, limited relevance boosts, stable groups,
headline context, source aliases, recorded tone and conservative similarity.
Browser-only fixtures intercept every API endpoint and reject writes; fictional
test items never enter the shared archive.
