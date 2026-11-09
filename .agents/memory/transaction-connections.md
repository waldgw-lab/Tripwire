---
name: Transaction connection discipline
description: Avoid pooled-connection deadlocks while workspace article locks are held.
---
Once a transaction holds a workspace advisory lock, every database helper called
inside it must use that same transaction, including read-only catalog and
retained-content lookups.

**Why:** With a small pool, a lock holder that requests another pooled connection
can deadlock against a competing transaction occupying that connection while
waiting for the holder's lock. Successful single-request testing misses this.

**How to apply:** Thread the transaction through nested readers and writers.
Exercise simultaneous successful writes and stale-revision conflicts with a
two-connection pool; do not use a separate pool query inside the locked path.

Use supersession relationships and explicit correction context rather than
timestamps to determine which decision a later review assesses.

**Why:** PostgreSQL transaction timestamps reflect transaction start, which can
precede time spent waiting for the workspace lock. They are not a reliable
ordering of analyst decisions after the lock is acquired.

**How to apply:** Bind reviews to the correction identity they actually reviewed;
retain earlier reviews as history rather than carrying their conclusions forward.
