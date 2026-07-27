# Trading bot backend

NestJS API for the TradingView → IG trading bot. It receives TradingView webhook signals, validates them against a fixed pipeline of trading conditions, maps tickers to IG epic codes, and places real orders on the IG REST API. It also serves the REST + WebSocket API behind the React admin portal (`Trading-view-BOT-FE`, sibling repo).

**This moves real money.** Read [CLAUDE.md](./CLAUDE.md) before changing anything in `signal/` or `trade/`, and [.claude/PROJECT_DOCUMENTATION.md](./.claude/PROJECT_DOCUMENTATION.md) for the full specification — business logic, API contracts, IG endpoint reference, database schema, and infrastructure. That document is the source of truth; this README is only the entry point.

## Setup

Requires Node 24, pnpm, and a local PostgreSQL 18 instance.

```bash
pnpm install
cp .env.example .env      # then fill in the local-only values at the bottom
createdb trading_view_bot # or however you provision Postgres locally
pnpm migration:run
pnpm seed                 # creates the first user + the trading_rules row
pnpm start:dev
```

`pnpm seed` prints a one-time temporary password unless you set `SEED_ADMIN_PASSWORD`. The first login forces a password change.

### Configuration

`.env.example` documents every key. The short version:

- **Local dev** — set `SECRETS_SOURCE=local` and fill in `IG_API_KEY`, `IG_USERNAME`, `IG_PASSWORD`, `JWT_SECRET`, `WEBHOOK_SECRET` directly in `.env`.
- **Production** — set `SECRETS_SOURCE=aws`. The `.env` then holds only bootstrap keys (`NODE_ENV`, `AWS_REGION`, `SECRET_NAME_APP`, `SECRET_NAME_IG`); everything else lives as JSON inside the AWS Secrets Manager secret, which `main.ts` merges into `process.env` at boot. Editing the secret and restarting PM2 applies it — no redeploy.

**Never put a secret in `.env` in production, and never log one.** See Section 7 of the project documentation.

Two keys that are easy to miss:

- `TRADINGVIEW_IPS` — unset means `TradingViewIpGuard` rejects every webhook (fails closed). The bot silently never trades.
- `CSRF_COOKIE_DOMAIN` — required when the portal and API sit on different subdomains (e.g. `trade.` calling `api-trade.`), otherwise the portal's JS can't read the `csrf_token` cookie and every mutation 403s.

## Commands

| Command | What it does |
|---|---|
| `pnpm start:dev` | Watch mode |
| `pnpm build` | Production build |
| `pnpm start:prod` | Run the built server |
| `pnpm test` / `pnpm test:cov` | Unit tests / with coverage |
| `pnpm lint` | ESLint (`--fix`) |
| `pnpm audit:check` | Fails on high-severity vulnerabilities **in the real lockfile** — run this before releasing (see below) |
| `pnpm migration:run` / `migration:revert` | Apply / roll back TypeORM migrations |
| `pnpm migration:generate src/database/migrations/<Name>` | Generate a migration from entity changes |
| `pnpm seed` | First user + `trading_rules` row (skipped once any user exists) |
| `pnpm clear-db -- --yes` | Wipe every row from every table. Run `pnpm seed` after |
| `pnpm clear-activity -- --yes` | Wipe trade history + every session, **keeping stocks, users, and all trading_rules configuration** |
| `pnpm clear-trades -- --yes` | Wipe `trade_log` only, plus reset the consecutive-failure counter and auto-pause flag |
| `pnpm remove-stock <TICKER>... -- --yes` | Delete those stocks' mappings *and* their `trade_log` history, in one transaction (`--all` for every stock) |

All three `clear-*` scripts are hard-blocked when `NODE_ENV=production`, and each refuses to do anything without `--yes` (printing exactly what it would touch first). They differ only in blast radius:

| | `trade_log` | sessions | `trading_rules` config | `stock_mapping` | `users` |
|---|---|---|---|---|---|
| `clear-trades` | wiped | kept | kept (failure counters reset only) | kept | kept |
| `clear-activity` | wiped | wiped | kept (failure counters reset only) | kept | kept |
| `clear-db` | wiped | wiped | **wiped** | **wiped** | **wiped** |

