import { HttpClient } from '@angular/common/http';
import { Injectable, OnInit } from '@angular/core';
import { BehaviorSubject, concatMap, map, Observable, of, shareReplay } from 'rxjs';
import { Meta } from 'src/models/Meta';
import { System } from 'src/models/System';
import { Waypoint } from 'src/models/Waypoint';
import { WaypointBase } from 'src/models/WaypointBase';
import { AccountService } from './account.service';
import { DBService } from './db.service';
import { liveQuery } from 'dexie';
import { Agent } from 'src/models/Agent';

@Injectable({
  providedIn: 'root'
})
export class GalaxyService {
    public apiUrlSystems = 'https://api.spacetraders.io/v2/systems';

	dbSystem$ = liveQuery(() => this.db.systems.toArray());
	async addNewSystemDB(system: System) {
		await this.db.createSystem(system);
	}
	
	private allSystemsSubject = new BehaviorSubject<System[]>([]);
	allSystems$: Observable<System[]> = this.allSystemsSubject.asObservable();

	private activeSystemSubject = new BehaviorSubject<System | null>(null);
	activeSystem$: Observable<System | null> = this.activeSystemSubject.asObservable();

	private activeSystemWaypointSubject = new BehaviorSubject<WaypointBase | null>(null);
	activeSystemWaypoint$: Observable<WaypointBase | null> = this.activeSystemWaypointSubject.asObservable();

	public showGalaxy = false;
	agent: Agent | null = null;
	homeSystem: System | null = null;
	
	constructor(private http: HttpClient,
				public accountService: AccountService,
	            public db: DBService) {
		this.dbSystem$.subscribe((response) => {
			this.allSystemsSubject.next(response);
			this.setHomeSystem();
		});
		this.accountService.agent$.subscribe((agent) => {
			if (this.agent == null) {
				this.agent = agent;
				this.setHomeSystem();
			}
		});
	}
	setHomeSystem() {
		if (this.agent?.headquarters && !this.homeSystem) {
			this.homeSystem = this.getSystemBySymbol(this.agent?.headquarters);
			this.setActiveSystem(this.homeSystem);
		}
	}
	// Add a new System to the array and emit the updated array
	addSystem(newSystem: System) {
		const currentSystems = this.allSystemsSubject.value; // Get the current array
		for (let system of currentSystems) {
			if (system.symbol === newSystem.symbol) {
				if (newSystem.waypoints && newSystem.waypoints.length) {
					system.waypoints = newSystem.waypoints;
				}
				// TODO: Update the current system from the new system?
				return;
			}
		}
		currentSystems.push(newSystem); // Add the new System
		this.allSystemsSubject.next(currentSystems); // Emit the updated array
		this.addNewSystemDB(newSystem);
	}
	addScannedSystems(systems: System[]) {
		for (let system of systems) {
			this.addSystem(system);
		}
	}

