import { Injectable } from '@angular/core';
import { Agent } from 'src/models/Agent';
import { JumpGate } from 'src/models/JumpGate';
import { LocXY } from 'src/models/LocXY';
import { Ship } from 'src/models/Ship';
import { System } from 'src/models/System';
import { WaypointBase } from 'src/models/WaypointBase';
import { AccountService } from './account.service';
import { GalaxyService } from './galaxy.service';
import { JumpgateService } from './jumpgate.service';
import { MarketService } from './market.service';
import { ShipyardService } from './shipyard.service';

@Injectable({
	providedIn: 'root'
})
export class ExplorationService {

	shipSymbolExploringBySystemSymbol: Map<string, string> = new Map();
	explorationPathByShipSymbol: Map<string, string[]> = new Map();
	headquarters: System | null = null;
	constructor(public marketService: MarketService,
		public shipyardService: ShipyardService,
		public galaxyService: GalaxyService,
		public accountService: AccountService,
		public jumpgateService: JumpgateService) {
		this.accountService.agent$.subscribe((agent) => {
			if (agent) {
				this.headquarters = this.galaxyService.getSystemBySymbol(agent.headquarters);
			}
		});
	}

	getWaypointsNeedingToBeExplored(system: System): WaypointBase[] {
		if (!system.waypoints) {
			return [];
		}
		return system.waypoints.filter((waypoint) => {
				return WaypointBase.hasUncharted(waypoint) ||
				       this.waypointNeedsToBeExplored(waypoint);
		});
	}

	waypointNeedsToBeExplored(waypoint: WaypointBase): boolean {
		if (WaypointBase.hasMarketplace(waypoint) &&
				this.marketService.getCachedMarketplace(waypoint.symbol, false) == null) {
			return true;
		}		
		if (WaypointBase.hasShipyard(waypoint) &&
				this.shipyardService.getCachedShipyard(waypoint.symbol, false) == null) {
			return true;
		}
		if (WaypointBase.isJumpGate(waypoint) &&
				this.jumpgateService.getJumpgateBySymbol(waypoint.symbol) == null) {
			return true;
		}
		return false;
	}

	getPathBetween(start: WaypointBase | null, end: WaypointBase | null): string[] {
		if (start && end) {
			const startSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(start.symbol);
			const endSymbol = GalaxyService.getSystemSymbolFromWaypointSymbol(end.symbol);
			return this.jumpgateService.findShortestPath(startSymbol, endSymbol) || [];
		}
		return [];
	}
	
	/* This method returns the symbol of the next SYSTEM (not waypoint) that this ship should explore
	*/
	exploreSystems(ship: Ship): string | null {
		if (ship.cooldown.remainingSeconds > 0) {
			return null;
		}
		// If we already have a plan for this ship, use it:
		let explorationPath = this.explorationPathByShipSymbol.get(ship.symbol);
		while (explorationPath != null && explorationPath.length > 0) {
			// If they haven't reached the first destination, tell them to go there:
			if (ship.nav.systemSymbol != explorationPath[0]) {
				return explorationPath[0];
			}
			// If they have reached the destination, remove that destination from the destination list:
			explorationPath.shift();
			// go back to the top of the while loop, and we should either return the next destination, exit this loop
		}

		const shipsCurrentSystem = this.galaxyService.getSystemBySymbol(ship.nav.systemSymbol);
		if (!shipsCurrentSystem || !this.headquarters) {
			return null;
		}
		if (this.getWaypointsNeedingToBeExplored(shipsCurrentSystem).length > 0) {
			return shipsCurrentSystem.symbol;
		}
		const jumpgateWaypoint: WaypointBase | undefined = (shipsCurrentSystem?.waypoints || [])
			.find((waypoint) => waypoint.type === "JUMP_GATE");
		if (!jumpgateWaypoint) {
			return null;
		}
		const results = this.exploreSystemsFrom(ship, this.headquarters);
		if (results) {
			return results;
		}
		// If we can't explore from our headquarters, just explore from whereever we are
		return this.exploreSystemsFrom(ship, shipsCurrentSystem);
	}
	exploreSystemsFrom(ship: Ship, startSys: System): string | null {

		// Get the set of waypoints that are the closest to our headquarters.
		// This will be all jumpgate that are within N hops from the headquarters, that need to be visited,
		// that don't currently have a ship in-route to. 
		const jumpgateSymbols: Set<string> = this.jumpgateService.getClosestJumpGateSymbols(startSys,
		                                                                               (jumpgateSystemSymbol: string) => {
			const jumpSys = this.galaxyService.getSystemBySymbol(jumpgateSystemSymbol);
			return (jumpSys && 
			        !this.shipSymbolExploringBySystemSymbol.has(jumpSys.symbol) &&
			        this.getWaypointsNeedingToBeExplored(jumpSys).length > 0
			        ) || false;
		});
		
		// Now find one of these jumpgates that we can get to the quickest
		if (jumpgateSymbols.size > 0) {
			const start: WaypointBase = ship.nav.route.destination;
			let shortestPathLength: number = Infinity;
			let shortestPath: string[] = [];
			for (let jumpgateSymbol of jumpgateSymbols) {
				const gateWaypoint = this.galaxyService.getWaypointByWaypointSymbol(jumpgateSymbol);
				const path: string[] = this.getPathBetween(start, gateWaypoint);
				if (path.length > 0) {
					if (path.length < shortestPathLength) {
						shortestPathLength = path.length;
						shortestPath = path; 
					}
				}
			}
			if (shortestPath.length > 1) {
				this.explorationPathByShipSymbol.set(ship.symbol, shortestPath);
				this.shipSymbolExploringBySystemSymbol.set(shortestPath[shortestPath.length-1], ship.symbol);
				// the first element is the source system, which is where this ship should already be,
				// so we return the second system symbol
				return shortestPath[1];
			}
		}
		return null;
	}

	public static organizeRoute(waypoints: WaypointBase[], destination: LocXY): WaypointBase | null {
		// for now, just go to the nearest uncharted waypoint:
		waypoints.sort((w1, w2) => {
			const d1 = LocXY.getDistanceSquared(destination, w1);
			const d2 = LocXY.getDistanceSquared(destination, w2);
			if (d1 < d2) return -1;
			if (d1 > d2) return 1;
			return 0;
		});
		const locs = [];
		for (let waypoint of waypoints) {
			locs.push(new LocXY(waypoint.x, waypoint.y));
		}
		const uniqueLocs = new Set(locs.filter(
			(value, index, self) => self.findIndex((v) => v.x === value.x && v.y === value.y) === index
		));

		const route = LocXY.findShortestPath(destination, uniqueLocs);
		if (route.length) {
			const loc = route[1];
			for (let waypoint of waypoints) {
				if (loc.x == waypoint.x && loc.y == waypoint.y) {
					return waypoint;
				}
			}
		}
		return null;
	}

}
