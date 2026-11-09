# Margo

A personal money app for tracking everyday spending, taxable non-W-2 income, tax set-aside estimates, and receipt-based product savings.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/aliena-money/` — Margo web app and visual theme
- `artifacts/api-server/src/routes/finance.ts` — authenticated finance and receipt API
- `lib/api-spec/openapi.yaml` — API contract and generated client source
- `lib/db/src/schema/finance.ts` — transactions, finance settings, and receipt schema
- `lib/db/src/schema/auth.ts` — account and session schema
- `artifacts/api-server/src/routes/storage.ts` — private receipt file upload and serving

## Architecture decisions

- Plaid is not connected; the sample accounts view uses fictional data kept separate from real ledger totals.
- The monthly spending plan is based on take-home income, savings goals, and user-selected priority categories.
- Tax set-aside is a user-selected planning percentage applied to taxable non-W-2 income, not tax advice.
- Receipt line items are entered manually; comparisons use matching user-entered categories and annual usage.
- Receipt images are private and scoped to the authenticated account.

## Product

The app provides an overview, manual income and expense tracking, a priorities-based monthly plan, an adjustable tax set-aside estimate, private receipt uploads with product details, and side-by-side cheaper alternatives with estimated annual savings.

## User preferences

- Use the current Margo design system: cream `#FBF6E4`, white cards with `#E8DFC4` borders, navy `#0B1F4B`, secondary text `#4A5578`, burgundy `#5A0F1A`, olive `#6D712E` for savings tags, and light blue `#C9DBEC` only for navy progress fills or income icons.
- Use Fraunces 600 for headings and DM Sans for other text. Main screens share a wax-seal Margo header and bottom navigation with Home, Spending, a raised center plus, Swaps, and Apps (the Money apps page, route `/earn-save`).
- Web app layout: `src/App.tsx` is routing only. Screens live in `src/screens/` (home, spending, receipts, swaps, money-apps, settings, onboarding, avatar, welcome). Shared pieces live in `src/components/margo/` (`chrome.tsx` for header, nav, + sheet and states; `art.tsx` for the seal, product cut-outs and coin avatar). All styling is the `m-` classes in `src/index.css`; do not add another layer of overrides on top.
- The coin avatar, saved swaps and switched swaps are stored in the swap profile's `onboardingAnswers` (`avatar`, `savedSwaps`, `switchedSwaps`) so they follow the user across devices.
- Money apps are listed in `src/screens/money-apps.tsx`. Swap in referral links there and fill `helped` to show "How it helped me".

## Gotchas

- Regenerate API client and Zod schemas from `lib/api-spec/openapi.yaml` after contract changes.
- Protect finance data and receipt images with the current authenticated user ID on every server route.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

## Bank connections (Plaid)
- Users can connect as many banks and cards as they want. Each one is a separate Plaid Item. Access tokens are AES-256-GCM encrypted at rest and never sent to the browser. Margo never sees bank passwords.
- Secrets: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` (`sandbox` or `production`, defaults to sandbox), and `PLAID_TOKEN_KEY` (a long random string used only to encrypt bank tokens; older tokens saved with the session key still work).
- The app calls `POST /api/plaid/sync-all` when Home opens. It refreshes banks that haven't synced in 4 hours.

## Swap catalog
- Admins are listed in `SWAP_CATALOG_ADMIN_EMAILS`. They see an Admin section in Settings that links to `/admin/swaps`, where they can import the CSV and fill in prices.
- A swap shows to users only when its status starts with "Ready" and both prices are above zero.