	setActiveSystem(system: System | null) {
		this.activeSystemSubject.next(system);
	}
	getActiveSystem(): System | null {
		return this.activeSystemSubject.value;
	}
	setActiveSystemWaypoint(systemWaypoint: WaypointBase) {
		const sysSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemWaypoint.symbol);
		this.db.systems.get(sysSymbol).then((sys) =>{
			for (let waypoint of sys?.waypoints || []) {
				if (waypoint.symbol == systemWaypoint.symbol) {
					this.activeSystemWaypointSubject.next(waypoint);
					break;
				}
			}
		});
		//this.activeSystemWaypointSubject.next(systemWaypoint);
	}
	getActiveSystemWaypoint(): WaypointBase | null {
		return this.activeSystemWaypointSubject.value;
	}
	getAllSystems(): System[] {
		return this.allSystemsSubject.value;
	}
	getWaypointByWaypointSymbol(waypointSymbol: string) : WaypointBase | null {
		const system = this.getSystemBySymbol(waypointSymbol);
		return system?.waypoints?.find((waypoint) => waypoint.symbol === waypointSymbol) || null;
	}
	getSystemBySymbol(systemSymbol: string): System | null{
		systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemSymbol);
		for (let system of this.getAllSystems()) {
			if (system.symbol === systemSymbol) {
				return system;
			}
		}
		return null;
	}
	
	setActiveSystemBySymbol(systemSymbol: string) {
		const existingSystem = this.getSystemBySymbol(systemSymbol);
		if (existingSystem) {
			this.setActiveSystem(existingSystem);
			return;
		}
		this.getSystem(systemSymbol)
			.subscribe((response) => {
				this.addSystem(response);
				this.setActiveSystem(response);
			});
	}
	public static getSystemSymbolFromWaypointSymbol(systemWaypointSymbol: string) {
		const elements = systemWaypointSymbol.split('-');
		return elements[0]+'-'+elements[1];
	}
	setActiveSystemWaypointBySymbol(systemWaypointSymbol: string) {
		console.log(`GalaxyService/setActiveSystemWaypointBySymbol(${systemWaypointSymbol})`);
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemWaypointSymbol);
		const system = this.getActiveSystem();
		if (system == null) {
			this.getSystem(systemSymbol).subscribe((response) => {
				this.addSystem(response);
				this.setActiveSystem(response);
				this.setActiveSystemWaypointBySymbol(systemWaypointSymbol);
			});
			console.warn(`GalaxyService/setActiveSystemWaypointBySymbol(${systemWaypointSymbol}), no active system`);
			return;
		}
		if (system?.symbol !== systemSymbol) {
			this.setActiveSystemBySymbol(systemSymbol);
		}
		for (let waypoint of system.waypoints || []) {
			if (waypoint.symbol === systemWaypointSymbol) {
				this.setActiveSystemWaypoint(waypoint);
				return;
			}
		}
	}
	loadingInProgress = false;
	getMoreGalaxyDetails(): boolean {
		if (this.loadingInProgress) {
			return true;
		}
		this.loadingInProgress = true;
		const currentSystems = this.allSystemsSubject.value; // Get the current array
		for (let system of currentSystems) {
			if (!system.waypoints) {
				this.getAllWaypoints(system.symbol).subscribe((response) => {
					this.loadingInProgress = false;
				}, (error) => {
					this.loadingInProgress = false;
				});
				return true;
			}
		}
		return false;
	}
	
	loadMoreGalaxies(): boolean {
		let galaxyCount = this.allSystemsSubject.value.length;
		if (galaxyCount < this.totalSystemsCount || this.totalSystemsCount == 0) {
			let pageCount = Math.floor(galaxyCount / 20);
			this.updateGalaxy(20, pageCount + 1); // ask for the next page
			return true;
		}
		return false;
	}
	totalSystemsCount = 0;
	updateGalaxy(limit: number, page: number) {
		this.getSystems(limit, page)
			.subscribe((response) => {
				for (let system of response.data) {
					this.addSystem(system);
				}
				this.totalSystemsCount = response.meta.total;
//				let activeSystem = this.getActiveSystem();
//				if (activeSystem == null || this.getAllSystems().indexOf(activeSystem) == -1) {
//					this.selectFirstSystem();
//				}
			});
	}

	ngOnInit() {
		this.selectFirstSystem();
	}
	selectFirstSystem() {
		// Set the activeSystem to the first system in the list
		if (this.allSystemsSubject.value.length > 0) {
			this.setActiveSystem(this.allSystemsSubject.value[0]);
		}
	}
		
	getSystems(limit: number, page: number) : Observable<{data: System[], meta: Meta}> {
		const headers = this.accountService.getHeader();
		const params = {limit: limit, page: page};
		return this.http.get<{data: System[], meta: Meta}>(`${this.apiUrlSystems}`, {headers, params})
	}
	getSystem(systemSymbol:string) : Observable<System> {
		const headers = this.accountService.getHeader();
		return this.http.get<System>(`${this.apiUrlSystems}/${systemSymbol}`, {headers})
		      .pipe(map((response: any) => response.data as System)); // Extract 'data' as System
	}
	getAllWaypoints(systemSymbol: string): Observable<Waypoint[]> {
		systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemSymbol);
		const observable = this.getAllWaypoints2(systemSymbol, 20, 1)
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			this.db.updateSystemWaypoints(systemSymbol, response);
			const currentSystems = this.allSystemsSubject.value; // Get the current array
			for (let system of currentSystems) {
				if (system.symbol === systemSymbol) {
					system.waypoints = response;
					break;
				}
			}
			this.allSystemsSubject.next(currentSystems);
			
			// If we just updated the selected waypoint, we need to update our copy from the DB
			const activeWaypointSymbol = this.activeSystemWaypointSubject.value?.symbol;
			if (activeWaypointSymbol?.startsWith(systemSymbol)) {
				this.db.systems.get(systemSymbol).then((sys) =>{
					for (let waypoint of sys?.waypoints || []) {
						if (waypoint.symbol == activeWaypointSymbol) {
							this.activeSystemWaypointSubject.next(waypoint);
							break;
						}
					}
				});
			}
		}, (error) => {});
		return observable;
	}

	private getAllWaypoints2(systemSymbol: string, limit: number, page: number): Observable<Waypoint[]> {
		return this.getWaypoints(systemSymbol, limit, page)
				   .pipe(concatMap((response) => {
						if (response.meta.total > limit * page) {
							// If there are more pages, recursively load them
							return this.getAllWaypoints2(systemSymbol, limit, page + 1)
							           .pipe(map((nextPageResults) => [...response.data, ...nextPageResults]));
						}
						// No more pages, just return the data from this page
						return of(response.data);
					})
			);
	}
	private getWaypoints(systemSymbol:string, limit: number, page: number) : Observable<{data: Waypoint[], meta: Meta}> {
		systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemSymbol);
		console.log(`galaxyService.getWaypoints(${systemSymbol}) @${this.apiUrlSystems}/${systemSymbol}/waypoints`);
		const headers = this.accountService.getHeader();
		const params = {limit: limit, page: page};
		const observable = this.http.get<{data: Waypoint[], meta: Meta}>
		                    (`${this.apiUrlSystems}/${systemSymbol}/waypoints`, {headers, params});
		return observable;
	}
	getWaypoint(systemSymbol:string, waypointSymbol:string) : Observable<Waypoint> {
		const headers = this.accountService.getHeader();
		return this.http.get<Waypoint>
		                    (`${this.apiUrlSystems}/${systemSymbol}/waypoints/${waypointSymbol}`, {headers})
	}
}
