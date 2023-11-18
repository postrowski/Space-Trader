import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { liveQuery } from 'dexie';
import { BehaviorSubject, map, Observable, of, shareReplay } from 'rxjs';
import { Shipyard } from 'src/models/Shipyard';
import { AccountService } from './account.service';
import { DBService } from './db.service';
import { GalaxyService } from './galaxy.service';
import { WaypointBase } from 'src/models/WaypointBase';

@Injectable({
  providedIn: 'root'
})
export class ShipyardService {
	public apiUrlSystems = 'https://api.spacetraders.io/v2/systems';

	private allShipyardsSubject = new BehaviorSubject<Shipyard[] | null>(null);
	allShipyards$: Observable<Shipyard[] | null> = this.allShipyardsSubject.asObservable();
	
	shipyardByWaypointSymbol = new Map<string, Shipyard>();
	shipyardExpirationTimestampByWaypointSymbol = new Map<string, number>();
	shipyardsBySystemSymbol = new Map<string, Shipyard[]>();
	shipyardExpirationTime = 15 * 60 * 1000; // 15 minutes

	constructor(private http: HttpClient,
				public galaxyService: GalaxyService,
				public dbService: DBService,
				public accountService: AccountService) {
		this.dbService.initDatabase().then(() => {
			liveQuery(() => this.dbService.shipyards.toArray()).subscribe((response) => {
				this.allShipyardsSubject.next(response);
				for (let Shipyard of response) {
					this.recordShipyard(Shipyard);
				}
			});
		});
	}
	onServerReset() {
		this.allShipyardsSubject.next(null);
		this.shipyardByWaypointSymbol = new Map<string, Shipyard>();
		this.shipyardExpirationTimestampByWaypointSymbol = new Map<string, number>();
		this.shipyardsBySystemSymbol = new Map<string, Shipyard[]>();
	}

	recordShipyard(Shipyard: Shipyard) {
		const systemWaypointSymbol = Shipyard.symbol;
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemWaypointSymbol);
		this.shipyardByWaypointSymbol.set(systemWaypointSymbol, Shipyard);
		let shipyardsInSystem = this.shipyardsBySystemSymbol.get(systemSymbol);
		if (!shipyardsInSystem) {
			shipyardsInSystem = [];
			this.shipyardsBySystemSymbol.set(systemSymbol, shipyardsInSystem);
		} else {
			// If the Shipyard already exists in our array, remove it from the array,
			// and then either way insert the new value
			for (let existingShipyard of shipyardsInSystem) {
				if (existingShipyard.symbol == Shipyard.symbol) {
					const index = shipyardsInSystem.indexOf(existingShipyard);
					shipyardsInSystem = shipyardsInSystem.splice(index, 1);
					this.shipyardsBySystemSymbol.set(systemSymbol, shipyardsInSystem);
					break;
				}
			}
		}
		shipyardsInSystem.push(Shipyard);
	}
	
	
	getCachedShipyard(systemWaypointSymbol:string, considerExpiration: boolean): Shipyard | null{
		if (considerExpiration) {
			const marketExpirationTimestamp = this.shipyardExpirationTimestampByWaypointSymbol.get(systemWaypointSymbol);
			if (!marketExpirationTimestamp || marketExpirationTimestamp < Date.now()) {
				return null;
			}
		}
		return this.shipyardByWaypointSymbol.get(systemWaypointSymbol) || null;
	}
	
	getShipyard(systemWaypointSymbol:string, shipsAtWaypoint: boolean) : Observable<Shipyard> {
		const shipyard = this.shipyardByWaypointSymbol.get(systemWaypointSymbol);
		const shipyardExpirationTimestamp = this.shipyardExpirationTimestampByWaypointSymbol.get(systemWaypointSymbol);
		if (shipyard && 
		    shipyardExpirationTimestamp && shipyardExpirationTimestamp > Date.now() && 
	     	(!shipsAtWaypoint || (shipyard.ships && shipyard.ships.length > 0))) {
			// If the Shipyard is already cached, and not expired, return it as an observable
    		return of(shipyard);
		}
		
		const headers = this.accountService.getHeader();
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemWaypointSymbol);
		
		const observable = this.http.get<{ data: Shipyard }>
			(`${this.apiUrlSystems}/${systemSymbol}/waypoints/${systemWaypointSymbol}/shipyard`, { headers })
			.pipe(map((response: any) => response.data as Shipyard)) // Extract 'data' as Shipyard
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((Shipyard)=> {
			this.shipyardExpirationTimestampByWaypointSymbol.set(systemWaypointSymbol,
			                                                   Date.now() + this.shipyardExpirationTime);
			this.recordShipyard(Shipyard);
			this.dbService.addShipyard(Shipyard);
		}, (error) => {});
		return observable;
	}
	
	findNearestShipyard(waypoint: WaypointBase): Shipyard | null {
		const systemSymbol = waypoint ? GalaxyService.getSystemSymbolFromWaypointSymbol(waypoint.symbol) : null;
		for (let shipyardSymbol of this.shipyardsBySystemSymbol.keys()) {
			// Only look within the system of the current ship
			if (systemSymbol && !shipyardSymbol.startsWith(systemSymbol)) {
				continue;
			}
			// TODO: if multiple shipyards in a single system, find the closest one.
			return this.shipyardByWaypointSymbol.get(shipyardSymbol) || null;
		}
		return null;
	}

}
