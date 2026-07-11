---
description: Audit the signal-to-trade pipeline for safety
---

Audit the complete signal-to-trade execution path for safety. This is the most critical code in the project because it places real trades.

Trace and verify:

1. **Webhook entry** (`webhook/`) — IP whitelist guard runs first, then secret guard, then DTO validation. Endpoint returns 200 within 3 seconds and processes async.

2. **Condition pipeline** (`signal/`) — verify the checks run in this exact order and each failure logs the correct status and stops:
   - duplicate-delivery guard (same ticker+direction+price within 20s) → DUPLICATE_SIGNAL — technical safeguard, runs before step 1, not one of the 11 business steps
   - bot_enabled → BOT_PAUSED
   - direction allowed → BUY_DISABLED / SELL_DISABLED
   - ticker mapped → NOT_MAPPED
   - stock enabled → DISABLED
   - daily trade count → DAILY_TRADE_LIMIT
   - daily total investment → DAILY_TOTAL_LIMIT
   - stock daily spend → STOCK_DAILY_LIMIT
   - SELL position check → NO_POSITION

3. **Quantity calculation** (`trade/`) — `investment_amount / signal_price`, rounded to 4dp, guarded against divide-by-zero and against quantities below IG minimum. `investment_amount` must be the *resolved* value (`resolveInvestmentAmount()` — per-stock override or the global `trading_rules.investment_amount` default), never the raw nullable `stock_mapping.investment_amount` column.

4. **IG execution** (`ig-client/`) — place order, then confirm deal, both wrapped in try/catch. On error, log FAILED with IG error code only.

5. **Failure handling** — FAILED increments consecutive_failure_count; reaching the threshold sets bot_enabled=false and logs AUTO_PAUSED.

Report any gap, missing check, reordering, or place where an uncertain state could result in an unintended trade. Fail-safe behaviour (skip + log) must hold everywhere.
