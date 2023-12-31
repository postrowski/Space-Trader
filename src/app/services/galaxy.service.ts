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
	pageSize = 20;
	
	private activeSystemSubject = new BehaviorSubject<System | null>(null);
	activeSystem$: Observable<System | null> = this.activeSystemSubject.asObservable();

	private activeSystemWaypointSubject = new BehaviorSubject<WaypointBase | null>(null);
	activeSystemWaypoint$: Observable<WaypointBase | null> = this.activeSystemWaypointSubject.asObservable();

	private allSystems: System[] = [];
	public showGalaxy = false;
	agent: Agent | null = null;
	homeSystem: System | null = null;
	loadingInProgress = false;
	waypointPagesLoadedBySystemSymbol = new Map<string, Waypoint[]>();
	
	constructor(private http: HttpClient,
				public accountService: AccountService,
	            public dbService: DBService) {
	    // Wait for the database to be initialized
	    this.dbService.initDatabase().then(() => {
	        liveQuery(() => this.dbService.systems.toArray()).subscribe((response) => {
	            this.allSystems = response;
	            this.setHomeSystem();
	            for (const system of this.allSystems) {
					const syms = system.symbol.split('-');
					if (syms.length == 3) {
						this.dbService.deleteSystem(system);
						system.symbol = syms[0] + '-' + syms[1];
						this.dbService.createSystem(system);
					}
				}
	        });
	    });
		    
		this.accountService.agent$.subscribe((agent) => {
			if (this.agent == null) {
				this.agent = agent;
				this.setHomeSystem();
			}
		});
	}
	
	onServerReset() {
		this.activeSystemSubject.next(null);
		this.activeSystemWaypointSubject.next(null);
		this.allSystems = [];
		this.agent = null;
		this.homeSystem = null;
		this.loadingInProgress = false;
		this.waypointPagesLoadedBySystemSymbol = new Map<string, Waypoint[]>();
	}

	async addNewSystemDB(system: System) {
		await this.dbService.createSystem(system);
	}
	
	setHomeSystem() {
		if (this.agent?.headquarters && !this.homeSystem) {
			this.homeSystem = this.getSystemBySymbol(this.agent?.headquarters);
			this.setActiveSystem(this.homeSystem);
		}
	}
	// Add a new System to the array and emit the updated array
	addSystem(newSystem: System) {
		for (let system of this.allSystems) {
			if (system.symbol === newSystem.symbol) {
				// Update the current system from the new system
				if (newSystem.waypoints && newSystem.waypoints.length) {
					system.waypoints = newSystem.waypoints;
				}
				system.x = newSystem.x;
				system.y = newSystem.y;
				system.type = newSystem.type;
				system.factions = newSystem.factions;
				system.sectorSymbol = newSystem.sectorSymbol;
				this.addNewSystemDB(system);
				return;
			}
		}
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
		this.dbService.systems.get(sysSymbol).then((sys) =>{
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
		return this.allSystems;
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
		systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemSymbol);
		const existingSystem = this.getSystemBySymbol(systemSymbol);
		if (existingSystem) {
			this.setActiveSystem(existingSystem);
			return;
		}
		this.getSystem(systemSymbol).subscribe((response) => {
			this.setActiveSystem(response);
		});
	}
	public static getSystemSymbolFromWaypointSymbol(systemWaypointSymbol: string) {
		const elements = systemWaypointSymbol.split('-');
		return elements[0]+'-'+elements[1];
	}
	setActiveSystemWaypointBySymbol(systemWaypointSymbol: string) {
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemWaypointSymbol);
		const system = this.getActiveSystem();
		if (system == null) {
			this.getSystem(systemSymbol).subscribe((response) => {
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
	getNextPageOfWaypoints() {
		if (this.loadingInProgress) {
			return;
		}
		if (this.waypointPagesLoadedBySystemSymbol.size == 0) {
			for (let system of this.allSystems) {
				if (!system.waypoints) {
					this.waypointPagesLoadedBySystemSymbol.set(system.symbol, []);
					break;
				}
			}			
		}
		for (const systemSymbol of this.waypointPagesLoadedBySystemSymbol.keys()) {
			const waypointsSoFar = this.waypointPagesLoadedBySystemSymbol.get(systemSymbol);
			if (waypointsSoFar) {
				if (this.loadingInProgress) {
					return;
				}
				this.loadingInProgress = true;
				const page = waypointsSoFar.length / this.pageSize;
				this.getWaypointsPage(systemSymbol, page+1).subscribe((response) => {
					const newWaypointsSoFar = waypointsSoFar.concat(response.data);
					if (response.meta.total == newWaypointsSoFar.length) {
						this.onWaypointLoadCompleted(systemSymbol, newWaypointsSoFar);
						this.waypointPagesLoadedBySystemSymbol.delete(systemSymbol);
					} else {
						this.waypointPagesLoadedBySystemSymbol.set(systemSymbol, newWaypointsSoFar);
					}
					this.loadingInProgress = false;
				},
				(error) => {
					this.loadingInProgress = false;
				});
				return;
			}
		}
	}
	
	completeIncompleteGalaxies(): boolean {
        for (const system of this.allSystems) {
			if (system.type == '?' || (system.x === 0 && system.y === 0)) {
				this.getSystem(system.symbol).subscribe(()=>{});
				return true;
			}
		}
		return false;
	}
	
	loadMoreGalaxies(): boolean {
		let galaxyCount = this.allSystems.length;
		if (galaxyCount < this.totalSystemsCount || this.totalSystemsCount == 0) {
			let pageCount = Math.floor(galaxyCount / this.pageSize);
			this.updateGalaxyPage(pageCount + 1); // ask for the next page
			return true;
		}
		return false;
	}
	totalSystemsCount = 0;
	updateGalaxyPage(page: number) {
		const headers = this.accountService.getHeader();
		const params = {limit: this.pageSize, page: page};
		this.http.get<{data: System[], meta: Meta}>(`${this.apiUrlSystems}`, {headers, params})
			.subscribe((response) => {
				for (let system of response.data) {
					this.addSystem(system);
				}
				this.totalSystemsCount = response.meta.total;
			});
	}

	ngOnInit() {
		this.selectFirstSystem();
	}
	selectFirstSystem() {
		// Set the activeSystem to the first system in the list
		if (this.allSystems.length > 0) {
			this.setActiveSystem(this.allSystems[0]);
		}
	}
		
	getSystem(systemSymbol:string) : Observable<System> {
		const headers = this.accountService.getHeader();
		const observable = this.http.get<System>(`${this.apiUrlSystems}/${systemSymbol}`, {headers})
       			// Extract 'data' as System
			 	.pipe(map((response: any) => response.data as System))
	      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response) => {
				this.addSystem(response);
			});
		return observable;
	}
	getAllWaypoints(systemSymbol: string): Observable<Waypoint[]> {
		systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemSymbol);
		const observable = this.getAllWaypoints2(systemSymbol, 1)
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			this.onWaypointLoadCompleted(systemSymbol, response);
		}, (error) => {});
		return observable;
	}
	
	onWaypointLoadCompleted(systemSymbol: string, waypoints: Waypoint[]) {
		this.dbService.updateSystemWaypoints(systemSymbol, waypoints);
		for (let system of this.allSystems) {
			if (system.symbol === systemSymbol) {
				system.waypoints = waypoints;
				break;
			}
		}
		
		// If we just updated the selected waypoint, we need to update our copy from the DB
		const activeWaypointSymbol = this.activeSystemWaypointSubject.value?.symbol;
		if (activeWaypointSymbol?.startsWith(systemSymbol)) {
			this.dbService.systems.get(systemSymbol).then((sys) =>{
				for (let waypoint of sys?.waypoints || []) {
					if (waypoint.symbol == activeWaypointSymbol) {
						this.activeSystemWaypointSubject.next(waypoint);
						break;
					}
				}
			});
		}
	}
	
	private getAllWaypoints2(systemSymbol: string, page: number): Observable<Waypoint[]> {
		return this.getWaypointsPage(systemSymbol, page)
				   .pipe(concatMap((response) => {
						if (response.meta.total > this.pageSize * page) {
							// If there are more pages, recursively load them
							return this.getAllWaypoints2(systemSymbol, page + 1)
							           .pipe(map((nextPageResults) => [...response.data, ...nextPageResults]));
						}
						// No more pages, just return the data from this page
						return of(response.data);
					})
			);
	}
	private getWaypointsPage(systemSymbol:string, page: number) : Observable<{data: Waypoint[], meta: Meta}> {
		systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemSymbol);
		const headers = this.accountService.getHeader();
		const params = {limit: this.pageSize, page: page};
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
