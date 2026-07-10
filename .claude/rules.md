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

- Every portal endpoint has a guard: `@UseGuards(JwtAuthGuard)`. There are no roles — every authenticated user has full access.
- The webhook endpoint uses `TradingViewIpGuard` and `WebhookSecretGuard`, not JWT.
- Validate every request body with a DTO and class-validator decorators. Enable `whitelist: true` and `forbidNonWhitelisted: true` on the global ValidationPipe.
- Never return password_hash or otp_code_hash in any response. Use class-transformer `@Exclude()`.
- Rate limit: login (5/15min), webhook (60/min), other (100/min).
- Hash passwords with bcrypt cost 12. Never store or log plaintext.
- 2FA is optional email-OTP, not TOTP — only a short-lived hash of the current code is stored (`otp_code_hash` + `otp_expires_at`), never a long-lived secret. Nothing OTP-related needs encryption at rest.
- Every mutating request needs a matching `X-CSRF-Token` header (double-submit against the `csrf_token` cookie) — enforced by `CsrfGuard`.

## Trade safety rules

- The signal pipeline checks conditions in the exact documented order. Do not reorder.
- Each condition that fails writes a trade_log row with the specific status and stops.
- SELL always checks `getOpenPositions()` first. No position → skip with NO_POSITION.
- Quantity = `investment_amount / signal_price`, `.toFixed(4)`. Guard against divide-by-zero.
- After a FAILED trade, increment `consecutive_failure_count`. If it reaches `max_consecutive_failures`, set `bot_enabled = false` and log AUTO_PAUSED.
- Every IG call is wrapped in try/catch. On error, log FAILED with the IG error code (not the full error object).

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

- Mock IG client and Secrets Manager in all tests.
- Cover every trade status path.
- Test auth guards.
- Test the quantity calculation including edge cases.

## TypeScript

- `strict: true`. No `any` unless unavoidable and commented.
- Explicit return types on public service methods.
- Enums for fixed value sets.
- Readonly where values don't change.
