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
import { Ship } from 'src/models/Ship';

@Injectable({
  providedIn: 'root'
})
export class MarketService {
	public apiUrlSystems = 'https://api.spacetraders.io/v2/systems';
	private apiUrlMyShips = 'https://api.spacetraders.io/v2/my/ships';

	marketItemsByTradeSymbolByWaypointSymbol = new Map<string, Map<string, UiMarketItem[]>>();
	marketTransactionsByTradeSymbolByWaypointSymbol = new Map<string, Map<string, MarketTransaction[]>>();
	latestMarketItemByTradeSymbolByWaypointSymbol = new Map<string, Map<string, UiMarketItem>>();
	marketSymbolsBySystemSymbol = new Map<string, Set<string>>();
	latestMarketItemByMarketSymbolByItemSymbolBySystemSymbol = new Map<string, Map<string, Map<string, UiMarketItem>>>();
	loadedFromSystem = false;

	constructor(private http: HttpClient,
				public galaxyService: GalaxyService,
				public fleetService: FleetService,
				public dbService: DBService,
				public accountService: AccountService) {
	    this.dbService.initDatabase().then(() => {
//			this.dbService.removeRedundantMarketItems();
			liveQuery(() => this.dbService.marketItems.orderBy('timestamp').toArray()).subscribe((response) => {
				this.addToMarketItems(response);
			});
			liveQuery(() => this.dbService.marketTransactions.orderBy('timestamp').toArray()).subscribe((response) => {
				this.addToMarketTransactions(response);
			});
	    });
	}
	
	onServerReset() {
		this.marketItemsByTradeSymbolByWaypointSymbol = new Map<string, Map<string, UiMarketItem[]>>();
		this.marketTransactionsByTradeSymbolByWaypointSymbol = new Map<string, Map<string, MarketTransaction[]>>();
		this.latestMarketItemByTradeSymbolByWaypointSymbol = new Map<string, Map<string, UiMarketItem>>();
		this.marketSymbolsBySystemSymbol = new Map<string, Set<string>>();
		this.latestMarketItemByMarketSymbolByItemSymbolBySystemSymbol = new Map<string, Map<string, Map<string, UiMarketItem>>>();
		this.loadedFromSystem = false;
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
		this.addToMarketTransactions(market.transactions);
		return marketItems;
	}
	
	private addToMarketTransactions(marketTransactionsArray: MarketTransaction[]) {
		for (const marketTransaction of marketTransactionsArray) {
			let marketTransactionsByTradeSymbol = this.marketTransactionsByTradeSymbolByWaypointSymbol.get(marketTransaction.waypointSymbol);
			if (!marketTransactionsByTradeSymbol) {
				marketTransactionsByTradeSymbol = new Map();
				this.marketTransactionsByTradeSymbolByWaypointSymbol.set(marketTransaction.waypointSymbol, marketTransactionsByTradeSymbol);
			}
			let marketTransactions = marketTransactionsByTradeSymbol.get(marketTransaction.tradeSymbol);
			if (!marketTransactions) {
				marketTransactions = [];
				marketTransactionsByTradeSymbol.set(marketTransaction.tradeSymbol, marketTransactions);
			}
			marketTransactions.push(marketTransaction);
		}
	}
	
