import { HttpClient } from '@angular/common/http';
import { Injectable, OnInit } from '@angular/core';
import { BehaviorSubject, map, Observable, of, Subject } from 'rxjs';
import { Agent } from 'src/models/Agent';
import { Chart } from 'src/models/Chart';
import { Cooldown } from 'src/models/Cooldown';
import { RefinementProduction } from 'src/models/RefinementProduction';
import { ScannedShip } from 'src/models/ScannedShip';
import { Ship } from 'src/models/Ship';
import { ShipCargo } from 'src/models/ShipCargo';
import { ShipFuel } from 'src/models/ShipFuel';
import { ShipNav } from 'src/models/ShipNav';
import { ShipyardTransaction } from 'src/models/ShipyardTransaction';
import { System } from 'src/models/System';
import { Waypoint } from 'src/models/Waypoint';
import { AccountService } from './account.service';
import { LocXY } from 'src/models/LocXY';
import { EventQueueService } from './event-queue.service';
import { concatMap, shareReplay } from 'rxjs/operators';
import { Survey } from 'src/models/Survey';
import { Extraction } from 'src/models/Extraction';
import { ShipCargoItem } from 'src/models/ShipCargoItem';
import { SurveyService } from './survey.service';
import { DBService } from './db.service';
import { ShipMount } from 'src/models/ShipMount';
import { GalaxyService } from './galaxy.service';
import { Meta } from 'src/models/Meta';
import { JumpTransaction } from 'src/models/JumpTransaction';

@Injectable({
	providedIn: 'root'
})
export class FleetService implements OnInit {

	private apiUrlMyShips = 'https://api.spacetraders.io/v2/my/ships';

	private allShipsSubject = new BehaviorSubject<Ship[]>([]);
	allShips$: Observable<Ship[]> = this.allShipsSubject.asObservable();

	private activeShipSubject = new BehaviorSubject<Ship | null>(null);
	activeShip$: Observable<Ship | null> = this.activeShipSubject.asObservable();
	
	private shipLocationsBySymbol: { [shipSymbol: string]: {system: string, loc: LocXY}} = {};
	private shipLocationsSubject = new BehaviorSubject<{ [shipSymbol: string]: {system: string, loc: LocXY} }>({});
	shipLocations$: Observable<{ [shipSymbol: string]: {system: string, loc: LocXY} }> = this.shipLocationsSubject.asObservable();

	private surveysByWaypoint: { [waypointSymbol: string]: Survey[] } = {};
	private surveysByWaypointSubject = new BehaviorSubject<{ [waypointSymbol: string]: Survey[] }>({});
	surveysByWaypoint$: Observable<{ [waypointSymbol: string]: Survey[] }> = this.surveysByWaypointSubject.asObservable();

	constructor(private http: HttpClient,
				public accountService: AccountService,
	            public surveyService: SurveyService, 
	            public eventQueueService: EventQueueService,
	            public galaxyService: GalaxyService,
	            public dbService: DBService) {
		this.accountService.agent$.subscribe((agent) => {
			// once we've got an agent, we can load our ships
			if (agent) {
				this.updateFleet();
			}
		})
	}
	            
	// Add or update the location of a ship
	setShipLocation(ship: Ship, system: string, loc: LocXY): void {
		this.shipLocationsBySymbol[ship.symbol] = {system, loc};
		this.shipLocationsSubject.next({ ...this.shipLocationsBySymbol });
	}
	setSurveysByLocation(waypointSymbol: string, surveys: Survey[]): void {
		this.surveysByWaypoint[waypointSymbol] = surveys;
		this.surveysByWaypointSubject.next({ ...this.surveysByWaypoint });
	}
	getSurveysByLocation(waypointSymbol: string): Survey[]{
		let surveys = this.surveysByWaypoint[waypointSymbol];
		if (surveys == undefined) {
			return [];
		}
		let updated = false;
		for (let i = surveys.length - 1; i >= 0; i--) {
			if (new Date(surveys[i].expiration).getTime() > Date.now()) {
				surveys.splice(i, 1); // Remove the expired survey
				updated = true;
			}
		}
		if (updated) {
			this.surveysByWaypointSubject.next({ ...this.surveysByWaypoint });
		}
		return surveys;
	}
 
