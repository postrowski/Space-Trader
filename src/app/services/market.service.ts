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

	dbMarkets$ = liveQuery(() => this.dbService.markets.toArray());
	private allMarketsSubject = new BehaviorSubject<Market[] | null>(null);
	allMarkets$: Observable<Market[] | null> = this.allMarketsSubject.asObservable();

	constructor(private http: HttpClient,
				public galaxyService: GalaxyService,
				public dbService: DBService,
				public accountService: AccountService) {
		this.dbMarkets$.subscribe((response) => {
			this.allMarketsSubject.next(response);
			for (let market of response) {
				this.recordMarket(market);
			}
		});
	}
	
	marketByWaypointSymbol: Map<string, Market> = new Map();
	marketExpirationTimestampByWaypointSymbol: Map<string, number> = new Map();
	marketsBySystemSymbol: Map<string, Market[]> = new Map();
	marketExpirationTime = 15 * 60 * 1000; // 15 minutes

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
}
