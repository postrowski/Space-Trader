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
	type!: MarketItemType;
	tradeVolume!: number;
	supply!: string;
	activity!: string;
	purchasePrice!: number;
	sellPrice!: number;
}

export enum MarketItemType {
	EXPORT,
	IMPORT,
	EXCHANGE
}

export enum Supply {
	SCARCE,
	LIMITED,
	MODERATE,
	ABUNDANT
}
