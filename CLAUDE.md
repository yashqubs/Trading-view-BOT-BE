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
| Signal pipeline | Section 9 (Trading Conditions) — the 15-step condition order is mandatory |
| IG API calls | Section 15 (IG API Reference) — all 9 endpoints with versions and request bodies |
| Trade execution | Section 10 TradeModule, Section 15 endpoints 4, 5, 6, 7 |
| Database schema | Section 8 — every table, column, type, and all 17 trade statuses |
| Stats module | Section 12 (Dashboard & Statistics) — what data the frontend needs |
| User management | Section 6 — endpoints, roles, create flow |
| Realtime / WebSocket | Section 10 RealtimeModule — internal event → broadcast event mapping |
| Backup / restore | Section 17, `.claude/scripts/backup-to-s3.sh` |
| Infrastructure / deployment | Sections 16, 18 |

### Most important things to know from the documentation

- Section 15 lists all 9 IG REST API endpoints to implement with exact path, version header, request/response shape. Use it as the definitive reference — do not guess endpoint details.
- Section 9 defines the exact 15-step condition check order. It must be followed precisely in `signal/signal.service.ts`. A technical (non-business) duplicate-delivery guard runs ahead of step 1 and logs `DUPLICATE_SIGNAL` — it is not one of the 15 steps.
- There are 17 trade statuses (Section 8), including `DUPLICATE_SIGNAL`. Every skip path logs a specific status — never generic failure.
- Quantity = `investment_amount / signal_price` (Section 9). Signal price comes from TradingView webhook, NOT from IG (IG has no share price data — Section 19 Limitation 1).
- SELL always checks open positions first (Section 9 step 12). This is not optional.
- Trades fill at MARKET price by default, or as a LIMIT order at the exact signal price if `executionMode` (global `trading_rules.execution_mode`, overridable per-stock on `stock_mapping.execution_mode`) is SIGNAL_PRICE. A LIMIT order that can't fill immediately is logged FAILED — there is no working-order/pending-order lifecycle. Don't build one without discussing scope first (Section 9 "Execution Mode").
- All secrets from AWS Secrets Manager (Section 7). Nothing sensitive in .env.
- No P&L is computed or stored anywhere in this backend, on purpose — a realized-P&L feature was built and then removed (see Section 19 Limitation 1). Don't reintroduce it without discussing it first.

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
- `user/` — user CRUD, roles (ADMIN/VIEWER), password reset
- `secrets/` — fetches secrets from AWS Secrets Manager at boot
- `ig-client/` — IG REST API session + all IG calls (login, search, place, confirm, positions, close)
- `webhook/` — receives TradingView signals; IP whitelist + secret guards
- `signal/` — orchestrates the 15-step condition pipeline (plus a duplicate-delivery guard ahead of it)
- `trading-rules/` — global trading conditions (single row)
- `mapping/` — stock_mapping CRUD + IG market search (reads open to any role, writes ADMIN-only)
- `trade/` — trade execution + trade_log writing
- `stats/` — aggregated + per-stock statistics
- `system/` — webhook URL, IG connection status, last-received-signal status
- `realtime/` — WebSocket gateway broadcasting domain events to the portal
- `scheduler/` — token refresh + nightly backup cron

## Hard rules

1. **Never log secrets.** IG API key, passwords, JWT secrets, webhook secret, OTP codes/hashes must never appear in logs, error messages, or responses.
2. **Never put secrets in .env.** All sensitive values come from `SecretsModule` (AWS Secrets Manager). The .env file holds only non-sensitive config.
3. **Always fail safe on trades.** If any condition is uncertain or any IG call errors, skip the trade and log it with a clear status. Never place a trade you are unsure about.
4. **Webhook endpoint must respond within 3 seconds.** Return 200 immediately, process the signal asynchronously. TradingView cancels slow webhooks.
5. **Always check open positions before a SELL.** A SELL with no open position opens a short. The position check is mandatory and must never be removed.
6. **Quantity comes from the signal price**, not IG (IG has no share price data). `quantity = investment_amount / signal_price`, rounded to 4 dp.
7. **All DTOs are validated** with class-validator. No untyped `any` request bodies.
8. **All DB access via TypeORM repositories** with parameterized queries. Never build raw SQL strings from user input.
9. **Respect the condition check order** in `signal/` exactly as documented. The first failing condition stops processing and logs the specific status.
10. **Two roles only** (ADMIN, VIEWER) in v1. Guard every portal endpoint with the correct role.

## Code style

- Use NestJS conventions: modules, providers, controllers, guards, pipes, interceptors.
- One responsibility per service. Keep controllers thin — logic lives in services.
- Use dependency injection; never instantiate services manually.
- Prefer explicit return types on public methods.
- Use enums for fixed sets (TradeStatus, UserRole, Direction).
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
- `pnpm seed` — seed first admin user + trading_rules row

## What to do before considering a task done

1. Code compiles (`pnpm build`)
2. Lint passes (`pnpm lint`)
3. Tests pass (`pnpm test`)
4. No secrets in code or logs
5. New endpoints are role-guarded and DTO-validated
6. If trade logic changed, the condition order and fail-safe behaviour are intact

## Don't

- Don't add a database other than PostgreSQL.
- Don't add the IG Streaming API (REST only for v1).
- Don't store secrets in .env or commit them.
- Don't remove or reorder safety checks in the signal pipeline.
- Don't add Vercel — frontend is Nginx/Cloudflare Pages.
- Don't introduce multi-tenancy (single IG account in v1).
