import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { liveQuery } from 'dexie';
import { BehaviorSubject, map, Observable, of, shareReplay } from 'rxjs';
import { JumpGate } from 'src/models/JumpGate';
import { System } from 'src/models/System';
import { WaypointBase } from 'src/models/WaypointBase';
import { AccountService } from './account.service';
import { DBService } from './db.service';
import { GalaxyService } from './galaxy.service';

@Injectable({
	providedIn: 'root'
})
export class JumpgateService {
	public apiUrlSystems = 'https://api.spacetraders.io/v2/systems';

	private allJumpgatesSubject = new BehaviorSubject<JumpGate[] | null>(null);
	allJumpgates$: Observable<JumpGate[] | null> = this.allJumpgatesSubject.asObservable();
	jumpgateByWaypointSymbol = new Map<string, JumpGate>();
	jumpgatesBySystemSymbol = new Map<string, JumpGate[]>();
	allConnectedWaypointSymbols = new Set<string>();

	constructor(private http: HttpClient,
				public galaxyService: GalaxyService,
				public dbService: DBService,
				public accountService: AccountService) {
	    this.dbService.initDatabase().then(() => {
			liveQuery(() => this.dbService.jumpgates.toArray()).subscribe((response) => {
				this.allJumpgatesSubject.next(response);
				for (let jumpgate of response) {
					this.recordJumpgate(jumpgate);
				}
			});
		});
	}
	
	onServerReset() {
		this.allJumpgatesSubject.next(null);
		this.jumpgateByWaypointSymbol = new Map<string, JumpGate>();
		this.jumpgatesBySystemSymbol = new Map<string, JumpGate[]>();
		this.allConnectedWaypointSymbols = new Set<string>();
	}

	recordJumpgate(jumpgate: JumpGate) {
		const systemWaypointSymbol = jumpgate.symbol || '';
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemWaypointSymbol);
		this.jumpgateByWaypointSymbol.set(systemWaypointSymbol, jumpgate);
		let jumpgatesInSystem = this.jumpgatesBySystemSymbol.get(systemSymbol);
		if (!jumpgatesInSystem) {
			jumpgatesInSystem = [];
			this.jumpgatesBySystemSymbol.set(systemSymbol, jumpgatesInSystem);
		} else {
			// If the jumpgate already exists in our array, remove it from the array,
			// and then either way insert the new value
			for (let existingJumpgate of jumpgatesInSystem) {
				if (existingJumpgate.symbol == jumpgate.symbol) {
					const index = jumpgatesInSystem.indexOf(existingJumpgate);
					jumpgatesInSystem.splice(index, 1);
					this.jumpgatesBySystemSymbol.set(systemSymbol, jumpgatesInSystem);
					break;
				}
			}
		}
		jumpgatesInSystem.push(jumpgate);
		for (let waypointSymbol of jumpgate.connections) {
			this.allConnectedWaypointSymbols.add(waypointSymbol);
		}
	}

	getClosestJumpGateSymbols(startSys: System, filterCallback: (jumpgateSystemSymbol: string) => boolean): Set<string> {
		let currentGates: JumpGate[] | undefined = this.jumpgatesBySystemSymbol.get(startSys.symbol);
		const checkedGated = new Set<string>();
		const validGateSystemSymbols = new Set<string>();
		while (currentGates && currentGates.length > 0) {
			const nextGates: JumpGate[]  = [];
			for (let gate of currentGates) {
				if (checkedGated.has(gate.symbol!)) {
					continue;
				}
				for (let waypointSymbols of gate.connections) {
					let connectedGate: JumpGate | undefined = this.jumpgateByWaypointSymbol.get(waypointSymbols);
					if (!connectedGate) { 
						const waypoint = this.galaxyService.getWaypointByWaypointSymbol(waypointSymbols);
						if (waypoint) {
							if (filterCallback(waypoint.symbol)) {
								validGateSystemSymbols.add(waypoint.symbol!);
							}
						}
					} else if (connectedGate.symbol) {
						if (filterCallback(connectedGate.symbol)) {
							validGateSystemSymbols.add(connectedGate.symbol);
						} else {
							nextGates.push(connectedGate);
						}
					}
				}
				checkedGated.add(gate.symbol!);
			}
			if (validGateSystemSymbols.size > 0) {
				return validGateSystemSymbols;
			}
			currentGates = nextGates;
		}
	    return new Set();
	}

	findShortestPath(startSystemSymbol: string, endSystemSymbol: string): string[] | null {
		const visited = new Set<string>();
		const queue: {
			symbol: string;
			path: string[]
		}[] = [];

		// Initialize the queue with the starting object
		queue.push({
			symbol: startSystemSymbol,
			path: [startSystemSymbol]
		});
		visited.add(startSystemSymbol);

		while (queue.length > 0) {
			const { symbol, path } = queue.shift()!;

			// Check if the current object is the destination
			if (symbol === endSystemSymbol) {
				return path; // Found the shortest path
			}

			// Find the object in the jumpgates
			const jumpgates = this.jumpgatesBySystemSymbol.get(symbol);
			for (const jumpgate of jumpgates || []) {
				for (const jumpgateSymbol of jumpgate?.connections || []) {
					if (!visited.has(jumpgateSymbol)) {
						visited.add(jumpgateSymbol);
						// Add linked objects to the queue with the updated path
						queue.push({
							symbol: jumpgateSymbol,
							path: [...path, jumpgateSymbol]
						});
					}
				}
			}
		}
		// No path is found
		return null;
	}

	getJumpgateBySymbol(waypointSymbol: string): JumpGate | undefined {
		return this.jumpgateByWaypointSymbol.get(waypointSymbol);
	}
	getJumpgatesBySystemSymbol(systemSymbol: string): JumpGate[] | undefined {
		return this.jumpgatesBySystemSymbol.get(systemSymbol);
	}
	
	getJumpgate(systemWaypointSymbol: string, shipsAtWaypoint: boolean): Observable<JumpGate> {
		const jumpGate = this.jumpgateByWaypointSymbol.get(systemWaypointSymbol);
		if (jumpGate) {
			// If the jump gate is already cached, return it as an observable
    		return of(jumpGate);
		}
		if (!shipsAtWaypoint) {
			return of();
		}
		const headers = this.accountService.getHeader();
		const systemSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(systemWaypointSymbol);
		const observable = this.http.get<{ data: JumpGate }>
			(`${this.apiUrlSystems}/${systemSymbol}/waypoints/${systemWaypointSymbol}/jump-gate`, { headers })
			.pipe(map((response: any) => {
				response.data.symbol = systemWaypointSymbol;
				return response.data as JumpGate
				})) // Extract 'data' as JumpGate
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((jumpgate)=> {
			this.jumpgateByWaypointSymbol.set(systemWaypointSymbol, jumpgate);
			for (let jumpgateSymbol of jumpgate.connections) {
				const system        = new System(0, 0);
				system.symbol       = jumpgateSymbol;
				system.sectorSymbol = '?';
				system.type         = '?';
				system.waypoints    = null;
				system.factions     = [{symbol : '?'}];
				this.galaxyService.addSystem(system);
			}
			this.recordJumpgate(jumpgate);
			this.dbService.addJumpgate(jumpgate, systemWaypointSymbol);
		}, (error) => {});
		return observable;
	}

}