`clear-activity` is `clear-trades` plus also signing everyone out — it never touches configuration. Investment amount, execution mode, slippage, daily caps, `allow_buy`/`allow_sell`, and `bot_enabled` all keep exactly the values they were set to; only `consecutive_failure_count` and `auto_paused` reset to 0/false, since those are *derived* from trade history (now gone), not settings — the same thing `clear-trades` already does when it empties `trade_log`. Everyone is signed out, since clearing `refresh_tokens` revokes every session; credentials are unchanged.

**`bot_enabled` is never touched by any of them.** If the bot was off — manually or by auto-pause — it stays off, and a human turns it back on knowingly from the portal. A cleanup script must never be the reason a trading bot starts placing orders again.

Only `clear-db` needs `pnpm seed` afterwards; the other two leave the app fully working.

## Architecture

A modular monolith. One NestJS process, PostgreSQL on the same EC2 box (loopback only), no queue and no cache layer.

| Module | Responsibility |
|---|---|
| `webhook/` | Receives TradingView signals — IP whitelist + shared-secret guards. Responds within 3s, processes asynchronously |
| `signal/` | The condition pipeline (Section 9). The order is mandatory; the first failing check stops processing and logs a specific status |
| `trade/` | Order execution against IG, `trade_log` writes, and the manual close-all-positions path |
| `ig-client/` | IG REST session management and every IG call (Section 15) |
| `mapping/` | `stock_mapping` CRUD + IG market search |
| `trading-rules/` | Global trading conditions (single row) |
| `auth/` | Login, JWT cookies, email-OTP 2FA, brute-force lockout, refresh tokens, single-session enforcement |
| `user/` | User CRUD, password reset |
| `stats/` | Aggregated + per-stock statistics, open positions |
| `system/` | Webhook URL, IG connection status, last-received-signal, feature flags |
| `realtime/` | Socket.IO gateway broadcasting domain events to the portal |
| `email/` | AWS SES sender (OTP, invite, reset) — authorized by the EC2 IAM role, no stored credentials |
| `secrets/` | Fetches secrets from AWS Secrets Manager at boot |
| `scheduler/` | IG token refresh + nightly S3 backup cron |
| `health/` | Unauthenticated `GET /health` for uptime monitoring and deploy verification |

### Things that will bite you if you don't know them

These are the non-obvious behaviours that cost real money or real debugging time to discover. Each is explained fully in the project documentation.

- **IG quotes in points, not dollars.** A US share DFB quotes 1 point = 1 cent, so GOOG at \$353.11 is `35311` on IG. Never send a raw TradingView price as an IG `level`.
- **The account is spread betting (DFB), not CFD.** Orders need `expiry: 'DFB'`, and `/positions/otc` still requires `currencyCode: 'GBP'` regardless.
- **`size` is a £-per-point stake, not a share count.** Conflating the two once opened a ~£90,000 position from a £2,000 intent.
- **Close-position must be POST with a `_method: DELETE` header.** IG's gateway drops DELETE bodies. `IgClientService.request` handles this transparently — don't "simplify" it.
- **`GET /confirms/{dealReference}` is unreliable — never trust it alone.** Real filled trades have been reported as `deal-not-found`. Any ambiguous confirm is reconciled against `GET /positions` before FAILED is logged.
- **One position per ticker, never hedged.** Since short selling was added, either direction can open *or* close depending on what's already open — `TradeService.executeTrade` decides from whether `existingPosition` is null, never from the signal direction. An opposite-direction signal **reverses**: it closes, then reopens the other way, writing two `trade_log` rows.
- **`trade_value` is populated for closes too.** What keeps a close out of "money invested" totals and daily caps is `is_closing_trade`, not a null `trade_value` — filter on the boolean.
- **No P&L is computed or stored anywhere, on purpose.** A realized-P&L feature was built and removed because the numbers weren't trustworthy.
- **`tsconfig.json` has no `incremental` flag — don't re-add it.** It made `nest build` silently emit nothing whenever `dist/` was deleted without the matching `.tsbuildinfo`.

