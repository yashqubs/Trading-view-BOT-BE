import { Direction } from '../../common/enums';

export interface SignalInput {
  tvTicker: string;
  direction: Direction;
  signalPrice: number;
  signalReceivedAt: Date;
}
