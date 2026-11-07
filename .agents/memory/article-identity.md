---
name: Article identity
description: Why headline mismatches need source identity checks and an explicit cross-record review.
---

All intake entry points should use the same paste/URL/upload analyzer. A detected
existing-item match must ask whether to update that item or create a separate
one, rather than silently choosing an update.

**Why:** The user asked for Feed intake to open the standard analyzer and for an
explicit update-versus-new decision when a match is detected.

**How to apply:** Keep review before saving, preserve the original on separate
creation, and do not duplicate a verified source URL; a separate source needs
its own identity.

Use verified source URLs ahead of headline wording when establishing article identity. Do not merge articles merely because they share an outlet, subject or similar headline.

**Why:** A CNN paste referred to a November 6 video while the selected record described a separate November 5 video. The publisher page screenshot showed the later clip, but the earlier URL still returned distinct canonical metadata. Treating that as a headline rename would have mixed two source records.

**How to apply:** If a manual import exactly matches another known article, retain the paste and offer an explicit review of that destination before saving. Leave the originally selected article unchanged. Unattended enrichment must reject a cross-record mismatch rather than silently redirecting the job.

Historical headline identity must come from observed publisher metadata, never from a pasted headline or an analyst's display-title edit. Match a historical headline only with its publisher and without a conflicting supplied URL.

**Why:** Publishers revise headlines, but they also reuse headlines for separate clips on different days. Treating every pasted title as an alias would turn a correction into unverified identity evidence and could mix distinct reporting.

**How to apply:** Keep source provenance and canonical article identity with observations. Combine current-title and historical-title matches before deciding uniqueness; ambiguous evidence must stop for review rather than being resolved by list order or unattended target selection.
