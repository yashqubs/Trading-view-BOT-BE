# Coding Rules — Backend

These rules supplement CLAUDE.md. They are enforced in review.

## Architecture

- Modular monolith. Each domain is a module with its own controller, service(s), entities, DTOs.
- Controllers are thin. They validate input, call a service, return the result. No business logic.
- Services hold all logic. Inject dependencies via constructor.
- Cross-module dependencies go through exported providers, never reaching into another module's internals.
- The `ig-client` module is the ONLY place that talks to the IG API. No other module makes HTTP calls to IG.
- The `secrets` module is the ONLY place that reads from AWS Secrets Manager.

## Security rules

- Every portal endpoint has a guard: `@UseGuards(JwtAuthGuard)`. There are no roles — every authenticated user has full access. **One deliberate exception:** `POST /auth/logout` is unguarded, because requiring a valid session to end one locks out exactly the user whose session already died (Section 5 Layer 4 "Session recovery"). Don't "fix" it by adding the guard back.
- The webhook endpoint uses `TradingViewIpGuard` and `WebhookSecretGuard`, not JWT.
- Validate every request body with a DTO and class-validator decorators. Enable `whitelist: true` and `forbidNonWhitelisted: true` on the global ValidationPipe.
- Never return password_hash or otp_code_hash in any response. Use class-transformer `@Exclude()`.
- Rate limit: login + password reset (5/15min), `/auth/refresh` (30/15min — every open tab refreshes on access-token expiry, so the login limit is far too tight), `POST /trades/close-all-positions` (3/min — it places real orders against every open position), webhook (60/min), global default (100/min).
- Hash passwords with bcrypt cost 12. Never store or log plaintext.
- 2FA is optional email-OTP, not TOTP — only a short-lived hash of the current code is stored (`otp_code_hash` + `otp_expires_at`), never a long-lived secret. Nothing OTP-related needs encryption at rest.
- Every mutating request needs a matching `X-CSRF-Token` header (double-submit against the `csrf_token` cookie) — enforced by `CsrfGuard`. Its exempt list (`/webhook`, `/auth/login`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/logout`) is not laziness: each of those authorizes by something other than the session cookie, and enforcing CSRF on them can lock a user out of logging in or clearing a broken cookie jar.

## Trade safety rules

- The signal pipeline checks conditions in the exact documented order. Do not reorder.
- Each condition that fails writes a trade_log row with the specific status and stops.
- **Always resolve the ticker's existing position first, for both directions** (Section 9 step 5). Since short selling (2026-07-16) there is at most one position per ticker, never hedged: no position → the signal OPENS one (BUY opens a long, SELL opens a short, both subject to the daily throttles); same-direction position already open → skip with `ALREADY_LONG`/`ALREADY_SHORT` rather than doubling exposure; opposite-direction position → **REVERSE** it (close, then reopen in the signal's direction). The close is never throttled — blocking it over a daily cap would strand unwanted exposure. The reopen happens only if the close returned SUCCESS, and *is* throttled like any new exposure; a throttled reopen leaves the ticker flat, and a failed close means no reopen at all. A reversal therefore writes two `trade_log` rows. `TradeService.executeTrade` decides open-vs-close from whether `existingPosition` is null, **never** from `input.direction`. `NO_POSITION` is legacy-only — nothing writes it any more.
- **`size` is a £-per-point stake, not a share count.** `size = floor((investment_amount / price_in_points) × 100) / 100` (`calculateSize`), floored so the real notional never exceeds the investment amount. Throws — and so logs FAILED — if it floors to zero or falls below IG's live `dealingRules.minDealSize`. `price_in_points` must already be on IG's quote scale; passing a raw dollar price reproduces the overexposure bug this replaced. `investment_amount` comes from `resolveInvestmentAmount(mapping, rules)` — a stock's own override, falling back to the global `trading_rules.investment_amount` when null. Never read `mapping.investmentAmount` directly.
- **Anchor every trade to IG's live quote before sending anything**: fail on no quote (`NO_LIVE_QUOTE`), fail if `snapshot.marketStatus !== 'TRADEABLE'` (`MARKET_CLOSED`), and reject signal prices more than 20% from the live market (`assertSignalPricePlausible`) — an implausible price silently corrupts size, notional, executed price, and the slippage ceiling at once.
- **Never trust `confirmDeal` alone.** Any non-ACCEPTED or thrown confirm result is *ambiguous*, not a failure: reconcile against `GET /positions` (`reconcileAgainstOpenPositions`) before logging FAILED. Real filled trades have been reported as `error.confirms.deal-not-found`.
- After a FAILED trade, increment `consecutive_failure_count`. If it reaches `max_consecutive_failures`, set `bot_enabled = false` and log AUTO_PAUSED. **Manual actions are exempt** — `closeAllOpenPositions` never moves that counter in either direction, so a user closing out after hours can't silently pause the bot.
- Every IG call is wrapped in try/catch. On error, log FAILED with the IG error code (not the full error object).
- **No script or automated path ever sets `bot_enabled = true`.** `clear-trades` and `clear-activity` leave `trading_rules` configuration fully alone (only the derived `consecutive_failure_count`/`auto_paused` reset); `clear-db` wipes the whole table, requiring `pnpm seed` to rebuild it at defaults. Only auto-pause may turn `bot_enabled` *off*; only a human turns it back on, from the portal. A maintenance script must never be the reason the bot starts placing orders again.

## Database rules

- All access via TypeORM repositories. No raw SQL with interpolated user input.
- Migrations for every schema change. Never `synchronize: true` in production.
- Use transactions where multiple writes must succeed together.
- Decimal columns for money/quantity (never float). Always add `transformer: decimalTransformer` (`src/common/transformers/decimal.transformer.ts`) to every `decimal`/`numeric` column — node-postgres returns them as strings by default, and without the transformer the entity property is typed `number` but is actually a string at runtime, which breaks any `.toFixed()`/arithmetic call on it (this exact bug happened once — see `TradeLog`, `StockMapping`, `TradingRules`).
- Timestamps in UTC.

## Error handling

- Throw `HttpException` subclasses (BadRequestException, UnauthorizedException, etc.).
- Never leak stack traces or internal messages to clients.
- Log errors server-side with context but without secrets.
- Use a global exception filter to standardize error responses.

## Logging

- Use the NestJS Logger.
- Never log: secrets, passwords, tokens, full IG payloads with credentials.
- Do log: trade decisions, condition skips (with reason), IG error codes, auth events (without secrets).

## Testing

- Mock IG client and Secrets Manager in all tests. **No test may hit the real IG API.**
- Cover every trade status path — every skip reason gets its own test.
- Test auth guards, and the cookie-clearing rules in `GlobalExceptionFilter` (which 401s clear cookies and, just as importantly, which must not).
- Test the size calculation including edge cases: flooring to zero, below `minDealSize`, and points-vs-dollars scaling.

## TypeScript

- `strict: true`. No `any` unless unavoidable and commented.
- Explicit return types on public service methods.
- Enums for fixed value sets.
- Readonly where values don't change.
