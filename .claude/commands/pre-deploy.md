---
description: Run the full pre-deploy safety and quality gate
---

Run the complete pre-deployment checklist for this trading bot backend. This handles real money, so all checks must pass.

Execute in order and report results:

1. `pnpm build` — must compile with no errors
2. `pnpm lint` — must pass
3. `pnpm test` — all unit tests must pass
4. `pnpm test:cov` — report coverage, flag if signal/ or trade/ modules are under 80%
5. `pnpm audit:check` — no high or critical vulnerabilities. Reads `pnpm-lock.yaml`, so it audits the exact tree that ships; it is the same command CI runs. Fix a direct dependency by bumping its range in `package.json`, a transitive one with an entry under `overrides:` in `pnpm-workspace.yaml`.

Then do a manual review and report on:

6. **Secret safety** — grep the codebase for hardcoded secrets, API keys, passwords, or any `.env` secret reads. Confirm all sensitive values come from SecretsModule.
7. **Trade safety** — confirm the signal pipeline condition order is intact; the existing-position resolution (step 5) still runs ahead of the daily throttles and branches three ways (open / skip same-direction / reverse); the size math is the £-per-point stake formula with its divide-by-zero, floor-to-zero, and `minDealSize` guards; the live-quote gates (`NO_LIVE_QUOTE`, `MARKET_CLOSED`, signal-price plausibility) still run before any order; ambiguous `confirmDeal` results still reconcile against open positions before logging FAILED; and consecutive-failure auto-pause is wired up. Run `/audit-trade-path` for the deep version.
8. **Logging safety** — confirm no logger call outputs secrets, passwords, tokens, or full IG credential payloads.
9. **Endpoint guards** — confirm every portal endpoint is JWT-guarded, with `POST /auth/logout` as the one deliberate exception (see `rules.md`), and the webhook uses IP + secret guards (not JWT).
10. **Session recovery** — confirm `POST /auth/logout` still works without a session and `GlobalExceptionFilter` still clears a rejected `access_token` only when no `refresh_token` remains. Both are load-bearing: without them a lapsed session locks the user out until they clear cookies by hand.
11. **Production config** — confirm `ENABLE_TEST_SIGNALS` is not `true`, `TRADINGVIEW_IPS` is set (it fails closed, so an unset value means the bot silently never trades), and `CSRF_COOKIE_DOMAIN` is set if the portal and API are on different subdomains.

Produce a clear PASS/FAIL summary. If anything fails, list exactly what to fix. Do not suggest deploying if any check fails.
