---
name: Article identity
description: Why headline mismatches need source identity checks and an explicit cross-record review.
---

Use verified source URLs ahead of headline wording when establishing article identity. Do not merge articles merely because they share an outlet, subject or similar headline.

**Why:** A CNN paste referred to a November 6 video while the selected record described a separate November 5 video. The publisher page screenshot showed the later clip, but the earlier URL still returned distinct canonical metadata. Treating that as a headline rename would have mixed two source records.

**How to apply:** If a manual import exactly matches another known article, retain the paste and offer an explicit review of that destination before saving. Leave the originally selected article unchanged. Unattended enrichment must reject a cross-record mismatch rather than silently redirecting the job.
