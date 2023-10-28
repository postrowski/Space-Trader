import { MarketTransaction } from "./MarketTransaction"

export class Market {
	symbol!: string;
	exports: MarketItem[] = [];
	imports: MarketItem[] = [];
	exchange: MarketItem[] = [];
	transactions: MarketTransaction[] = [];
	tradeGoods: MarketTradeGood[] = [];
}

export class MarketItem {
	symbol!: string; // from ItemSymbol
	name!: string;
	description!: string;
}

export class MarketTradeGood {
	symbol!: string;
	tradeVolume!: number;
	supply!: string;
	purchasePrice!: number;
	sellPrice!: number;
}
export enum Supply {
	SCARCE,
	LIMITED,
	MODERATE,
	ABUNDANT
}