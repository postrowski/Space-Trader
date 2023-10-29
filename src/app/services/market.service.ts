import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { liveQuery } from 'dexie';
import { BehaviorSubject, map, Observable, of, shareReplay } from 'rxjs';
import { Market } from 'src/models/Market';
import { AccountService } from './account.service';
import { DBService } from './db.service';
import { GalaxyService } from './galaxy.service';

@Injectable({
  providedIn: 'root'
})
export class MarketService {
	public apiUrlSystems = 'https://api.spacetraders.io/v2/systems';

	private allMarketsSubject = new BehaviorSubject<Market[] | null>(null);
	allMarkets$: Observable<Market[] | null> = this.allMarketsSubject.asObservable();

	constructor(private http: HttpClient,
				public galaxyService: GalaxyService,
				public dbService: DBService,
				public accountService: AccountService) {
	    this.dbService.initDatabase().then(() => {
			liveQuery(() => this.dbService.markets.toArray()).subscribe((response) => {
				this.allMarketsSubject.next(response);
				for (let market of response) {
					this.recordMarket(market);
				}
			});
	    });
	}
	
	marketByWaypointSymbol: Map<string, Market> = new Map();
	marketExpirationTimestampByWaypointSymbol: Map<string, number> = new Map();
	marketsBySystemSymbol: Map<string, Market[]> = new Map();
	marketExpirationTime = 15 * 60 * 1000; // 15 minutes
	currentPriceByTradeSymbolByWaypoint: { [waypointSymbol: string]: { [tradeSymbol: string]: number } } = {};

	recordMarket(market: Market) {
		const systemWaypointSymbol = market.symbol;
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemWaypointSymbol);
		this.marketByWaypointSymbol.set(systemWaypointSymbol, market);
		let marketsInSystem = this.marketsBySystemSymbol.get(systemSymbol);
		if (!marketsInSystem) {
			marketsInSystem = [];
			this.marketsBySystemSymbol.set(systemSymbol, marketsInSystem);
		} else {
			// If the market already exists in our array, remove it from the array,
			// and then either way insert the new value
			for (let existingMarket of marketsInSystem) {
				if (existingMarket.symbol == market.symbol) {
					const index = marketsInSystem.indexOf(existingMarket);
					marketsInSystem = marketsInSystem.splice(index, 1);
					this.marketsBySystemSymbol.set(systemSymbol, marketsInSystem);
					break;
				}
			}
		}
		marketsInSystem.push(market);
		// record all the tradeGoods for this market:
		for (let tradeGood of market.tradeGoods || []) {
			let currentPriceByTradeSymbol = this.currentPriceByTradeSymbolByWaypoint[market.symbol];
			if (!currentPriceByTradeSymbol) {
				currentPriceByTradeSymbol = {};
				this.currentPriceByTradeSymbolByWaypoint[market.symbol] = currentPriceByTradeSymbol;
			}
			currentPriceByTradeSymbol[tradeGood.symbol] = tradeGood.sellPrice;
		}
	}
	
	getCachedMarketplace(systemWaypointSymbol:string, considerExpiration: boolean): Market | null{
		if (considerExpiration) {
			const marketExpirationTimestamp = this.marketExpirationTimestampByWaypointSymbol.get(systemWaypointSymbol);
			if (!marketExpirationTimestamp || marketExpirationTimestamp < Date.now()) {
				return null;
			}
		}
		const market = this.marketByWaypointSymbol.get(systemWaypointSymbol);
		if (market && (market.tradeGoods && market.tradeGoods.length > 0)) {
			return market;
		}
		return null;
	}
	getMarketplace(systemWaypointSymbol:string, shipsAtWaypoint: boolean) : Observable<Market> {
		const market = this.marketByWaypointSymbol.get(systemWaypointSymbol);
		const marketExpirationTimestamp = this.marketExpirationTimestampByWaypointSymbol.get(systemWaypointSymbol);
		if (market && 
		    marketExpirationTimestamp && marketExpirationTimestamp > Date.now() && 
	     	(!shipsAtWaypoint || (market.tradeGoods && market.tradeGoods.length > 0))) {
			// If the market is already cached, and not expired, return it as an observable
    		return of(market);
		}
		
		const headers = this.accountService.getHeader();
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemWaypointSymbol);
			
		const observable = this.http.get<{ data: Market }>
			(`${this.apiUrlSystems}/${systemSymbol}/waypoints/${systemWaypointSymbol}/market`, { headers })
			.pipe(map((response: any) => response.data as Market)) // Extract 'data' as Market
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((market)=> {
			this.marketExpirationTimestampByWaypointSymbol.set(systemWaypointSymbol,
			                                                   Date.now() + this.marketExpirationTime);
			this.recordMarket(market);
			this.dbService.addMarket(market);
		}, (error) => {});
		return observable;
	}
	
	findCheapestMarketWithItemForSale(systemSymbol: string | null, itemSymbol: string): Market | null {
		let bestMarket = null;
		let bestPrice = null;
		for (let marketSymbol of this.marketsBySystemSymbol.keys()) {
			// if systemSymbol is present, we only look within that system
			if (systemSymbol && !marketSymbol.startsWith(systemSymbol)) {
				continue;
			}
			const market = this.marketByWaypointSymbol.get(marketSymbol);
			for (const tradeGood of market?.tradeGoods || []) {
				if (tradeGood.symbol == itemSymbol) {
					if (bestPrice == null || bestPrice > tradeGood.purchasePrice) {
						bestPrice = tradeGood.purchasePrice;
						bestMarket = market;
					}
				}
			}
		}
		if (bestMarket) {
			return bestMarket;
		}
		if (systemSymbol) {
			// If we couldn't find it in the specified system, look in other systems.
			return this.findCheapestMarketWithItemForSale(null, itemSymbol);
		}
		return null;
	}

}
