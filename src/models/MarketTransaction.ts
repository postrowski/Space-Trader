export class MarketTransaction {
  waypointSymbol!: string;
  shipSymbol!: string;
  tradeSymbol!: string;
  type!: string;
  units!: number;
  pricePerUnit!: number;
  totalPrice!: number;
  timestamp!: string;
}

export enum MarketTransactionType {
	PURCHASE,
	SELL
}