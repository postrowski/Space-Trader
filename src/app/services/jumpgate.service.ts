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

	dbJumpgates$ = liveQuery(() => this.dbService.jumpgates.toArray());
	private allJumpgatesSubject = new BehaviorSubject<JumpGate[] | null>(null);
	allJumpgates$: Observable<JumpGate[] | null> = this.allJumpgatesSubject.asObservable();

	constructor(private http: HttpClient,
				public galaxyService: GalaxyService,
				public dbService: DBService,
				public accountService: AccountService) {
		this.dbJumpgates$.subscribe((response) => {
			this.allJumpgatesSubject.next(response);
			for (let jumpgate of response) {
				this.recordJumpgate(jumpgate);
			}
		});
	}
	jumpgateByWaypointSymbol: Map<string, JumpGate> = new Map();
	jumpgatesBySystemSymbol: Map<string, JumpGate[]> = new Map();
	allConnectedSystemSymbols: Set<string> = new Set();

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
					jumpgatesInSystem = jumpgatesInSystem.splice(index, 1);
					this.jumpgatesBySystemSymbol.set(systemSymbol, jumpgatesInSystem);
					break;
				}
			}
		}
		jumpgatesInSystem.push(jumpgate);
		for (let connectedSys of jumpgate.connectedSystems) {
			this.allConnectedSystemSymbols.add(connectedSys.symbol);
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
				for (let connection of gate.connectedSystems) {
					let connectedGates: JumpGate[] | undefined = this.jumpgatesBySystemSymbol.get(connection.symbol);
					if (!connectedGates) { 
						const system = this.galaxyService.getSystemBySymbol(connection.symbol);
						if (system) {
							for (const way of system.waypoints || []) {
								if (WaypointBase.isJumpGate(way)) {
									if (filterCallback(way.symbol!)) {
										validGateSystemSymbols.add(way.symbol!);
									}
								}
							}
						}
					} else {
						for (let connectedGate of connectedGates) {
							if (connectedGate.symbol) {
								if (filterCallback(connectedGate.symbol)) {
									validGateSystemSymbols.add(connectedGate.symbol);
								} else {
									nextGates.push(connectedGate);
								}
							}
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
				for (const connectedSystem of jumpgate?.connectedSystems || []) {
					if (!visited.has(connectedSystem.symbol)) {
						visited.add(connectedSystem.symbol);
						// Add linked objects to the queue with the updated path
						queue.push({
							symbol: connectedSystem.symbol,
							path: [...path, connectedSystem.symbol]
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
			for (let connectedSystem of jumpgate.connectedSystems) {
				const system        = new System(connectedSystem.x, connectedSystem.y);
				system.symbol       = connectedSystem.symbol;
				system.sectorSymbol = connectedSystem.sectorSymbol;
				system.type         = connectedSystem.type;
				system.waypoints    = null;
				system.factions     = [{symbol : connectedSystem.factionSymbol}];
				this.galaxyService.addSystem(system);
			}
			this.recordJumpgate(jumpgate);
			this.dbService.addJumpgate(jumpgate, systemWaypointSymbol);
		}, (error) => {});
		return observable;
	}

}
