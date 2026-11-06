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

Publisher recommendations may occur inside an article, not just after it.

**Why:** A Washington Post paste inserted ten “Most Read” cards before the article resumed with additional European and Asian reporting. Cutting everything after the module would have removed substantive content.

**How to apply:** Remove only structurally bounded recommendation cards and resume the article afterward; preserve ambiguous blocks. Validate cleanup against the supplied print view, keep contributor statements as article-specific credits, and retain raw originals even when a previously confirmed-complete copy needs cleanup.

Treat PDF text extraction as layout-sensitive and its input buffers as transferable.

**Why:** The print view split contributor names across lines, and line height differed from baseline spacing. Reusing transferred bytes caused cloning errors; assuming a conventional PDF.js proxy destroy method also failed with the installed unpdf runtime.

**How to apply:** Use a fresh byte copy, release the loading task, and distinguish soft wraps from paragraph gaps using measured spacing. Preserve the source PDF and avoid applying a single-column publisher layout rule to unrelated PDFs.
