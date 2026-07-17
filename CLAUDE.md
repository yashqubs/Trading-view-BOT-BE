# CLAUDE.md — Backend (NestJS Trading Bot)

This file gives Claude Code the context and rules for working in this repository. Read it fully before making changes.

---

## Project documentation reference

The full project documentation lives at `.claude/PROJECT_DOCUMENTATION.md`. Read the relevant sections before implementing any feature. The documentation is the source of truth for business logic, API contracts, IG endpoints, database schema, and trading rules.

### Which sections to read for each area of work

| Working on | Read sections |
|---|---|
| Auth / 2FA | Section 5 Layer 4, Section 6 (User Management), Section 8 users table |
| Secrets / Secrets Manager | Section 5 Layer 5, Section 7 (Environment Variables & Secrets) |
| Webhook endpoint | Section 5 Layer 3, Section 14 (TradingView Configuration) |
| Signal pipeline | Section 9 (Trading Conditions) — the 11-step condition order is mandatory |
| IG API calls | Section 15 (IG API Reference) — all 9 endpoints with versions and request bodies |
| Trade execution | Section 10 TradeModule, Section 15 endpoints 4, 5, 6, 7 |
| Database schema | Section 8 — every table, column, type, and all 17 trade statuses |
| Stats module | Section 12 (Dashboard & Statistics) — what data the frontend needs |
| User management | Section 6 — endpoints, create flow |
| Realtime / WebSocket | Section 10 RealtimeModule — internal event → broadcast event mapping |
| Backup / restore | Section 17, `.claude/scripts/backup-to-s3.sh` |
| Infrastructure / deployment | Sections 16, 18 |

### Most important things to know from the documentation