	setActiveShip(ship: Ship) {
		this.activeShipSubject.next(ship);
	}
	getActiveShip(): Ship | null {
		return this.activeShipSubject.value;
	}
	getShips(): Ship[] {
		return this.allShipsSubject.value;
	}
	getShipBySymbol(shipSymbol: string): Ship | null {
		for (let ship of this.getShips()) {
			if (ship.symbol == shipSymbol) {
				return ship;
			}
		}
		return null;
	}
	addShip(newShip: Ship) {
		for (let ship of this.getShips()) {
			if (ship.symbol === newShip.symbol) {
				// Update the current ship from the new ship
				ship.update(newShip);
				return;
			}
		}
		let ship = new Ship();
		ship.update(newShip);
		const currentShips = this.allShipsSubject.value; // Get the current array
		currentShips.push(ship); // Add the new System
		this.allShipsSubject.next(currentShips); // Emit the updated array
		// If this ship is moving, track its movement:
		let withinSystem: System | undefined | null = null;
		if (ship.nav.route.origin.systemSymbol == ship.nav.route.destination.systemSymbol) {
			withinSystem = this.galaxyService.getSystemBySymbol(ship.nav.route.destination.systemSymbol);
		}
		this.eventQueueService.trackMovement(ship, withinSystem, (system: string, shipLoc: LocXY) => {
			this.setShipLocation(ship, system, shipLoc)
		}, (ship: Ship, shipLocXY) => {
		});
		
		let activeShip = this.getActiveShip();
		if (activeShip == null || this.getShips().indexOf(activeShip) == -1) {
			this.selectFirstShip();
		}
	}
	ngOnInit() {
		console.log(`start ngOnInit`);
	}
  	ngOnDestroy() {
	}
  