	private addToMarketItems(marketItemsArray: UiMarketItem[]) {
		for (const marketItem of marketItemsArray) {
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
			let latestMarketItemByTradeSymbol = this.latestMarketItemByTradeSymbolByWaypointSymbol.get(marketSymbol);
			if (!latestMarketItemByTradeSymbol) {
				latestMarketItemByTradeSymbol = new Map();
				this.latestMarketItemByTradeSymbolByWaypointSymbol.set(marketSymbol, latestMarketItemByTradeSymbol);
			}

			let latestMarketItemByMarketSymbolByItemSymbol = this.latestMarketItemByMarketSymbolByItemSymbolBySystemSymbol.get(systemSymbol);
			if (!latestMarketItemByMarketSymbolByItemSymbol) {
				latestMarketItemByMarketSymbolByItemSymbol = new Map<string, Map<string, UiMarketItem>>();
		 		this.latestMarketItemByMarketSymbolByItemSymbolBySystemSymbol.set(systemSymbol, latestMarketItemByMarketSymbolByItemSymbol);
			}
			let latestMarketItemByMarketSymbol = latestMarketItemByMarketSymbolByItemSymbol.get(marketItem.symbol);
			if (!latestMarketItemByMarketSymbol) {
				latestMarketItemByMarketSymbol = new Map<string, UiMarketItem>();
		 		latestMarketItemByMarketSymbolByItemSymbol.set(marketItem.symbol, latestMarketItemByMarketSymbol);
			}
			// Only record this data if it has actual price data (unless we don't have any data at all for this item/market)
			const previousMarketItem = latestMarketItemByMarketSymbol.get(marketItem.marketSymbol);
			if (!previousMarketItem || 
			     (marketItem.purchasePrice > 0 &&
			      previousMarketItem.timestamp.getTime() < marketItem.timestamp.getTime())) {
				latestMarketItemByMarketSymbol.set(marketItem.marketSymbol, marketItem);
			}
			latestMarketItemByTradeSymbol.set(marketItem.symbol, marketItem);
			
			let marketItems = marketItemsByTradeSymbol.get(marketItem.symbol);
			if (marketItems == null) {
				marketItems = [];
				marketItemsByTradeSymbol.set(marketItem.symbol, marketItems);
			}
			// remove any old record that didn't contain actual price data:
			while (marketItems.length > 0 && marketItems[0].purchasePrice == 0) {
				marketItems.shift();
			}
			// When the new value comes in, and it matches the most recent item,
			// but that item is NOT the only item in the list, update its timestamp.
			// If it is the only item in the list (marketItems.length==1), leave it alone as its the first item in history
			if (marketItems.length > 2 && previousMarketItem) {
				// If the new marketItem matches both of the two items before it,
				// we don't want to increase our number of market items, instead,
				// replace the previously latest one with the new latest one. This
				// should only be updating the timestamp, since everything is the same. 
				if (UiMarketItem.compare(marketItem, previousMarketItem) &&
					UiMarketItem.compare(marketItem, marketItems[marketItems.length - 2]) &&
					previousMarketItem.timestamp.getTime() < marketItem.timestamp.getTime()) {
					//const diff = marketItem.timestamp.getTime() - previousMarketItem.timestamp.getTime();
					//console.log(`Duplicate MarketItem found ${marketItem.marketSymbol} ${marketItem.symbol}, updating timestamp only (delta ${diff/1000} secs)`);
					previousMarketItem.timestamp = marketItem.timestamp;
					continue;
				}
			}
			marketItems.push(marketItem);
		}
	}

