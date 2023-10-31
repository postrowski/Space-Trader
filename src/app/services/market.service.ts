import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { liveQuery } from 'dexie';
import { Market, MarketTradeGood } from 'src/models/Market';
import { AccountService } from './account.service';
import { DBService } from './db.service';
import { GalaxyService } from './galaxy.service';
import { WaypointBase } from 'src/models/WaypointBase';
import { ExplorationService } from './exploration.service';
import { Observable, map, of, shareReplay } from 'rxjs';
import { MarketTransaction } from 'src/models/MarketTransaction';

@Injectable({
  providedIn: 'root'
})
export class MarketService {
	public apiUrlSystems = 'https://api.spacetraders.io/v2/systems';

	marketItemsByTradeSymbolByWaypointSymbol: Map<string, Map<string, UiMarketItem[]>> = new Map();
	marketSymbolsBySystemSymbol: Map<string, Set<string>> = new Map();

	constructor(private http: HttpClient,
				public galaxyService: GalaxyService,
				public dbService: DBService,
				public accountService: AccountService) {
	    this.dbService.initDatabase().then(() => {
			liveQuery(() => this.dbService.marketItems.toArray()).subscribe((response) => {
				this.addToMarketItems(response);
			});
	    });
	}
	
	recordMarket(market: Market): UiMarketItem[] {
		// record all the tradeGoods for this market:
		const marketItems: UiMarketItem[] = [];
		if (market.tradeGoods) {
			// This market has actual price data
			for (let tradeGood of market.tradeGoods) {
				let type = MarketItemType.EXCHANGE;
				if (market.exports.some((item) => item.symbol == tradeGood.symbol)) {
					type = MarketItemType.EXPORT;
				} else if (market.imports.some((item) => item.symbol == tradeGood.symbol)) {
					type = MarketItemType.IMPORT;
				}
				marketItems.push(new UiMarketItem(market.symbol, tradeGood.symbol, type, tradeGood));
			}
		} else {
			// This market doesn't have actual price data, but we can still record the IMPORTS/EXPORTS/EXCHANGEs:
			marketItems.push(
			    ...market.exports.map( (item) => new UiMarketItem(market.symbol, item.symbol, MarketItemType.EXPORT)),
			    ...market.imports.map( (item) => new UiMarketItem(market.symbol, item.symbol, MarketItemType.IMPORT)),
			    ...market.exchange.map((item) => new UiMarketItem(market.symbol, item.symbol, MarketItemType.EXCHANGE))
			);
		}
		this.addToMarketItems(marketItems);
		return marketItems;
	}
	
	private addToMarketItems(marketItems: UiMarketItem[]) {
		for (let marketItem of marketItems) {
			const marketSymbol = marketItem.marketSymbol;
			const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(marketSymbol);
			let marketsInSystem = this.marketSymbolsBySystemSymbol.get(systemSymbol);
			if (!marketsInSystem) {
				marketsInSystem = new Set<string>();
				this.marketSymbolsBySystemSymbol.set(systemSymbol, marketsInSystem);
			}
			marketsInSystem.add(marketItem.marketSymbol);

			let marketItemsByTradeSymbol = this.marketItemsByTradeSymbolByWaypointSymbol.get(marketSymbol);
			if (!marketItemsByTradeSymbol) {
				marketItemsByTradeSymbol = new Map();
				this.marketItemsByTradeSymbolByWaypointSymbol.set(marketSymbol, marketItemsByTradeSymbol);
			}

			let marketItems = marketItemsByTradeSymbol.get(marketItem.symbol);
			if (marketItems == null) {
				marketItems = [];
				marketItemsByTradeSymbol.set(marketItem.symbol, marketItems);
			}
			// remove any old record that didn't contain actual price data:
			while (marketItems.length > 0 && marketItems[0].purchasePrice == 0) {
				marketItems.shift();
			}
			marketItems.push(marketItem);
		}
	}


	getMarketplace(marketSymbol: string, shipsAtWaypoint: boolean): Observable<UiMarketItem[]> {
		const marketItemsByTradeSymbol = this.marketItemsByTradeSymbolByWaypointSymbol.get(marketSymbol);
		if (marketItemsByTradeSymbol) {
			let hasPriceData = true;
			// If the market is already cached, return it as an observable
			const marketItems: UiMarketItem[] = [];
			for (const tradeSymbol of marketItemsByTradeSymbol.keys()) {
				const items = marketItemsByTradeSymbol.get(tradeSymbol);
				// the last item should be the most recent item, which is all we want to return:
				if (items && items.length > 0) {
					const item = items[items.length-1];
					marketItems.push(item);
					if (item.purchasePrice == 0) {
						hasPriceData = false;
					}
				}
			}
			if (hasPriceData || !shipsAtWaypoint) {
				return of (marketItems);
			}
		}

		const headers = this.accountService.getHeader();
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(marketSymbol);

		const observable = this.http.get<{ data: Market }>
			(`${this.apiUrlSystems}/${systemSymbol}/waypoints/${marketSymbol}/market`, { headers })
			.pipe(map((response: { data: Market }) => this.recordMarket(response.data))) // converts to MarketItem[]
			.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((marketItems: UiMarketItem[]) => {
			this.dbService.addMarketItems(marketItems);
		}, (error) => { });
		return observable;
	}

