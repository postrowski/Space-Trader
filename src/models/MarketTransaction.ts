import { Transaction } from "./Transaction";

export class MarketTransaction extends Transaction {
  type!: string;
  units!: number;
  pricePerUnit!: number;
}

export enum MarketTransactionType {
	PURCHASE,
	SELL
}