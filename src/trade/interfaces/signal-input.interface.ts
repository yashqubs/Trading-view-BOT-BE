import { Direction, ExecutionMode } from '../../common/enums';

export interface SignalInput {
  tvTicker: string;
  direction: Direction;
  signalPrice: number;
  signalReceivedAt: Date;
  // Dev test-signal endpoint only — real webhook signals never set any of
  // these three. Each takes priority over the stock's own setting and the
  // global default, for sizing/testing a one-off trade without touching
  // the stock's real configuration. See TradeService.executeTrade.
  investmentAmountOverride?: number;
  executionModeOverride?: ExecutionMode;
  maxSlippagePercentOverride?: number;
}