- Section 15 lists all 9 IG REST API endpoints to implement with exact path, version header, request/response shape. Use it as the definitive reference — do not guess endpoint details.
- Section 9 defines the exact condition check order. It must be followed precisely in `signal/signal.service.ts`. A technical (non-business) duplicate-delivery guard runs ahead of step 1 and logs `DUPLICATE_SIGNAL` — it is not one of the numbered steps.
- There are 19 trade statuses (Section 8), including `DUPLICATE_SIGNAL`, `ALREADY_LONG`, and `ALREADY_SHORT`. Every skip path logs a specific status — never generic failure. `MARKET_CLOSED` and `NO_POSITION` are legacy-only: the markets/trading-hours feature was removed (nothing writes `MARKET_CLOSED`), and short selling (2026-07-16) means a SELL with no position now opens a short instead of skipping (nothing writes `NO_POSITION` either) — historical rows keep both.
- There is no market-hours check — the markets feature (trading-hours profiles) was deliberately removed. Out-of-hours signals go to IG and are logged FAILED if rejected. Don't reintroduce it without discussing first.
- The global position cap, per-stock cool-down, and per-stock max-open-positions throttles were also deliberately removed (statuses `GLOBAL_POSITION_LIMIT`/`COOL_DOWN`/`MAX_POSITIONS_STOCK` are legacy-only). The remaining throttles are the daily investment/trade-count caps and per-stock daily spend. Don't reintroduce the removed ones without discussing first.
- Size (IG's `size` field — a £-per-point stake, NOT a share count, confirmed live 2026-07-15) = `investment_amount / price_in_points` via `calculateSize()` (Section 9), where `investment_amount` is the *resolved* amount via `resolveInvestmentAmount()` — a stock's own `stock_mapping.investment_amount` (nullable) overrides `trading_rules.investment_amount` (the global default, never null) when set. Never read `mapping.investmentAmount` directly for a trade calculation; always resolve it first. Signal price comes from TradingView webhook, NOT from IG (IG has no share price data — Section 19 Limitation 1), but must be scaled onto IG's points before sizing (see the price-scaling rule below). `trade_log.trade_value` stores the REAL £ notional (size × price_in_points), not the raw configured investment_amount — the two used to be conflated and it was misleading (a £2,000-intent PayPal test actually opened ~£90,000+ under the old shares-based sizing bug).
- **Short selling (added 2026-07-16): one position per ticker, at most, never hedged.** Every signal resolves the ticker's current open position first (Section 9 step 5). No position → the signal OPENS one (BUY opens a long, SELL opens a short — both are new exposure, both subject to the daily throttles). Position in the same direction already open → skipped (`ALREADY_LONG`/`ALREADY_SHORT`), so a repeated signal never doubles exposure. Position in the opposite direction → the signal CLOSES it (never throttled — blocking a close over a daily cap would leave unwanted exposure open). `TradeService.executeTrade` decides open-vs-close from whether `existingPosition` is null, NOT from `input.direction` — either direction can now open or close depending on what's already open. This reverses the pre-2026-07-16 rule that a SELL with no position always skips.
- Trades fill at MARKET price by default, or as a LIMIT order at the signal price ± slippage tolerance if `executionMode` (global `trading_rules.execution_mode`, overridable per-stock on `stock_mapping.execution_mode`) is SIGNAL_PRICE. A LIMIT order that can't fill immediately is logged FAILED — there is no working-order/pending-order lifecycle. Don't build one without discussing scope first (Section 9 "Execution Mode").
- **IG quotes in points, not dollars** (Section 9 "Price scaling + signal-price validation") — US share DFBs quote 1 point = 1 cent (GOOG $353.11 ≈ 35311 on IG). `TradeService.executeTrade` fetches the live quote before EVERY trade: it fails on no quote (`NO_LIVE_QUOTE`), fails if `snapshot.marketStatus !== 'TRADEABLE'` even when bid/offer are present (`MARKET_CLOSED` — added 2026-07-16 after a real order rejected for "Market closed" surfaced only as the unhelpful `error.confirms.deal-not-found`, since IG's confirms endpoint has nothing trackable to report for a gateway-level rejection), rejects signal prices >20% from the live market (`assertSignalPricePlausible` — an implausible price silently corrupts quantity, invested amount, executed price, and the slippage ceiling), scales LIMIT levels onto IG's quote (factor = nearest power of ten), and converts fill prices back with the same factor before storing `executed_price`. Never send a raw signal price as an IG `level`, and don't remove the plausibility or market-status gates.
- All secrets from AWS Secrets Manager (Section 7). Nothing sensitive in .env.
- No P&L is computed or stored anywhere in this backend, on purpose — a realized-P&L feature was built and then removed (see Section 19 Limitation 1). Don't reintroduce it without discussing it first.
- Only one active session per account, enforced server-side (Section 5 Layer 4): every full login stamps a fresh `users.current_session_id` and revokes every other refresh token for that user; `JwtStrategy` rejects any request whose JWT carries a stale session id, even before that token's own expiry. See `SessionService.establishFullSession` and `JwtStrategy.validate`.
- `POST /signal/test` (Section 9 "Dev Test Signal Endpoint") lets a logged-in portal user run a manual signal through the real pipeline for local testing, without waiting for TradingView. It's gated by `TestSignalsEnabledGuard`, which fails closed unless `ENABLE_TEST_SIGNALS=true` — never enable this in production; it places real IG orders exactly like the real webhook does. Its response includes `igDebug` — the raw IG request/response bodies for that one signal (`IgClientService.startRecording`/`stopRecording`) — surfaced in the portal as a "Raw IG API exchange" panel. Headers/secrets are never captured.
- The IG account is **spread betting (DFB)**, not CFD (Section 1, Section 15) — corrected after a real test signal hit `REJECT_CFD_ORDER_ON_SPREADBET_ACCOUNT`. The actual fix was `expiry: 'DFB'` (not `'-'`, which is CFD-only) in `IgClientService.placeOrder`/`closePosition`. `currencyCode: 'GBP'` is still required on `/positions/otc` regardless of account type — an earlier attempt removed it too and that was wrong (IG 400s with `validation.null-not-allowed.request.currencyCode` if it's missing). Don't remove `currencyCode` again.
- Close-position must go out as **POST + `_method: DELETE` header**, never a real DELETE — IG's gateway drops DELETE bodies and 400s with `validation.null-not-allowed.request` (confirmed live 2026-07-13; every close was broken until then). `IgClientService.request` handles this transparently for any DELETE-with-body. Don't "simplify" it back.
- **Ticker matching is case-insensitive** (`MappingService.findByTicker`, fixed 2026-07-16 — a real signal for "SILVER" was logged `NOT_MAPPED` against a mapping stored as "Silver"). Uses a parameterized `LOWER()` comparison via query builder, not `repository.findOne`. The DB also enforces this: `stock_mapping.tv_ticker`'s uniqueness is a case-insensitive functional index (`idx_stock_mapping_tv_ticker_ci` on `LOWER(tv_ticker)`), not the old case-sensitive column-level `unique: true` — don't re-add a plain unique constraint on this column.
- **`GET /confirms/{dealReference}` is unreliable — never trust it alone** (confirmed live 2026-07-16: GOOG, Coinbase, and Gold ×2 all filled on IG while `confirmDeal` threw `error.confirms.deal-not-found` or otherwise failed, and this app logged FAILED for a real, open position). `TradeService.executeTrade` treats any non-ACCEPTED/thrown confirm result as ambiguous and calls `reconcileAgainstOpenPositions()` (checks `GET /positions` for a matching new position on BUY, or the existing position's disappearance on SELL) before accepting FAILED as real. Don't remove this reconciliation step or assume `confirmDeal`'s word is final.
- **`tsconfig.json` has no `incremental` flag — don't re-add it.** It used to (`incremental: true`), which caused `nest build`/`nest start`/`nest start --watch` to silently emit nothing (still exit 0, "0 errors") whenever `dist/` was deleted (crash, manual cleanup, `deleteOutDir`) without the matching `.tsbuildinfo` cache also being cleared — a confusing "successful build produces no dist/main.js" failure hit repeatedly on 2026-07-15. Removed the setting entirely rather than special-case every entry point.

---

## What this project is

An automated trading bot backend. It receives TradingView webhook signals, validates them, maps tickers to IG broker Epic codes, checks trading conditions, and executes trades on the IG REST API. It also serves a REST API for the React admin portal (auth, user management, stock config, trading rules, statistics).

Trades involve real money. Correctness and safety are non-negotiable. When in doubt, fail safe (skip the trade and log it) rather than guessing.

## Tech stack

- NestJS (TypeScript) — modular monolith
- TypeORM + PostgreSQL (self-hosted on EC2, localhost only)
- AWS Secrets Manager for all sensitive secrets (never .env)
- JWT + bcrypt + optional email-OTP 2FA for portal auth (replaced an earlier TOTP design — see Section 5 Layer 4)
- Socket.IO (`@nestjs/websockets`) for pushing live updates to the portal
- @nestjs/axios for IG REST API calls
- @nestjs/schedule for cron (token refresh, backups)
- @nestjs/throttler for rate limiting
- Helmet for security headers
- class-validator + class-transformer for DTO validation
- pnpm as package manager
- Jest for tests

## Module map

- `auth/` — login, JWT, email-OTP 2FA, brute force lockout, token blacklist
- `user/` — user CRUD, password reset
- `secrets/` — fetches secrets from AWS Secrets Manager at boot
- `ig-client/` — IG REST API session + all IG calls (login, search, place, confirm, positions, close)
- `webhook/` — receives TradingView signals; IP whitelist + secret guards
- `signal/` — orchestrates the 11-step condition pipeline (plus a duplicate-delivery guard ahead of it)
- `trading-rules/` — global trading conditions (single row)
- `mapping/` — stock_mapping CRUD + IG market search
- `trade/` — trade execution + trade_log writing
- `stats/` — aggregated + per-stock statistics
- `system/` — webhook URL, IG connection status, last-received-signal status
- `realtime/` — WebSocket gateway broadcasting domain events to the portal
- `health/` — unauthenticated `GET /health` for uptime monitoring and deploy verification
- `scheduler/` — token refresh + nightly backup cron

## Hard rules

1. **Never log secrets.** IG API key, passwords, JWT secrets, webhook secret, OTP codes/hashes must never appear in logs, error messages, or responses.
2. **Never put secrets in .env.** All sensitive values come from `SecretsModule` (AWS Secrets Manager). The .env file holds only non-sensitive config.
3. **Always fail safe on trades.** If any condition is uncertain or any IG call errors, skip the trade and log it with a clear status. Never place a trade you are unsure about.
4. **Webhook endpoint must respond within 3 seconds.** Return 200 immediately, process the signal asynchronously. TradingView cancels slow webhooks.
5. **Always resolve the ticker's existing position before executing, for both directions.** A SELL with no open position opens a short; a BUY with no open position opens a long; either direction closes an opposite-direction position instead of opening; a same-direction signal while already in that direction is skipped (`ALREADY_LONG`/`ALREADY_SHORT`) rather than doubling exposure. This resolution step (Section 9 step 5) is mandatory and must never be removed or reordered after the daily throttle checks — whether they apply depends on it.
6. **Size comes from the signal price**, not IG (IG has no share price data), scaled onto IG's points. `size = floor((investment_amount / price_in_points) × 100) / 100` — a £-per-point stake, not a share count — floored so notional never exceeds the investment amount. Throws (logged FAILED) if that floors to zero or below IG's live minimum deal size (`dealingRules.minDealSize`).
7. **All DTOs are validated** with class-validator. No untyped `any` request bodies.
8. **All DB access via TypeORM repositories** with parameterized queries. Never build raw SQL strings from user input.
9. **Respect the condition check order** in `signal/` exactly as documented. The first failing condition stops processing and logs the specific status.
10. **No roles.** Every portal endpoint is guarded with `JwtAuthGuard`; every authenticated user has full access (an earlier ADMIN/VIEWER split was deliberately removed — don't reintroduce it).

## Code style

- Use NestJS conventions: modules, providers, controllers, guards, pipes, interceptors.
- One responsibility per service. Keep controllers thin — logic lives in services.
- Use dependency injection; never instantiate services manually.
- Prefer explicit return types on public methods.
- Use enums for fixed sets (TradeStatus, Direction).
- Errors: throw NestJS HttpExceptions with appropriate status codes. Never leak internal detail to the client.
- Async/await everywhere; no floating promises (handle or await).

## Testing

- Unit tests for all services, especially `signal/` (condition pipeline) and `trade/` (execution + quantity math).
- Mock the IG client in tests — never hit the real IG API in tests.
- Test every trade status path (each skip reason).
- Run `pnpm test` before committing. Run `pnpm test:cov` to check coverage.

## Commands

- `pnpm install` — install deps
- `pnpm start:dev` — run in watch mode
- `pnpm build` — production build
- `pnpm test` — unit tests
- `pnpm test:cov` — coverage
- `pnpm lint` — eslint
- `pnpm audit --audit-level=high` — dependency vulnerability check (must pass before deploy)
- `pnpm migration:run` — run TypeORM migrations
- `pnpm seed` — seed first user + trading_rules row
- `pnpm clear-db -- --yes` — wipe every row from every table (dev/demo only — hard-blocked when NODE_ENV=production). Run `pnpm seed` after to get back to a working state
- `pnpm clear-trades -- --yes` — wipe trade_log only (trade history) and reset the consecutive-failure counter + auto-pause flag; users, stock mappings, and all other trading rules stay intact (bot_enabled is never touched). Same production hard-block

## What to do before considering a task done

1. Code compiles (`pnpm build`)
2. Lint passes (`pnpm lint`)
3. Tests pass (`pnpm test`)
4. No secrets in code or logs
5. New endpoints are JWT-guarded and DTO-validated
6. If trade logic changed, the condition order and fail-safe behaviour are intact

## Don't

- Don't add a database other than PostgreSQL.
- Don't add the IG Streaming API (REST only for v1).
- Don't store secrets in .env or commit them.
- Don't remove or reorder safety checks in the signal pipeline.
- Don't add Vercel — frontend is Nginx/Cloudflare Pages.
- Don't introduce multi-tenancy (single IG account in v1).
- Don't set `ENABLE_TEST_SIGNALS=true` in production, and don't weaken `TestSignalsEnabledGuard`'s fail-closed default.
