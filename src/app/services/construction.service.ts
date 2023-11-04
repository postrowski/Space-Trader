import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { ConstructionMaterial, ConstructionSite } from 'src/models/ConstructionSite';
import { ShipCargo } from 'src/models/ShipCargo';
import { DBService } from './db.service';
import { BehaviorSubject, Observable, shareReplay } from 'rxjs';
import { GalaxyService } from './galaxy.service';
import { AccountService } from './account.service';
import { FleetService } from './fleet.service';

@Injectable({
  providedIn: 'root'
})
export class ConstructionService {
    public apiUrlSystems = 'https://api.spacetraders.io/v2/systems';

	public constructionSiteSubject = new BehaviorSubject<ConstructionSite | null>(null);

	constructor(private http: HttpClient,
				public accountService: AccountService,
				public fleetService: FleetService,
	            public dbService: DBService) { }
  
  	updateConstructionSite(constructionSite: ConstructionSite) {
		this.constructionSiteSubject.next(constructionSite);
	}
	
  	getConstructionSite(waypointSymbol:string) : Observable<{data: ConstructionSite}> {
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(waypointSymbol);
		const headers = this.accountService.getHeader();
		const observable = this.http.get<{data: ConstructionSite}>
		                    (`${this.apiUrlSystems}/${systemSymbol}/waypoints/${waypointSymbol}/construction`, {headers})
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			this.updateConstructionSite(response.data);
		}, (error) => {});
		return observable;
	}
	supplyConstructionSite(waypointSymbol:string, shipSymbol: string, tradeSymbol: string, units: number) : Observable<{data: {construction: ConstructionSite, cargo: ShipCargo}}> {
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(waypointSymbol);
		const body = {shipSymbol, tradeSymbol, units};
		const headers = this.accountService.getHeader();
		const observable = this.http.post<{data: {construction: ConstructionSite, cargo: ShipCargo}}>
		                    (`${this.apiUrlSystems}/${systemSymbol}/waypoints/${waypointSymbol}/construction/supply`,
		                     body, {headers})
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			this.updateConstructionSite(response.data.construction);
			this.fleetService.updateShipCargo(shipSymbol, response.data.cargo);
		}, (error) => {});
		return observable;
	}

	static getConstructionMaterial(tradeSymbol: string, constructionSite: ConstructionSite): ConstructionMaterial | null {
		for (let material of constructionSite.materials) {
			if (material.tradeSymbol == tradeSymbol) {
				const remainingUnits = material.required - material.fulfilled;
				if (remainingUnits > 0) {
					return material;
				}
			}
		}
		return null;
	}

}
