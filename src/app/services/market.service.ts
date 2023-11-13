import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { liveQuery } from 'dexie';
import { Market, MarketItemType, MarketTradeGood } from 'src/models/Market';
import { AccountService } from './account.service';
import { DBService } from './db.service';
import { GalaxyService } from './galaxy.service';
import { WaypointBase } from 'src/models/WaypointBase';
import { ExplorationService } from './exploration.service';
import { Observable, map, of, shareReplay } from 'rxjs';
import { MarketTransaction } from 'src/models/MarketTransaction';
import { LocXY } from 'src/models/LocXY';
import { Agent } from 'src/models/Agent';
import { ShipFuel } from 'src/models/ShipFuel';
import { FleetService } from './fleet.service';
import { ShipCargo } from 'src/models/ShipCargo';

@Injectable({
  providedIn: 'root'
})
export class MarketService {
	public apiUrlSystems = 'https://api.spacetraders.io/v2/systems';
	private apiUrlMyShips = 'https://api.spacetraders.io/v2/my/ships';

	marketItemsByTradeSymbolByWaypointSymbol: Map<string, Map<string, UiMarketItem[]>> = new Map();
	marketSymbolsBySystemSymbol: Map<string, Set<string>> = new Map();

	constructor(private http: HttpClient,
				public galaxyService: GalaxyService,
				public fleetService: FleetService,
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
	
	private addToMarketItems(marketItemsArray: UiMarketItem[]) {
		for (let marketItem of marketItemsArray) {
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
			if (marketItems.length > 1) {
				const previousMarketItem = marketItems[marketItems.length-1];
				if (previousMarketItem.marketSymbol == marketItem.marketSymbol &&
				    previousMarketItem.purchasePrice == marketItem.purchasePrice &&
				    previousMarketItem.sellPrice == marketItem.sellPrice&&
				    previousMarketItem.supply == marketItem.supply&&
				    previousMarketItem.symbol == marketItem.symbol&&
				    previousMarketItem.type == marketItem.type) {
					// This new item is identical (except possibly the timestamp) as the previous record.
					// rather than increasing the record count, just update the timestamp
					console.log(`Duplicate MarketItem found ${marketItem.marketSymbol} ${marketItem.symbol}, updating timestamp only`);
					previousMarketItem.timestamp = marketItem.timestamp;
					continue;
				}
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
		return this.getMarketplaceForced(marketSymbol);
	}
	
	getMarketplaceForced(marketSymbol: string): Observable<UiMarketItem[]> {
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


	refuelShip(shipSymbol: string, units: number): Observable<{ data: {agent: Agent; fuel: ShipFuel; transaction: MarketTransaction }}> {
		const headers = this.accountService.getHeader();
		const body = {
			units: units
		}
		const observable = this.http.post<{ data: {agent: Agent; fuel: ShipFuel; transaction: MarketTransaction }}>
			(`${this.apiUrlMyShips}/${shipSymbol}/refuel`,
				body, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			const ship = this.fleetService.getShipBySymbol(shipSymbol);
			if (ship) {
				ship.fuel.update(response.data.fuel);
			}
			this.updatePrices(response.data.transaction);
			this.accountService.updateAgent(response.data.agent);
		}, (error) => {});
		return observable;
	}

	sellCargo(shipSymbol: string, itemSymbol: string, itemQty: number): Observable<{ data: {agent: Agent; cargo: ShipCargo; transaction: MarketTransaction }}> {
		const headers = this.accountService.getHeader();
		const body = {
  			symbol: itemSymbol,
  			units: itemQty
		}
		const observable = this.http.post<{ data: {agent: Agent; cargo: ShipCargo; transaction: MarketTransaction }}>
			(`${this.apiUrlMyShips}/${shipSymbol}/sell`,
				body, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			this.fleetService.updateShipCargo(shipSymbol, response.data.cargo);
			this.accountService.updateAgent(response.data.agent);
			this.updatePrices(response.data.transaction);
		}, (error) => {});
    	return observable;
	}
	
	purchaseCargo(shipSymbol: string, itemSymbol: string, itemQty: number): Observable<{ data: {agent: Agent; cargo: ShipCargo; transaction: MarketTransaction }}> {
		const headers = this.accountService.getHeader();
		const body = {
  			symbol: itemSymbol,
  			units: itemQty
		}
		const observable = this.http.post<{ data: {agent: Agent; cargo: ShipCargo; transaction: MarketTransaction }}>
			(`${this.apiUrlMyShips}/${shipSymbol}/purchase`,
				body, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			this.fleetService.updateShipCargo(shipSymbol, response.data.cargo);
			this.accountService.updateAgent(response.data.agent);
			this.updatePrices(response.data.transaction);
		}, (error) => {});
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
	getItemHistoryAtMarket(marketSymbol: string, itemSymbol: string): UiMarketItem[]{
		const marketItemsByTradeSymbol: Map<string, UiMarketItem[]> | undefined
		                  = this.marketItemsByTradeSymbolByWaypointSymbol.get(marketSymbol);
		return marketItemsByTradeSymbol?.get(itemSymbol) || [];
	}
	getItemHistoricalLowPriceAtMarket(marketSymbol: string, itemSymbol: string): number{
		let bestPrice = Infinity;
		const marketItemsByTradeSymbol: Map<string, UiMarketItem[]> | undefined
	                  = this.marketItemsByTradeSymbolByWaypointSymbol.get(marketSymbol);
		const allItems = marketItemsByTradeSymbol?.get(itemSymbol) || [];
		for (let item of allItems) {
			const price = item.purchasePrice;
			if (price < bestPrice) {
				bestPrice = price;
			}
		}
		return bestPrice;
	}
	getItemHistoricalAveragePriceAtMarket(marketSymbol: string, itemSymbol: string, purchase: boolean): number{
		let total = 0;
		let count = 0;
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(marketSymbol);
		for (let marketSymbol of this.marketSymbolsBySystemSymbol.get(systemSymbol) || []) {
			const marketItemsByTradeSymbol: Map<string, UiMarketItem[]> | undefined
		                  = this.marketItemsByTradeSymbolByWaypointSymbol.get(marketSymbol);
			const allItems = marketItemsByTradeSymbol?.get(itemSymbol) || [];
			for (let item of allItems) {
				total += purchase ? item.purchasePrice : item.sellPrice;
				count++
			}
		}
		return total/count;
	}
	getAverageFuelCost(systemSymbol: string) {
		systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemSymbol);
		const fuelPricesByWaypointSymbol = this.getPricesForItemInSystemByWaypointSymbol(systemSymbol, 'FUEL');
		let cost = 0;
		for (let fuelItem of fuelPricesByWaypointSymbol.values() || []) {
			cost += fuelItem.purchasePrice;
		}
		if (cost == 0) {
			return 250;
		}
		return Math.ceil(cost / fuelPricesByWaypointSymbol.size);
	}
	findCheapestMarketItemForSaleInSystem(fromWaypoint: WaypointBase, itemSymbol: string, unitsToBuy: number): UiMarketItem | null {
		let bestMarketItem: UiMarketItem | null = null;
		let bestCost = Infinity;
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(fromWaypoint.symbol);
		const fuelPricesByWaypointSymbol = this.getPricesForItemInSystemByWaypointSymbol(systemSymbol, 'FUEL');
		const localFuelCostItem = fuelPricesByWaypointSymbol.get(fromWaypoint.symbol);
		const localFuelCost = localFuelCostItem?.purchasePrice || Infinity;
		const marketSymbolsInSystem: Set<string> | undefined = this.marketSymbolsBySystemSymbol.get(systemSymbol);
		for (let marketSymbol of marketSymbolsInSystem || []) {
			const marketItem = this.getItemAtMarket(marketSymbol, itemSymbol);
			const market = this.galaxyService.getWaypointByWaypointSymbol(marketSymbol);
			const marketFuelCostItem = fuelPricesByWaypointSymbol.get(marketSymbol);
			const marketFuelCost = marketFuelCostItem?.purchasePrice || Infinity;
			const fuelCost = Math.min(marketFuelCost, localFuelCost, this.getAverageFuelCost(systemSymbol));
			if (marketItem && market) {
				const dist = LocXY.getDistance(fromWaypoint, market);
				const cost = marketItem.purchasePrice * unitsToBuy + dist * fuelCost;
				if (bestMarketItem == null || cost < bestCost) {
					bestMarketItem = marketItem;
					bestCost = cost;
				}
			}
		}
		return bestMarketItem;
	}
	findHighestPricedMarketItemForSaleInSystem(fromWaypoint: WaypointBase, itemSymbol: string, unitsToSell: number): UiMarketItem | null {
		let bestMarketItem: UiMarketItem | null = null;
		let bestProfit = 0;
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(fromWaypoint.symbol);
		const fuelPricesByWaypointSymbol = this.getPricesForItemInSystemByWaypointSymbol(systemSymbol, 'FUEL');
		const localFuelCostItem = fuelPricesByWaypointSymbol.get(fromWaypoint.symbol);
		const localFuelCost = localFuelCostItem?.purchasePrice || Infinity;
		const marketSymbolsInSystem: Set<string> | undefined = this.marketSymbolsBySystemSymbol.get(systemSymbol);
		for (let marketSymbol of marketSymbolsInSystem || []) {
			const marketItem = this.getItemAtMarket(marketSymbol, itemSymbol);
			const market = this.galaxyService.getWaypointByWaypointSymbol(marketSymbol);
			const marketFuelCostItem = fuelPricesByWaypointSymbol.get(marketSymbol);
			const marketFuelCost = marketFuelCostItem?.purchasePrice || Infinity;
			const fuelCost = Math.min(marketFuelCost, localFuelCost, this.getAverageFuelCost(systemSymbol));
			if (marketItem && market) {
				const dist = LocXY.getDistance(fromWaypoint, market);
				const profit = marketItem.sellPrice * unitsToSell - dist * fuelCost;
				if (bestMarketItem == null || profit > bestProfit) {
					bestMarketItem = marketItem;
					bestProfit = profit;
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
			marketItem.activity      = currentItem.activity;
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

	loadedFromSystem = false;
	getMarketSymbolsInSystem(systemSymbol: string) : Set<string> | undefined {
		if (!this.loadedFromSystem) {
			const system = this.galaxyService.getSystemBySymbol(systemSymbol);
			if (system && system.waypoints) {
				this.loadedFromSystem = true;
				let marketSymbols = this.marketSymbolsBySystemSymbol.get(systemSymbol);
				if (!marketSymbols) {
					marketSymbols = new Set<string>();
					this.marketSymbolsBySystemSymbol.set(systemSymbol, marketSymbols);
				}
				for (const way of system.waypoints) {
					if (WaypointBase.hasMarketplace(way)) {
						marketSymbols.add(way.symbol);
					}
				}
			}
		}
		return this.marketSymbolsBySystemSymbol.get(systemSymbol);
	}
	getPricesForItemInSystemByWaypointSymbol(systemSymbol: string, itemSymbol: string): Map<string, UiMarketItem> {
		systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemSymbol);
		const marketSymbolsInSystem = this.marketSymbolsBySystemSymbol.get(systemSymbol) || [];
		const itemCostByMarketSymbol = new Map<string, UiMarketItem> ();
		for (const marketSymbol of marketSymbolsInSystem || []) {
			const marketItem = this.getItemAtMarket(marketSymbol, itemSymbol);
			if (marketItem) {
				itemCostByMarketSymbol.set(marketSymbol, marketItem);
			}
		}
		return itemCostByMarketSymbol;
	}
	getNearestMarketInSystemThatTradesItem(waypoint: WaypointBase, itemSymbol: string) : WaypointBase | null {
		const system = this.galaxyService.getSystemBySymbol(waypoint.symbol);
		if (system) {
			const salesPriceByWaypointSymbol = this.getPricesForItemInSystemByWaypointSymbol(system.symbol, itemSymbol);
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
		// return false if dont have marketItemsByTradeSymbol, OR there are some entries whoes most recent price is 0
		return !!marketItemsByTradeSymbol && 
		      !Array.from(marketItemsByTradeSymbol.values())
		            .some((marketItems) => (marketItems.length > 0) &&
		                                   (marketItems[marketItems.length - 1].purchasePrice === 0));
	}
	
	lastUpdateDate(marketSymbol: string): Date | null {
		const marketItemsByTradeSymbol = this.marketItemsByTradeSymbolByWaypointSymbol.get(marketSymbol);
		if (!marketItemsByTradeSymbol) {
			return null;
		}
		let leastRecentTimestamp: Date | null = null;
		for (const uiMarketItems of marketItemsByTradeSymbol.values()) {
			if (uiMarketItems && uiMarketItems.length > 0) {
				const mostRecentItem = uiMarketItems[uiMarketItems.length - 1];
				if (!leastRecentTimestamp || mostRecentItem.timestamp < leastRecentTimestamp) {
					leastRecentTimestamp = mostRecentItem.timestamp;
				}
			}
		}
		return leastRecentTimestamp;		
	}
	
	getAllItemsForTradeInSystem(systemSymbol: string): Set<string> {
		const items = new Set<string>();
		for (const marketSymbol of this.getMarketSymbolsInSystem(systemSymbol) || []) {
			const marketItemsByTradeSymbol = this.marketItemsByTradeSymbolByWaypointSymbol.get(marketSymbol);
			for (const tradeSymbol of marketItemsByTradeSymbol?.keys() || []) {
				items.add(tradeSymbol);
			}
		}
		return items;
	}
	getBestTradeRoutesFrom(waypoint: WaypointBase, cargoCapacity: number, creditsAvailable: number,
	                       excludedTradeItems: Set<string>, travelSpeed: string ): TradeRoute | null {
		const marketItemsByTradeSymbol = this.marketItemsByTradeSymbolByWaypointSymbol.get(waypoint.symbol);
		let bestProfit = 0;
		let bestPurchaseItem = null;
		let bestSellItem = null;
		for (const tradeSymbol of marketItemsByTradeSymbol?.keys() || []) {
			if (excludedTradeItems.has(tradeSymbol)) {
				continue;
			}
			const itemPricesByMarket: Map<string, UiMarketItem> = this.getPricesForItemInSystemByWaypointSymbol(waypoint.symbol, tradeSymbol);
			const purchaseItem = itemPricesByMarket.get(waypoint.symbol);
			if (purchaseItem) {
				const units = Math.min(cargoCapacity, Math.floor(creditsAvailable / purchaseItem.purchasePrice));
				if (units > 0) {
					const bestRoute = this.findBestMarketToSell(waypoint, tradeSymbol, units, travelSpeed);
					if (bestRoute) {
						const profit = bestRoute.proceeds - purchaseItem.purchasePrice * units;
						if (profit > bestProfit) {
							bestProfit = profit;
							bestSellItem = bestRoute.sellItem;
							bestPurchaseItem = purchaseItem;
						}
					}
				}
			}
		}
		if (bestSellItem == null || bestPurchaseItem == null) {
			return null;
		}
		//console.log(`getBestTradeRoutesFrom(${waypoint.symbol}, ${cargoCapacity}, ${creditsAvailable}) => {buy: ${bestPurchaseItem}, sell: ${bestSellItem}, profit: ${bestProfit}}`)
		return {
			waypointSymbol: null,
			buyItem: bestPurchaseItem,
			sellItem: bestSellItem,
			profit: bestProfit,
			travelSpeed: travelSpeed
		};
	}
	findBestMarketToSell(waypoint: WaypointBase, itemSymbol: string, unitsToSell: number,
	                     travelSpeed: string): {market: WaypointBase, sellItem: UiMarketItem, proceeds: number, travelSpeed: string} | null {
		const fuelPrices: Map<string, UiMarketItem> = this.getPricesForItemInSystemByWaypointSymbol(waypoint.symbol, 'FUEL');
		const itemPrices: Map<string, UiMarketItem> = this.getPricesForItemInSystemByWaypointSymbol(waypoint.symbol, itemSymbol);
		const fuelCostLocal = fuelPrices.get(waypoint.symbol)?.purchasePrice || Infinity;
		let bestProceeds = 0;
		let bestMarket = null;
		let bestItem = null;
		for (const marketSymbol of itemPrices.keys()) {
			const marketItem: UiMarketItem | undefined = itemPrices.get(marketSymbol);
			const market = this.galaxyService.getWaypointByWaypointSymbol(marketSymbol);
			if (market && marketItem) {
				const fuelCostAtMarket = fuelPrices.get(market.symbol)?.purchasePrice || Infinity;
				let bestFuelCost = Math.min(fuelCostAtMarket, fuelCostLocal, this.getAverageFuelCost(marketSymbol));
				if (travelSpeed == 'DRIFT') {
					bestFuelCost = 1;
				}
				let distToMarket = Math.max(LocXY.getDistance(market, waypoint), 1);
				const fuelCostToGetThereAndBack = bestFuelCost * distToMarket * 2; // round trip
				const priceAtMarket = marketItem.sellPrice || 0;
				const profit = unitsToSell * priceAtMarket - fuelCostToGetThereAndBack;
				if (profit > bestProceeds) {
					bestProceeds = profit;
					bestMarket = market;
					bestItem = marketItem;
				}
			}
		}
		if (bestMarket == null || bestItem == null) {
			return null;
		}
		return {
			market: bestMarket,
			sellItem: bestItem,
			proceeds: bestProceeds,
			travelSpeed: travelSpeed
		};
	}
}

export class UiMarketItem extends MarketTradeGood {
	marketSymbol!: string;
	timestamp!: Date;
	constructor(marketSymbol: string, tradeSymbol: string, type: MarketItemType,
	            tradeGood?: MarketTradeGood) {
		super();
		this.marketSymbol  = marketSymbol;
		this.symbol        = tradeSymbol;
		this.type          = type;
		this.activity      = tradeGood?.activity || 'STATIC';
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

export class TradeRoute {
	waypointSymbol: string | null = null;
	buyItem: UiMarketItem | null = null;
	sellItem!: UiMarketItem;
	profit!: number;
	travelSpeed = 'CRUISE';
}
