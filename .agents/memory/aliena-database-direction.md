---
name: Margo database direction
description: The user's current database-provider decision for Margo.
---

Use the existing PostgreSQL/Drizzle database for Margo. Do not connect Supabase for now.

**Why:** the user explicitly asked to forget Supabase and focus on the rest of the product.

**How to apply:** keep future schema and API work additive to the current database unless the user explicitly changes this direction.