	getMarketplace(marketSymbol: string, shipsAtWaypoint: boolean): Observable<UiMarketItem[]> {
		const latestMarketItemByTradeSymbol = this.latestMarketItemByTradeSymbolByWaypointSymbol.get(marketSymbol);
		if (latestMarketItemByTradeSymbol) {
			let hasPriceData = true;
			// If the market is already cached, return it as an observable
			const marketItems: UiMarketItem[] = [];
			for (const tradeSymbol of latestMarketItemByTradeSymbol.keys()) {
				const item = latestMarketItemByTradeSymbol.get(tradeSymbol);
				if (item) {
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


	refuelShip(shipSymbol: string, units: number, fromCargo: boolean): Observable<{ data: {agent: Agent; fuel: ShipFuel; transaction: MarketTransaction }}> {
		const headers = this.accountService.getHeader();
		const body = {
			units: units,
			fromCargo: fromCargo
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
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(marketSymbol);
		const latestMarketItemByMarketSymbolByItemSymbol = this.latestMarketItemByMarketSymbolByItemSymbolBySystemSymbol.get(systemSymbol);
		if (latestMarketItemByMarketSymbolByItemSymbol) {
			const latestMarketItemByMarketSymbol = latestMarketItemByMarketSymbolByItemSymbol.get(itemSymbol);
			if (latestMarketItemByMarketSymbol) {
				return latestMarketItemByMarketSymbol.get(marketSymbol) || null;
			}
		}
		return null;
	}
	
	getMostRecentItem(items: UiMarketItem[] | undefined) {
		if (items && items.length > 0) {
			items.sort((i1, i2) => {
				if (i1.timestamp < i2.timestamp) return -1;
				if (i1.timestamp > i2.timestamp) return 1;
				return 0;
				});
			return items[items.length-1];
		}
		return null;
	}
	getItemHistoryAtMarket(marketSymbol: string, itemSymbol: string): UiMarketItem[]{
		const marketItemsByTradeSymbol: Map<string, UiMarketItem[]> | undefined
		                  = this.marketItemsByTradeSymbolByWaypointSymbol.get(marketSymbol);
		return marketItemsByTradeSymbol?.get(itemSymbol) || [];
	}
	getItemHistoricalLowPriceAtMarket(marketSymbol: string, itemSymbol: string, sinceTime: number): number{
		let bestPrice = Infinity;
		const marketItemsByTradeSymbol: Map<string, UiMarketItem[]> | undefined
	                  = this.marketItemsByTradeSymbolByWaypointSymbol.get(marketSymbol);
		const allItems = marketItemsByTradeSymbol?.get(itemSymbol) || [];
		for (let item of allItems) {
			if (item.timestamp.getTime() > sinceTime) {
				const price = item.purchasePrice;
				if (price < bestPrice) {
					bestPrice = price;
				}
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
	
	findCheapestMarketItemForSaleInSystem(fromWaypoint: WaypointBase, itemSymbol: string, unitsToBuy: number, excludeImportMarkets: boolean): UiMarketItem | null {
		let bestMarketItem: UiMarketItem | null = null;
		let bestCost = Infinity;
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(fromWaypoint.symbol);
		const fuelPricesByWaypointSymbol = this.getPricesForItemInSystemByWaypointSymbol(systemSymbol, 'FUEL');
		const localFuelCostItem = fuelPricesByWaypointSymbol.get(fromWaypoint.symbol);
		const localFuelCost = localFuelCostItem?.purchasePrice || Infinity;
		
		const items: Map<string, UiMarketItem> = this.getPricesForItemInSystemByWaypointSymbol(systemSymbol, itemSymbol)
		for (const marketSymbol of items.keys()) {
			const marketItem = items.get(marketSymbol);
			const market = this.galaxyService.getWaypointByWaypointSymbol(marketSymbol);
			if (marketItem && market && (!excludeImportMarkets || marketItem.type != MarketItemType.IMPORT)) {
				const marketFuelCostItem = fuelPricesByWaypointSymbol.get(marketSymbol);
				const marketFuelCost = marketFuelCostItem?.purchasePrice || Infinity;
				const fuelCost = Math.min(marketFuelCost, localFuelCost, this.getAverageFuelCost(systemSymbol));
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
		this.dbService.addMarketTransaction(transaction);
	}

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
		const itemCostByMarketSymbol = new Map<string, UiMarketItem> ();
		systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemSymbol);
		let latestMarketItemByMarketSymbolByItemSymbol = this.latestMarketItemByMarketSymbolByItemSymbolBySystemSymbol.get(systemSymbol);
		if (latestMarketItemByMarketSymbolByItemSymbol) {
			let latestMarketItemByMarketSymbol = latestMarketItemByMarketSymbolByItemSymbol.get(itemSymbol);
			if (latestMarketItemByMarketSymbol) {
				for (const marketSymbol of latestMarketItemByMarketSymbol.keys()) {
					const marketItem = latestMarketItemByMarketSymbol.get(marketSymbol);
					const market = this.galaxyService.getWaypointByWaypointSymbol(marketSymbol);
					if (marketItem && market) {
						itemCostByMarketSymbol.set(marketSymbol, marketItem);
					}
				}
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
		const latestMarketItemByTradeSymbol = this.latestMarketItemByTradeSymbolByWaypointSymbol.get(marketSymbol);
		if (latestMarketItemByTradeSymbol) {
			const latestMarketItems: UiMarketItem[] = [];
			let allHavePriceData = true;
			let haveSomePriceData = false;
			for (const itemSymbol of latestMarketItemByTradeSymbol.keys()) {
				const latestMarketItem = latestMarketItemByTradeSymbol.get(itemSymbol);
				if (latestMarketItem) {
					latestMarketItems.push(latestMarketItem);
					if (latestMarketItem.purchasePrice == 0) {
						allHavePriceData = false;
					} else {
						haveSomePriceData = true;
					}
				}
			}
			return allHavePriceData && haveSomePriceData;
		}
		return false;
	}
	
	lastUpdateDate(marketSymbol: string): Date | null {
		const latestMarketItemByTradeSymbol = this.latestMarketItemByTradeSymbolByWaypointSymbol.get(marketSymbol);
		if (!latestMarketItemByTradeSymbol) {
			return null;
		}
		let leastRecentTimestamp: Date | null = null;
		for (const latestMarketItem of latestMarketItemByTradeSymbol.values()) {
			if ((!leastRecentTimestamp || latestMarketItem.timestamp < leastRecentTimestamp)) {
				leastRecentTimestamp = latestMarketItem.timestamp;
			}
		}
		return leastRecentTimestamp;		
	}
	
	getAllItemsForTradeInSystem(systemSymbol: string): Set<string> {
		const items = new Set<string>();
		for (const marketSymbol of this.getMarketSymbolsInSystem(systemSymbol) || []) {
			const latestMarketItemByTradeSymbol = this.latestMarketItemByTradeSymbolByWaypointSymbol.get(marketSymbol);
			for (const tradeSymbol of latestMarketItemByTradeSymbol?.keys() || []) {
				items.add(tradeSymbol);
			}
		}
		return items;
	}
	getBestTradeRoutesFrom(ship: Ship, waypoint: WaypointBase, cargoCapacity: number, creditsAvailable: number,
	                       excludedTradeItems: Set<string>): TradeRoute | null {
		const latestMarketItemByTradeSymbol = this.latestMarketItemByTradeSymbolByWaypointSymbol.get(waypoint.symbol);
		let bestRoute: TradeRoute | null = null;
		for (const tradeSymbol of latestMarketItemByTradeSymbol?.keys() || []) {
			if (excludedTradeItems.has(tradeSymbol)) {
				continue;
			}
			const itemPricesByMarket: Map<string, UiMarketItem> = this.getPricesForItemInSystemByWaypointSymbol(waypoint.symbol, tradeSymbol);
			const purchaseItem = itemPricesByMarket.get(waypoint.symbol);
			if (purchaseItem && purchaseItem.purchasePrice > 0) {
				const units = Math.min(cargoCapacity, Math.floor(creditsAvailable / purchaseItem.purchasePrice));
				if (units > 0) {
					const cost = purchaseItem.purchasePrice * units;
					const sellPlan: SellPlan | null = this.findBestMarketToSell(ship, waypoint, purchaseItem.symbol, units, cost);
					if (sellPlan && sellPlan.sellItems[0].marketSymbol != waypoint.symbol) {
						const route: TradeRoute = {
							state: 'goBuy',
							startingWaypoint: waypoint,
							endingWaypoint: sellPlan.endingWaypoint,
							buyItem: purchaseItem,
							sellItems: sellPlan.sellItems,
							deliverItems: [],
							profit: sellPlan.profit, // - cost,
							route: sellPlan.route,
							travelTime: sellPlan.travelTime,
							profitPerSecond: sellPlan.profitPerSecond //(sellPlan.profit - cost) / sellPlan.travelTime
						};
						
						if (route && (route.profitPerSecond > 0) &&
						    (bestRoute == null || (route.profitPerSecond > bestRoute.profitPerSecond))) {
							bestRoute = route;
						}
					}
 				}
			}
		}
		return bestRoute;
	}
	
	findBestMarketToSell(ship: Ship, waypoint: WaypointBase, itemSymbol: string, unitsToSell: number, costBasis: number): SellPlan | null {
		const fuelPrices: Map<string, UiMarketItem> = this.getPricesForItemInSystemByWaypointSymbol(waypoint.symbol, 'FUEL');
		const itemPricesByMarketSymbol: Map<string, UiMarketItem> = this.getPricesForItemInSystemByWaypointSymbol(waypoint.symbol, itemSymbol);
		const fuelCostLocal = fuelPrices.get(waypoint.symbol)?.purchasePrice || Infinity;
		const originalCostBasis = costBasis;
		if (costBasis == 0) {
			let lowestPurchasePrice = Infinity;
			for (const itemPrice of itemPricesByMarketSymbol.values()) {
				if (lowestPurchasePrice > itemPrice.purchasePrice) {
					lowestPurchasePrice = itemPrice.purchasePrice;
				}
			}
			costBasis = lowestPurchasePrice * unitsToSell;
		}
		
		let best: SellPlan | null = null;
		for (const marketSymbol of itemPricesByMarketSymbol.keys()) {
			const sellItem: UiMarketItem | undefined = itemPricesByMarketSymbol.get(marketSymbol);
			const market = this.galaxyService.getWaypointByWaypointSymbol(marketSymbol);
			if (market && sellItem) {
				const fuelCostAtMarket = fuelPrices.get(market.symbol)?.purchasePrice || Infinity;
				let bestFuelCost = Math.min(fuelCostAtMarket, fuelCostLocal, this.getAverageFuelCost(marketSymbol));
				let distToMarket = LocXY.getDistance(market, waypoint);
				if ((distToMarket == 0) && (waypoint.symbol != market.symbol)) {
					distToMarket = 1;
				}

				const routes = this.getRouteOptions(waypoint, market, ship.fuel.current, ship);				
				for (const route of routes) {
					const profit = sellItem.sellPrice * unitsToSell - costBasis - route.fuel * bestFuelCost * 2; // use round-trip fuel cost
					const profitPerSecond = profit / route.time;
					
					if (profit > 0) {
						if ((best == null) || (profitPerSecond > best.profitPerSecond)) {
							best = {
								startingWaypoint: waypoint, endingWaypoint: market,
								sellItems: [sellItem],  deliverItems: [],
								profitPerSecond, profit, route, travelTime: route.time};
						}
					} else {
						// If we are trying to minimize loses, we consider only profit,
						// instead of profit per second. Otherwise, the logic would send
						// the ship to a more distant market, to increase the time, thus
						// reducing the loss/second
						if ((best == null) || (profit > best.profit)) {
							best = {
								startingWaypoint: waypoint, endingWaypoint: market,
								sellItems: [sellItem],  deliverItems: [],
								profitPerSecond, profit, route, travelTime: route.time};
						}
					}
				}
			}
		}
		if (best && (best.profit > 0)) {
			// found at least one profitable sell point
			return best;
		}
		if (originalCostBasis == 0) {
			// We didn't find a profitable sell point, based on the assumed costbasis we got from the currnet
			// market states, but this represents the place we could sell these items at the least loss,
			// which may at least free up the cargo space in the ship for a more profitable trade.
			return best;
		}
		// We didn't find any profitable routes for this item
		return null;
	}
	
	findBestMarketToSellAll(ship: Ship, waypoint: WaypointBase, costBasis: number): SellPlan | null {
		const fuelPrices: Map<string, UiMarketItem> = this.getPricesForItemInSystemByWaypointSymbol(waypoint.symbol, 'FUEL');
		const fuelCostLocal = fuelPrices.get(waypoint.symbol)?.purchasePrice || Infinity;
		let best: SellPlan | null = null;
		
		const marketSymbols: Set<string> | undefined = this.marketSymbolsBySystemSymbol.get(GalaxyService.getSystemSymbolFromWaypointSymbol(waypoint.symbol));
		for (const marketSymbol of marketSymbols || []) {
			const market = this.galaxyService.getWaypointByWaypointSymbol(marketSymbol);
			const latestMarketItemByTradeSymbol = this.latestMarketItemByTradeSymbolByWaypointSymbol.get(marketSymbol);
			if (latestMarketItemByTradeSymbol && market) {
				let proceedsAtMarket = 0;
				const marketSellItems: UiMarketItem[] = [];
				for (const inv of ship.cargo.inventory) {
					const marketItem = latestMarketItemByTradeSymbol.get(inv.symbol);
					if (marketItem) {
						proceedsAtMarket += marketItem.sellPrice * inv.units;
						marketSellItems.push(marketItem);
					}
				}
				// get fuel and distance to this market
				const fuelItem = latestMarketItemByTradeSymbol.get('FUEL');
				let distToMarket = LocXY.getDistance(market, waypoint);
				if ((distToMarket == 0) && (waypoint.symbol != market.symbol)) {
					distToMarket = 1;
				}
				const fuelCostAtMarket = fuelItem?.purchasePrice || Infinity;
				let bestFuelCost = Math.min(fuelCostAtMarket, fuelCostLocal, this.getAverageFuelCost(marketSymbol));
				
				const routes = this.getRouteOptions(waypoint, market, ship.fuel.current, ship);				
				for (const route of routes) {
					const profit = proceedsAtMarket - costBasis - route.fuel * bestFuelCost * 2; // use round-trip fuel cost
					const profitPerSecond = profit / route.time;
					
					if (profit > 0 && ((best == null) || (profitPerSecond > best.profitPerSecond))) {
						best = {
							startingWaypoint: waypoint, endingWaypoint: market,
							sellItems: marketSellItems, deliverItems: [],
							profitPerSecond, profit, route, travelTime: route.time};
					}
				}
			}
		}
		return best;
	}
	
	getRouteOptions(fromWaypoint: WaypointBase, toWaypoint: WaypointBase, currentFuel: number, ship: Ship): Route[] {
		const path = [];
		if (fromWaypoint.symbol == toWaypoint.symbol) {
			path.push({steps: [], time: 1, fuel: 0});
		} else {
			const system = this.galaxyService.getSystemBySymbol(fromWaypoint.symbol);
			if (system && system.waypoints) {
				const fuelPricesByWaypointSymbol = this.getPricesForItemInSystemByWaypointSymbol(system.symbol, 'FUEL');
				const hasFuelStation = fuelPricesByWaypointSymbol.has(fromWaypoint.symbol);
				for (const speed of ['BURN', 'CRUISE', 'DRIFT']) {
					const dist = LocXY.getDistance(fromWaypoint, toWaypoint);
					const time = Ship.getTravelTime(ship, speed, dist);
					const fuel = Ship.getFuelUsed(ship, speed, dist);
					if (hasFuelStation) {
						// allow a refuel
						currentFuel = ship.fuel.capacity;
					}
					if (fuel < currentFuel) {
						path.push({steps:[{loc: toWaypoint, speed}], time, fuel});
					} else {
						// Try to find the furthest distance we can go, that is closest to the destination:
						const fuelWaypoints = system.waypoints.filter((wp) => fuelPricesByWaypointSymbol.has(wp.symbol));
						let maxFuel = currentFuel;
						if (hasFuelStation) {
							maxFuel = ship.fuel.capacity;
						}
						const maxRange = maxFuel * (dist / fuel);
						const fuelWaypointsInRange = fuelWaypoints.filter((wp) => LocXY.getDistance(fromWaypoint, wp) < maxRange);
						if (fuelWaypointsInRange.length > 0) {
							fuelWaypointsInRange.push(fromWaypoint);
							const fuelStationsNearestToDest = ExplorationService.sortWaypointsByDistanceFrom(fuelWaypointsInRange, toWaypoint);
							while (fuelStationsNearestToDest.length > 0) {
								const fuelStationNearestToDest = fuelStationsNearestToDest.shift();
								if (fuelStationNearestToDest) {
									// make sure we are actually getting closer to our destination:
									const newDist = LocXY.getDistance(fuelStationNearestToDest, toWaypoint);
									const newTime = Ship.getTravelTime(ship, speed, newDist);
									const newFuel = Ship.getFuelUsed(ship, speed, newDist);
									if (newDist < dist && newFuel < currentFuel ) {
										const nextLegOptions = this.getRouteOptions(fuelStationNearestToDest, toWaypoint, currentFuel - fuel, ship);
										for (const nextLegOption of nextLegOptions) {
											path.push({
												steps:[{
													loc: fuelStationNearestToDest, speed}, ...nextLegOption.steps],
												time: newTime + nextLegOption.time,
												fuel: newFuel + nextLegOption.fuel});
										}
									}
								}
							}
						}
					}
				}
			}
		}
		return path;
	}
}

export class RouteStep {
 	loc!: WaypointBase;
 	speed!: string;
}
export class Route 	{
	steps!: RouteStep[];
	time!: number;
	fuel!: number
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
	/* This method compare everything except the timestamp */
	static compare = function(mi1: UiMarketItem, mi2: UiMarketItem) {
		return mi1.purchasePrice == mi2.purchasePrice &&
			   mi1.marketSymbol == mi2.marketSymbol &&
			   mi1.tradeVolume == mi2.tradeVolume &&
			   mi1.sellPrice == mi2.sellPrice &&
			   mi1.activity == mi2.activity &&
			   mi1.supply == mi2.supply &&
			   mi1.symbol == mi2.symbol &&
			   mi1.type == mi2.type;
	};
}
export class UiMarket {
	symbol!: string;
	marketItems: UiMarketItem[] =[];
}

export class SellPlan {
	startingWaypoint!: WaypointBase;
	endingWaypoint!: WaypointBase;
	sellItems!: UiMarketItem[];
	deliverItems!: UiMarketItem[];
	profit!: number;
	route!: Route
	travelTime!: number;
	profitPerSecond!: number;
};

export class TradeRoute extends SellPlan {
	buyItem: UiMarketItem | null = null;
	state!: 'collect' | 'goBuy' | 'buy' | 'goSell' | 'sell';
}
