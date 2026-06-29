---
description: Run the full pre-deploy safety and quality gate
---

Run the complete pre-deployment checklist for this trading bot backend. This handles real money, so all checks must pass.

Execute in order and report results:

1. `pnpm build` — must compile with no errors
2. `pnpm lint` — must pass
3. `pnpm test` — all unit tests must pass
4. `pnpm test:cov` — report coverage, flag if signal/ or trade/ modules are under 80%
5. `pnpm audit:check` — no high or critical vulnerabilities

Then do a manual review and report on:

6. **Secret safety** — grep the codebase for hardcoded secrets, API keys, passwords, or any `.env` secret reads. Confirm all sensitive values come from SecretsModule.
7. **Trade safety** — confirm the signal pipeline condition order is intact, SELL position check is present, quantity math guards divide-by-zero, and consecutive-failure auto-pause is wired up.
8. **Logging safety** — confirm no logger call outputs secrets, passwords, tokens, or full IG credential payloads.
9. **Endpoint guards** — confirm every portal endpoint is role-guarded and the webhook uses IP + secret guards (not JWT).

Produce a clear PASS/FAIL summary. If anything fails, list exactly what to fix. Do not suggest deploying if any check fails.
