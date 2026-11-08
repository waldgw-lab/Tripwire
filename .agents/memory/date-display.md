---
name: Date display
description: User-requested date appearance throughout Tripwire.
---
Display dates as an unpadded day and uppercase abbreviated month, for example
`8 NOV`. Only display the year when it differs from the current year. This applies
throughout the app, including Feed and Claims.

**Why:** The user explicitly requested normalized dates throughout Tripwire.

**How to apply:** Preserve the underlying timestamp and date precision; this is a
display rule, not permission to change stored dates or manufacture missing dates.