	getItemAtMarket(marketSymbol: string, itemSymbol: string): UiMarketItem | null{
		const marketItemsByTradeSymbol: Map<string, UiMarketItem[]> | undefined
		                  = this.marketItemsByTradeSymbolByWaypointSymbol.get(marketSymbol);
		const items = marketItemsByTradeSymbol?.get(itemSymbol);
		if (items && items.length > 0) {
			return items[items.length-1];
		}
		return null;
	}	
	findCheapestMarketItemForSaleInSystem(systemSymbol: string, itemSymbol: string): UiMarketItem | null {
		let bestMarketItem: UiMarketItem | null = null;
		const marketSymbolsInSystem: Set<string> | undefined = this.marketSymbolsBySystemSymbol.get(systemSymbol);
		for (let marketSymbol of marketSymbolsInSystem || []) {
			const marketItem = this.getItemAtMarket(marketSymbol, itemSymbol);
			if (marketItem) {
				if (bestMarketItem == null || bestMarketItem.purchasePrice > marketItem.purchasePrice) {
					bestMarketItem =  marketItem;
				}
			}
		}
		return bestMarketItem;
	}

	updatePrices(transaction: MarketTransaction) {
		const currentItem = this.getItemAtMarket(transaction.waypointSymbol, transaction.tradeSymbol);
		if (currentItem) {
			const marketItem = new UiMarketItem(transaction.waypointSymbol, transaction.tradeSymbol, currentItem?.type);
			marketItem.supply        = currentItem.supply;
			marketItem.tradeVolume   = currentItem.tradeVolume;
			if (transaction.type == 'SELL') {
				marketItem.sellPrice     = transaction.pricePerUnit;
				marketItem.purchasePrice = currentItem.purchasePrice;
			} else  {
				marketItem.sellPrice     = currentItem.sellPrice;
				marketItem.purchasePrice = transaction.pricePerUnit;
			}
			this.addToMarketItems([marketItem]);
		}
	}

	getMarketSymbolsInSystem(systemSymbol: string) : Set<string> | undefined {
		return this.marketSymbolsBySystemSymbol.get(systemSymbol);
	}
	getPricesForItemInSystemByWaypointSymbol(systemSymbol: string, itemSymbol: string, forPurchase: boolean): Map<string, number> {
		const marketSymbolsInSystem = this.marketSymbolsBySystemSymbol.get(systemSymbol) || [];
		const itemCostByMarketSymbol = new Map<string, number> ();
		for (const marketSymbol of marketSymbolsInSystem || []) {
			const marketItem = this.getItemAtMarket(marketSymbol, itemSymbol);
			if (marketItem) {
				itemCostByMarketSymbol.set(marketSymbol,
				                           forPurchase ? marketItem.purchasePrice : marketItem.sellPrice);
			}
		}
		return itemCostByMarketSymbol;
	}
	getNearestMarketInSystemThatTradesItem(waypoint: WaypointBase, itemSymbol: string, forPurchase: boolean) : WaypointBase | null {
		const system = this.galaxyService.getSystemBySymbol(waypoint.symbol);
		if (system) {
			const salesPriceByWaypointSymbol = this.getPricesForItemInSystemByWaypointSymbol(system.symbol, itemSymbol, forPurchase);
			const waypointsThatBuyItem = system.waypoints?.filter((wp) => salesPriceByWaypointSymbol.has(wp.symbol)) || [];
			if (waypointsThatBuyItem.length > 0) {
				const waypoints = ExplorationService.sortWaypointsByDistanceFrom(waypointsThatBuyItem, waypoint);
				return waypoints[0];
			}
		}
		return null;
	}
	hasPriceData(marketSymbol: string): boolean {
		const marketItemsByTradeSymbol = this.marketItemsByTradeSymbolByWaypointSymbol.get(marketSymbol);
		return !!marketItemsByTradeSymbol && 
		      Array.from(marketItemsByTradeSymbol.values())
		           .some((marketItems) => (marketItems.length > 0) &&
		                                  (marketItems[marketItems.length - 1].purchasePrice !== 0));
	}
}

export enum MarketItemType {
	EXPORT,
	IMPORT,
	EXCHANGE
}
export class UiMarketItem extends MarketTradeGood {
	marketSymbol!: string;
	type!: MarketItemType;
	timestamp!: Date;
	constructor(marketSymbol: string, tradeSymbol: string, type: MarketItemType, tradeGood?: MarketTradeGood) {
		super();
		this.marketSymbol  = marketSymbol;
		this.symbol        = tradeSymbol;
		this.type          = type;
		this.timestamp     = new Date();
		this.purchasePrice = tradeGood?.purchasePrice || 0;
		this.sellPrice     = tradeGood?.sellPrice || 0;
		this.supply        = tradeGood?.supply || 'MODERATE';
		this.tradeVolume   = tradeGood?.tradeVolume || 0;
	}
}
export class UiMarket {
	symbol!: string;
	marketItems: UiMarketItem[] =[];
}

