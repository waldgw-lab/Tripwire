---
name: Content storage strategy
description: Why article text stays in the existing database and raw responses remain available for local re-extraction.
---

Prefer the existing PostgreSQL database for retained article text and raw source versions rather than introducing a separate text-body object store.

**Why:** The product needs searchable historical content and reliable provenance, not just downloadable files. PostgreSQL supports those needs with compression and transactional metadata, without a second storage service for article text. Original uploaded binary documents can continue using private file storage.

**How to apply:** Keep body versions immutable, avoid copying bodies into every metadata edit, and load selected bodies separately from feed metadata. Reconsider the text-store choice only when measured scale or operational constraints justify it.

Retain raw publisher responses so extraction improvements can run locally before requesting the same page again.

**Why:** A publisher's structured article-body field can be only a teaser while its visible article paragraphs contain substantially more content; subsequent network requests may also be refused. Preserving the response makes extraction repair possible without losing the earlier interpretation.

**How to apply:** Preserve the original capture time and earlier text versions when reprocessing; distinguish re-extraction from a new network fetch.

Treat a structurally bounded, cleaned publisher copy as a better canonical article than a longer unclean page copy; length alone is not quality.

**Why:** Copied page controls, promotions and image credits can inflate the apparent article length. A longest-text-only policy can prevent correcting that contamination.

**How to apply:** Keep the unmodified source and earlier interpretations accessible, use conservative publisher-specific boundaries, and do not equate successful cleanup with confirmed article completeness. Ordinary shorter excerpts must still not displace fuller content.

Keep verified publisher publication times when a pasted copy provides only relative age or a yearless, zoneless display time.

**Why:** A copied “35 min ago” refers to when the user copied the page, not when a later import or re-extraction runs. An abbreviated month/day and time cannot safely supply a year or timezone.

**How to apply:** Improve article text and credits without replacing more precise existing time evidence. Do not fabricate missing time components from the current clock or a URL date alone.

Publisher recommendations may occur inside an article, not just after it.

**Why:** A Washington Post paste inserted ten “Most Read” cards before the article resumed with additional European and Asian reporting. Cutting everything after the module would have removed substantive content.

**How to apply:** Remove only structurally bounded recommendation cards and resume the article afterward; preserve ambiguous blocks. Validate cleanup against the supplied print view, keep contributor statements as article-specific credits, and retain raw originals even when a previously confirmed-complete copy needs cleanup.

Treat PDF text extraction as layout-sensitive.

**Why:** Print views can split contributor names across lines, and measured baseline spacing can differ from glyph height. Flattening those differences can destroy paragraph and attribution boundaries.

**How to apply:** Distinguish soft wraps from paragraph gaps using measured layout. Preserve the source PDF and avoid applying a single-column publisher layout rule to unrelated PDFs.

Video descriptions are retained content even when there is no article body or transcript.

**Why:** A CNN video exposed the relevant description in its VideoObject schema and page metadata, while its news-sitemap entry contained only a headline, URL and date. Article-only extraction would miss that text or mistake related-story navigation for reporting.

**How to apply:** Use explicit publisher video descriptions on standalone video pages, retain their raw source, and keep completeness unconfirmed. Do not replace an article with its embedded video's description or infer author credits merely from interview participants named in prose.

A successful ad-hoc public fetch does not establish that automated publisher access is working.

**Why:** The same CNN page returned public HTML to one request while the application's requests received HTTP 403.

**How to apply:** Preserve actual response provenance and keep publisher access failures/backoff honest. Local extraction of an already retrieved response can repair retained content without claiming the network restriction is resolved.

Background refreshes and metadata edits must not restore an already retained
historical body as the selected article text. Explicit reviewed imports may
replace the selection.

**Why:** A feed refresh can hold an older workspace snapshot while the user
cleans an article. That snapshot's “complete” flag describes its old version;
it must not silently undo the newer choice when the refresh finishes.

**How to apply:** Submit fresh publisher content rather than a pre-fetch
workspace snapshot, preserve source history, and check durability with a stale
writer replay—not just an immediate successful import response.
