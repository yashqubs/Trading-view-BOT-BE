import { Direction } from '../common/enums';

export interface IgMarket {
  epic: string;
  instrumentName: string;
  instrumentType: string;
  marketStatus: string;
  bid: number | null;
  offer: number | null;
}

export interface IgPosition {
  dealId: string;
  epic: string;
  direction: Direction;
  size: number;
}

export interface PlaceOrderParams {
  epic: string;
  direction: Direction;
  size: number;
}

export interface PlaceOrderResult {
  dealReference: string;
}

export interface ConfirmDealResult {
  dealId: string;
  dealStatus: 'ACCEPTED' | 'REJECTED';
  status: 'OPEN' | 'CLOSED' | 'DELETED' | 'AMENDED' | 'PARTIALLY_CLOSED' | null;
  reason: string | null;
}

export interface ClosePositionParams {
  dealId: string;
  direction: Direction;
  size: number;
}