	updateFleet(): Observable<Ship[]> {
		const observable = this.updateFleet2(20, 1)
		      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
		}, (error) => {});
		return observable;
	}

	updateFleet2(limit: number, page: number): Observable<Ship[]> {
		return this.getFleet(limit, page)
				   .pipe(concatMap((response) => {
						if (response.meta.total > limit * page) {
							// If there are more pages, recursively load them
							return this.updateFleet2(limit, page + 1)
							           .pipe(map((nextPageResults) => [...response.data, ...nextPageResults]));
						}
						// No more pages, just return the data from this page
						return of(response.data);
					})
			);
	}

	selectFirstShip() {
		// Set the activeShip to the first ship in the list
		if (this.allShipsSubject.value.length > 0) {
			this.setActiveShip(this.allShipsSubject.value[0]);
		}
	}

	updateShipCargo(shipSymbol: string, shipCargo: ShipCargo) {
		const ship = this.getShipBySymbol(shipSymbol);
		if (ship) {
			// Update the ship in our list of ships from the response
			ship.cargo = shipCargo;
		}
	}

	//////////////////////
	// Ship API Calls
	getFleet(limit: number, page: number): Observable<{data:Ship[], meta: Meta}> {
		const headers = this.accountService.getHeader();
		const params = {
			limit: limit,
			page: page
		}
		const observable = this.http.get<{data:Ship[], meta: Meta}>(`${this.apiUrlMyShips}`, { headers, params })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			for (let ship of response.data) {
				this.addShip(ship);
			}
		}, (error) => {});
		return observable;
	}
	purchaseShip(shipType: string, waypointSymbol: string): Observable<{ agent?: Agent, ship?: Ship, transaction?: ShipyardTransaction }> {
		const headers = this.accountService.getHeader();
		const body = {
			shipType: shipType,
			waypointSymbol: waypointSymbol
		}
		const observable = this.http.post<{ agent?: Agent, ship?: Ship, transaction?: ShipyardTransaction }>
			(`${this.apiUrlMyShips}`, body, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			if (response.ship) {
				this.addShip(response.ship);
			}
			if (response.agent) {
				this.accountService.updateAgent(response.agent);
			}
		}, (error) => {});
		return observable;
	}

	getShip(shipSymbol: string): Observable<Ship> {
		const headers = this.accountService.getHeader();
		const observable = this.http.get<Ship>(`${this.apiUrlMyShips}/${shipSymbol}`, { headers })
			.pipe(map((response: any) => response.data as Ship)) // Extract 'data' as Ship
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			// Update the ship in our list of ships from the response
			this.addShip(response);
		}, (error) => {});
		return observable;
	}

	getShipCargo(shipSymbol: string): Observable<ShipCargo> {
		const headers = this.accountService.getHeader();
		const observable = this.http.get<ShipCargo>(`${this.apiUrlMyShips}/${shipSymbol}/cargo`, { headers })
			.pipe(map((response: any) => response.data as ShipCargo)) // Extract 'data' as ShipCargo
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			this.updateShipCargo(shipSymbol, response);
		}, (error) => {});
		return observable;
	}

	orbitShip(shipSymbol: string): Observable<{data: {nav:ShipNav}}> {
		const headers = this.accountService.getHeader();
		const observable = this.http.post<{data: {nav:ShipNav}}>(`${this.apiUrlMyShips}/${shipSymbol}/orbit`, {}, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			const ship = this.getShipBySymbol(shipSymbol);
			if (ship) {
				ship.nav = response.data.nav;
			}
		}, (error) => {});
		return observable;
	}
	dockShip(shipSymbol: string): Observable<{data: {nav:ShipNav}}> {
		const headers = this.accountService.getHeader();
		const observable = this.http.post<{data: {nav:ShipNav}}>(`${this.apiUrlMyShips}/${shipSymbol}/dock`, {}, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			const ship = this.getShipBySymbol(shipSymbol);
			if (ship) {
				ship.nav = response.data.nav;
			}
		}, (error) => {});
		return observable;
	}

	shipRefine(shipSymbol: string, productionType: string): Observable<{data: RefinementProduction}> {
		const headers = this.accountService.getHeader();
		const body = {
			produce: productionType
			// allowed types: IRON, COPPER, SILVER, GOLD, ALUMINUM, PLATINUM, URANITE, MERITIUM, FUEL
		}
		const observable = this.http.post<{data: RefinementProduction}>(`${this.apiUrlMyShips}/${shipSymbol}/refine`,
			body, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			this.updateShipCargo(shipSymbol, response.data.cargo);
		}, (error) => {});
		return observable;
	}

	getShipCooldown(shipSymbol: string): Observable<{ data: Cooldown }> {
		//  --url https://api.spacetraders.io/v2/my/ships/shipSymbol/cooldown \
		const headers = this.accountService.getHeader();
		const observable = this.http.get<{ data: Cooldown }>(`${this.apiUrlMyShips}/${shipSymbol}/cooldown`,
			{ headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			// update the waypoint in the DB
			const ship = this.getShipBySymbol(shipSymbol);
			if (ship) {
				ship.cooldown = response.data;
			}
		}, (error) => {});
		return observable;
	}
	
	createChart(shipSymbol: string): Observable<{ data: {chart: Chart; waypoint: Waypoint }}> {
		const headers = this.accountService.getHeader();
		const observable = this.http.post<{ data: {chart: Chart; waypoint: Waypoint } }>(`${this.apiUrlMyShips}/${shipSymbol}/chart`,
			{}, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			// update the waypoint in the DB
			this.dbService.updateWaypoint(response.data.waypoint);
		}, (error) => {});
		return observable;
	}

	createSurvey(shipSymbol: string) : Observable<{ data: {cooldown: Cooldown; surveys: Survey[] }}> {
		const headers = this.accountService.getHeader();
		const observable = this.http.post<{ data: { cooldown: Cooldown; surveys: Survey[] } }>(`${this.apiUrlMyShips}/${shipSymbol}/survey`,
			{}, { headers })
			.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response) => {
			for (let survey of response.data.surveys) {
				this.surveyService.addSurvey(survey);
			}
			const ship = this.getShipBySymbol(shipSymbol);
			if (ship) {
				ship.cooldown = response.data.cooldown;
				this.addSurveys(response.data.surveys);
			}
		}, (error) => { });
		return observable;
	}
	addSurveys(surveys: Survey[]) {
		for(let survey of surveys) {
			this.addSurvey(survey);
		}
	}
	addSurvey(survey: Survey) {
		let surveys = this.getSurveysByLocation(survey.symbol);
		if (surveys == null) {
			surveys = [];
		}
		surveys.push(survey);
	}
	
	siphonGas(shipSymbol: string): Observable<{data: {cooldown: Cooldown, siphon: Extraction, cargo: ShipCargo}}> {
		let url = `${this.apiUrlMyShips}/${shipSymbol}/siphon`;
		let body = {};
		const headers = this.accountService.getHeader();
		const observable = this.http.post<{data: {cooldown: Cooldown, siphon: Extraction, cargo: ShipCargo}}>
		(url, body, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			const ship = this.getShipBySymbol(shipSymbol);
			if (ship) {
				ship.cooldown = response.data.cooldown;
				ship.cargo = response.data.cargo;
			}
		}, (error) => {});
		return observable;
	}
	extractResources(shipSymbol: string): Observable<{data: {cooldown: Cooldown, extraction: Extraction, cargo: ShipCargo}}> {
		let url = `${this.apiUrlMyShips}/${shipSymbol}/extract`;
		let body = {};
		const headers = this.accountService.getHeader();
		const observable = this.http.post<{data: {cooldown: Cooldown, extraction: Extraction, cargo: ShipCargo}}>
		(url, body, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			const ship = this.getShipBySymbol(shipSymbol);
			if (ship) {
				ship.cooldown = response.data.cooldown;
				ship.cargo = response.data.cargo;
			}
		}, (error) => {});
		return observable;
	}
	extractResourcesWithSurvey(shipSymbol: string, survey: Survey): Observable<{data: {cooldown: Cooldown, extraction: Extraction, cargo: ShipCargo}}> {
		let url = `${this.apiUrlMyShips}/${shipSymbol}/extract/survey`;
		let body = survey;
		const headers = this.accountService.getHeader();
		const observable = this.http.post<{data: {cooldown: Cooldown, extraction: Extraction, cargo: ShipCargo}}>
		(url, body, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			const ship = this.getShipBySymbol(shipSymbol);
			if (ship) {
				ship.cooldown = response.data.cooldown;
				ship.cargo = response.data.cargo;
			}
		}, (error) => {
			while (error.error) {
				error = error.error;
			}
			if (error.code === 4224) {
				// Resources have been exhuasted, remove this survey
				this.surveyService.deleteSurvey(survey);
			}
		});
		return observable;
	}
	
	listShips() {
	}

	jumpShip(shipSymbol: string, waypointSymbol: string): Observable<{ data: {cooldown: Cooldown; nav: ShipNav, transaction: JumpTransaction }}> {
		const headers = this.accountService.getHeader();
		const body = { waypointSymbol};
		const observable = this.http.post<{ data: {cooldown: Cooldown; nav: ShipNav, transaction: JumpTransaction  }}>
			(`${this.apiUrlMyShips}/${shipSymbol}/jump`,
				body, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			const ship = this.getShipBySymbol(shipSymbol);
			if (ship) {
				ship.cooldown = response.data.cooldown;
				ship.nav = response.data.nav;
				this.setShipLocation(ship, ship.nav.systemSymbol, response.data.nav.route.destination)
			}
		}, (error) => {});
		return observable;
	}

	navigateShip(shipSymbol: string, waypointSymbol: string): Observable<{ data: {fuel: ShipFuel; nav: ShipNav }}> {
		const headers = this.accountService.getHeader();
		const body = {
			waypointSymbol: waypointSymbol
		}
		const observable = this.http.post<{ data: {fuel: ShipFuel; nav: ShipNav }}>
			(`${this.apiUrlMyShips}/${shipSymbol}/navigate`,
				body, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			const ship = this.getShipBySymbol(shipSymbol);
			if (ship) {
				ship.fuel.update(response.data.fuel);
				ship.nav = response.data.nav;
				let withinSystem: System | undefined | null = null;
				if (ship.nav.route.origin.systemSymbol == ship.nav.route.destination.systemSymbol) {
					withinSystem = this.galaxyService.getSystemBySymbol(ship.nav.route.destination.systemSymbol);
				}
				this.eventQueueService.trackMovement(ship, withinSystem, (system: string, shipLoc: LocXY) => {
					this.setShipLocation(ship, system, shipLoc);
				}, (ship: Ship, shipLoc: LocXY) => {
				});
			}
		}, (error) => {});
		return observable;
	}

	GetShipNav() {

	}

	warpShip(shipSymbol: string, waypointSymbol: string): Observable<{ data: {fuel: ShipFuel; nav: ShipNav }}> {
		const headers = this.accountService.getHeader();
		const body = {
			waypointSymbol: waypointSymbol
		}
		const observable = this.http.post<{ data: {fuel: ShipFuel; nav: ShipNav }}>
			(`${this.apiUrlMyShips}/${shipSymbol}/warp`,
				body, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			const ship = this.getShipBySymbol(shipSymbol);
			if (ship) {
				ship.fuel.update(response.data.fuel);
				ship.nav = response.data.nav;
			}
		}, (error) => {});
		return observable;
	}

	scanSystems(shipSymbol: string): Observable<{ data: {cooldown: Cooldown; systems: System[] }}> {
		const headers = this.accountService.getHeader();
		const observable = this.http.post<{ data: {cooldown: Cooldown; systems: System[] }}>
			(`${this.apiUrlMyShips}/${shipSymbol}/scan/systems`,
				{}, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			const ship = this.getShipBySymbol(shipSymbol);
			if (ship) {
				ship.cooldown = response.data.cooldown;
			}
			this.galaxyService.addScannedSystems(response.data.systems);
		}, (error) => {});
		return observable;
	}

	
	scanWaypoints(shipSymbol: string): Observable<{ data: {cooldown: Cooldown; waypoints: Waypoint[] }}> {
		const headers = this.accountService.getHeader();
		const observable = this.http.post<{ data: {cooldown: Cooldown; waypoints: Waypoint[] }}>
			(`${this.apiUrlMyShips}/${shipSymbol}/scan/waypoints`,
				{}, { headers });
		return observable;
	}

	scanShips(shipSymbol: string): Observable<{ cooldown: Cooldown; ships: ScannedShip[] }> {
		const headers = this.accountService.getHeader();
		const observable = this.http.post<{ cooldown: Cooldown; ships: ScannedShip[] }>
			(`${this.apiUrlMyShips}/${shipSymbol}/scan/ships`,
				{}, { headers });
		return observable;
	}
	
	jettisonCargo(shipSymbol: string, itemSymbol: string, itemQty: number): Observable<{ data: {cargo: ShipCargo }}> {
		const headers = this.accountService.getHeader();
		const body = {
  			symbol: itemSymbol,
  			units: itemQty
		}
		const observable = this.http.post<{ data: {cargo: ShipCargo}}>
			(`${this.apiUrlMyShips}/${shipSymbol}/jettison`,
				body, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			this.updateShipCargo(shipSymbol, response.data.cargo);
		}, (error) => {});
    	return observable;
	}
	
	transferCargo(fromShipSymbol: string, toShipSymbol: string, itemSymbol: string, itemQty: number): Observable<{ data: {cargo: ShipCargo }}> {
		const headers = this.accountService.getHeader();
		const body = {
  			shipSymbol: toShipSymbol,
  			tradeSymbol: itemSymbol,
  			units: itemQty
		}
		const observable = this.http.post<{ data: {cargo: ShipCargo}}>
			(`${this.apiUrlMyShips}/${fromShipSymbol}/transfer`,
				body, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			const fromShip = this.getShipBySymbol(fromShipSymbol);
			let fromCargoItem = null;
			if (fromShip) {
				for (let inv of fromShip.cargo.inventory) {
					if (inv.symbol == itemSymbol) {
						fromCargoItem = inv;
					}
				}
				fromShip.cargo = response.data.cargo;
			}
			const toShip = this.getShipBySymbol(toShipSymbol);
			if (toShip) {
				let found = false;
				for (let inv of toShip.cargo.inventory) {
					if (inv.symbol == itemSymbol) {
						inv.units += itemQty;
						found = true;
					}
				}
				if (!found) {
					let newCargo: ShipCargoItem = {
						symbol: itemSymbol,
						name: fromCargoItem?.name || '',
						description: fromCargoItem?.description || '',
						units: itemQty
					};
					toShip.cargo.inventory.push(newCargo);
				}
				toShip.cargo.units += itemQty;
			}
		}, (error) => {});
    	return observable;
	}
	
	getMounts() {

	}
	installMount(shipSymbol: string, mountSymbol: string): Observable<{ data: {agent: Agent, mounts: ShipMount[], cargo: ShipCargo, transaction: ShipyardTransaction}}> {
		const body = {
			symbol: mountSymbol
		}
		const headers = this.accountService.getHeader();
		const observable = this.http.post<{ data: {agent: Agent, mounts: ShipMount[], cargo: ShipCargo, transaction: ShipyardTransaction}}>
			(`${this.apiUrlMyShips}/${shipSymbol}/mounts/install`,
				body, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			const ship = this.getShipBySymbol(shipSymbol);
			if (ship) {
				// Update the ship in our list of ships from the response
				ship.cargo = response.data.cargo;
				ship.mounts = response.data.mounts;
			}
		}, (error) => {});
		return observable;
	}
	removeMount(shipSymbol: string, mountSymbol: string): Observable<{ data: {agent: Agent, mounts: ShipMount[], cargo: ShipCargo, transaction: ShipyardTransaction}}> {
		const body = {
			symbol: mountSymbol
		}
		const headers = this.accountService.getHeader();
		const observable = this.http.post<{ data: {agent: Agent, mounts: ShipMount[], cargo: ShipCargo, transaction: ShipyardTransaction}}>
			(`${this.apiUrlMyShips}/${shipSymbol}/mounts/remove`,
				body, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			const ship = this.getShipBySymbol(shipSymbol);
			if (ship) {
				// Update the ship in our list of ships from the response
				ship.cargo = response.data.cargo;
				ship.mounts = response.data.mounts;
			}
		}, (error) => {});
		return observable;
	}
	setFlightMode(shipSymbol: string, flightMode: string): Observable<{ data: ShipNav}>{
		const headers = this.accountService.getHeader();
		const body = {
			flightMode: flightMode
		}
		const observable = this.http.patch<{ data: ShipNav}>
			(`${this.apiUrlMyShips}/${shipSymbol}/nav`,
				body, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			const ship = this.getShipBySymbol(shipSymbol);
			if (ship) {
				ship.nav = response.data;
			}
		}, (error) => {});
		return observable;
	}
}