---
description: Audit the signal-to-trade pipeline for safety
---

Audit the complete signal-to-trade execution path for safety. This is the most critical code in the project because it places real trades with real money.

Trace and verify:

1. **Webhook entry** (`webhook/`) — IP whitelist guard runs first, then secret guard, then DTO validation. Endpoint returns 200 within 3 seconds and processes async. `TradingViewIpGuard` must fail closed when `TRADINGVIEW_IPS` is unset.

2. **Condition pipeline** (`signal/`) — verify the checks run in this exact order and each failure logs the correct status and stops:
   - duplicate-delivery guard (same ticker+direction+price within 20s) → `DUPLICATE_SIGNAL` — technical safeguard, runs before step 1, not one of the 11 business steps
   - 1. `bot_enabled` → `BOT_PAUSED`
   - 2. direction allowed → `BUY_DISABLED` / `SELL_DISABLED`
   - 3. ticker mapped (case-insensitive — `MappingService.findByTicker` uses a parameterized `LOWER()` comparison) → `NOT_MAPPED`
   - 4. stock enabled → `DISABLED`
   - 5. **resolve the ticker's existing position, either direction** — this must stay ahead of the throttles, because whether they apply depends on open-vs-close
   - 6-8. daily trade count / daily total investment / per-stock daily spend → `DAILY_TRADE_LIMIT` / `DAILY_TOTAL_LIMIT` / `STOCK_DAILY_LIMIT` — **opening only**
   - 9-11. size, execute, log SUCCESS/FAILED, increment failure counter and auto-pause on threshold

3. **The three-way branch at step 5** — one position per ticker, at most, never hedged. Verify each branch:
   - **No position** → OPENS one (BUY → long, SELL → short). Both are new exposure, so both run the throttles.
   - **Position in the same direction** → skipped with `ALREADY_LONG` / `ALREADY_SHORT`. A repeated signal must never silently double exposure.
   - **Position in the opposite direction** → **REVERSES**: close first (never throttled), then reopen in the signal's direction *only if the close returned SUCCESS*, with the reopen subject to the throttles. Confirm a failed close never leads to a reopen (never open on top of an uncertain state), and that a throttled reopen leaves the ticker flat rather than blocking the close that already happened. This path writes two `trade_log` rows.

   Confirm `TradeService.executeTrade` decides open-vs-close from whether `existingPosition` is null, **never** from `input.direction`.

4. **Live-quote gates, before any order goes out** (`trade/`) — every trade, MARKET included:
   - no quote → `NO_LIVE_QUOTE`
   - `snapshot.marketStatus !== 'TRADEABLE'` → `MARKET_CLOSED`
   - signal price more than 20% from the live market → rejected (`assertSignalPricePlausible`)
   - the reference side (offer vs bid) follows the **order** direction actually being sent, not the raw signal direction

5. **Size calculation** (`trade/`) — `size = floor((investment_amount / price_in_points) × 100) / 100`, a **£-per-point stake, not a share count**. Verify:
   - `price_in_points` is on IG's quote scale (`derivePriceScaleFactor`), never a raw dollar price — this is the overexposure bug the current model replaced
   - guarded against divide-by-zero and against flooring to zero, and against falling below IG's live `dealingRules.minDealSize`
   - all of those throw *inside* the same try/catch as IG errors, so they still log FAILED rather than escaping unhandled
   - `investment_amount` is the *resolved* value (`resolveInvestmentAmount()` — per-stock override, else the global `trading_rules.investment_amount`), never the raw nullable `stock_mapping.investment_amount` column
   - on a close, size is the existing position's own size — not a recalculation

6. **IG execution** (`ig-client/`) — place order, then confirm deal, both wrapped in try/catch. On error, log FAILED with the IG error code only, never the full error object. Verify spread-betting specifics are intact: `expiry: 'DFB'`, `currencyCode: 'GBP'` on `/positions/otc`, and close-position going out as POST + `_method: DELETE`.

7. **Confirm-deal reconciliation** — the highest-value check in this audit. `confirmDeal` is unreliable: a non-ACCEPTED or thrown result must be treated as *ambiguous*, not as failure. Verify `reconcileAgainstOpenPositions()` runs before FAILED is logged (position gone = closed; matching new position = opened), and that it retries rather than checking once.

8. **Failure handling** — FAILED increments `consecutive_failure_count`; reaching the threshold sets `bot_enabled = false` and logs `AUTO_PAUSED`. Verify manual paths (`closeAllOpenPositions`) are exempt in both directions — a user closing out after hours must not silently pause the bot.

9. **Accounting** — `trade_value` is populated for opens *and* closes. Verify every "money invested" aggregate and daily cap filters on `is_closing_trade = false` rather than relying on a null `trade_value`.

Report any gap, missing check, reordering, or place where an uncertain state could result in an unintended trade, an unintended *size*, or exposure left open. Fail-safe behaviour — skip or close and log, never guess — must hold everywhere.
