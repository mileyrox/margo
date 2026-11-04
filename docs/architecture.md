# Aliena data relationships

The purchase-intelligence model extends the existing PostgreSQL/Drizzle database. It does not replace the current user, transaction, receipt, or budget-plan tables.

```mermaid
erDiagram
  users ||--o{ receipts : uploads
  users ||--o{ transactions : owns
  users ||--o{ user_product_purchases : buys
  users ||--o{ integration_connections : connects
  users ||--o{ recurring_subscriptions : tracks
  users ||--o{ billing_subscriptions : subscribes
  users ||--o{ browser_extension_tokens : authorizes
  receipts ||--o{ user_product_purchases : contains
  transactions o|--o{ user_product_purchases : correlates
  transactions o|--o{ recurring_subscriptions : detects
  products o|--o{ user_product_purchases : identifies
  products ||--o{ product_alternatives : has_alternative
  products ||--o{ product_alternatives : is_alternative
  product_alternatives ||--o{ product_votes : receives
  users ||--o{ product_votes : casts
  products ||--o{ affiliate_links : offers
```

`integration_connections.encrypted_credential` is intended for server-side encrypted provider credentials only; tokens must never be returned to the browser. `browser_extension_tokens` stores token hashes, not raw extension credentials. Plaid, email, Stripe, and extension traffic still require provider-specific consent, credential encryption, webhook validation, and authorization before production connections are enabled.
