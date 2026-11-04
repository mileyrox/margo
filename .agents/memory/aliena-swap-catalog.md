---
name: Margo swap catalog
description: Catalog import, approval, pricing, and user-visibility rules for swaps.
---

The Margo swap CSV is keyed by its `id`; re-imports update matching rows instead of duplicating them. Users may see only rows whose status begins with `Ready`, never rows marked `Don't show as a dupe`, and never rows without both product prices. `Review first` rows stay hidden until an admin approves them. Keep every CSV flag visible and editable in admin. Show `differences` beneath `why similar` on the user detail page. Calculate per-ounce savings when both product sizes and prices are known.

**Why:** The user specified these rules when importing the Margo swaps CSV on November 4, 2026.

**How to apply:** Preserve the stable CSV IDs and visibility constraints across future catalog imports, admin edits, and user-facing swap screens.