## Auth model

Portal auth is cookie-based, never a bearer token the frontend has to store.

- **Access token** — JWT in an HttpOnly/Secure/SameSite=Strict cookie, 15 minutes.
- **Refresh token** — opaque, hashed in `refresh_tokens`, single-use, rotated on every `POST /auth/refresh`. Its 1-hour window is a *sliding idle timeout*: an active user never notices it, and an idle one is logged out. This is deliberate — see the session TTL note in Section 5 Layer 4.
- **CSRF** — a non-HttpOnly `csrf_token` cookie double-submitted as the `X-CSRF-Token` header on every mutating request, on top of SameSite=Strict.
- **Single active session** — every full login stamps a new `users.current_session_id` and revokes the account's other refresh tokens. `JwtStrategy` rejects any token carrying a stale session id on its very next request.
- **Session recovery** — `POST /auth/logout` is deliberately unauthenticated, and a 401 on an unrecoverable session clears the dead cookies automatically. Both exist so a lapsed session can never leave a user stuck; see Section 5 Layer 4 "Session recovery".

## Testing

```bash
pnpm test
```

Unit tests cover every service, with the heaviest coverage on `signal/` (the condition pipeline) and `trade/` (execution, sizing, price scaling, reconciliation). **The IG client is always mocked — no test may hit the real IG API.** Every trade status path, including each skip reason, has a test.

## Deployment

Push to `main` runs `.github/workflows/ci.yml`: lint → build → test → dependency audit, and only then SSH-deploys to EC2 (migrate + `pm2 restart`). The deploy job is gated behind the CI job with `needs:`, so a failing check blocks the release rather than merely warning.

### Dependency audits

CI runs `pnpm audit --audit-level=high`, which reads `pnpm-lock.yaml` — so it audits **the exact tree that ships**. `pnpm audit:check` is the same command; run it locally and you get CI's answer.

It used to shell out to `npm audit` against a lockfile regenerated from `package.json` in a temp dir, because pnpm v10's audit hit npm's retired REST endpoints. That workaround had a real blind spot — npm resolves each range to its newest version, while `pnpm-lock.yaml` pins whatever was locked at write time, so an advisory affecting only a pinned older version passed CI and deployed anyway. On 2026-07-27 it was concealing two high-severity `fast-uri` advisories and a moderate `typeorm` one. pnpm v11 audits correctly, so the workaround is gone.

### Fixing a vulnerability

- **Direct dependency** → bump its range in `package.json`.
- **Transitive dependency** → add an entry to `overrides:` in **`pnpm-workspace.yaml`**. That is the single source of truth: pnpm ignores `package.json`'s top-level `overrides`, and since v11 the `pnpm.overrides` key too. Because CI audits the pnpm lockfile, one entry there fixes both the shipped tree and the CI gate.

Prefer the narrowest range that clears the advisory, and note *why* in a comment — e.g. `fast-uri` is capped below 4 because ajv declares `^3`.

Requires repo secrets `EC2_HOST`, `EC2_SSH_USER`, `EC2_SSH_KEY` and repo variable `DEPLOY_PATH`. Full server setup — Nginx, Certbot, PostgreSQL, PM2, Fail2ban, backups — is in Sections 16 and 18 of the project documentation.

Nightly database backups go to encrypted S3 via `.claude/scripts/backup-to-s3.sh` (cron, 02:00); `restore-from-s3.sh` restores the latest or a specified dump.

## Further reading

- [CLAUDE.md](./CLAUDE.md) — working rules, module map, hard constraints
- [.claude/PROJECT_DOCUMENTATION.md](./.claude/PROJECT_DOCUMENTATION.md) — full specification (source of truth)
- [.claude/rules.md](./.claude/rules.md) — coding, security, and trade-safety rules
- [.claude/README.md](./.claude/README.md) — what the `.claude/` tooling does
