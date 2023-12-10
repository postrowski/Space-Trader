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

	shipSymbolExploringBySystemSymbol= new Map<string, string>();
	explorationPathByShipSymbol = new Map<string, string[]>();
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
	onServerReset() {
		this.shipSymbolExploringBySystemSymbol = new Map<string, string>();
		this.explorationPathByShipSymbol = new Map<string, string[]>();
		this.headquarters = null;
	}

	getWaypointsNeedingToBeExplored(system: System): WaypointBase[] {
		if (!system.waypoints) {
			return [];
		}
		return system.waypoints.filter((waypoint) => {
				return (WaypointBase.hasUncharted(waypoint) && !WaypointBase.isAsteroid(waypoint)) ||
				       this.waypointNeedsToBeExplored(waypoint);
		});
	}

	waypointNeedsToBeExplored(waypoint: WaypointBase): boolean {
		if (WaypointBase.hasMarketplace(waypoint) &&
				!this.marketService.hasPriceData(waypoint.symbol)) {
			return true;
		}
		if (WaypointBase.hasShipyard(waypoint)) {
			const shipYard = this.shipyardService.getCachedShipyard(waypoint.symbol);
			if (shipYard == null || shipYard.ships == null || shipYard.ships.length == 0) {
				return true;
			}
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
		console.log(`ship ${ship.symbol} (at ${ship.nav.waypointSymbol} is set to explore ${explorationPath}`);

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
				console.log(`ship ${ship.symbol} (at ${ship.nav.waypointSymbol} going to explore ${shortestPath}`);
				this.explorationPathByShipSymbol.set(ship.symbol, shortestPath);
				this.shipSymbolExploringBySystemSymbol.set(shortestPath[shortestPath.length-1], ship.symbol);
				// the first element is the source system, which is where this ship should already be,
				// so we return the second system symbol
				if (shortestPath[0] == ship.nav.waypointSymbol) {
					return shortestPath[1];
				}
				return shortestPath[0];
			}
		}
		return null;
	}

	public static sortWaypointsByDistanceFrom(waypoints: WaypointBase[], fromLoc: LocXY): WaypointBase[] {
		return [...waypoints].sort((w1, w2) => {
			const d1 = LocXY.getDistanceSquared(fromLoc, w1);
			const d2 = LocXY.getDistanceSquared(fromLoc, w2);
			if (d1 < d2) return -1;
			if (d1 > d2) return 1;
			return 0;
		});
	}
	public static organizeRoute(waypoints: WaypointBase[], startingLoc: WaypointBase): WaypointBase | null {
		if (waypoints.length == 1) {
			// trivial case: only 1 waypoint to explore.
			return waypoints[0];
		}
		waypoints = this.sortWaypointsByDistanceFrom(waypoints, startingLoc);

		const locs = [];
		for (let waypoint of waypoints) {
			if ((waypoint.x == startingLoc.x) &&
			    (waypoint.y == startingLoc.y) &&
			    (waypoint.symbol !== startingLoc.symbol)) {
				// Trivial case: there is a waypoint at our current location that needs to be explored
				return waypoint;
			}
			locs.push(new LocXY(waypoint.x, waypoint.y));
		}
		locs.push(new LocXY(startingLoc.x, startingLoc.y));
		const uniqueLocs = new Set(locs.filter(
			(value, index, self) => self.findIndex((v) => v.x === value.x && v.y === value.y) === index
		));

/*		const route = LocXY.findShortestPath(startingLoc, uniqueLocs);
		if (route.length > 1) {
			let nextLoc = null;
			for (let i=0 ; i< route.length ; i++) {
				if (route[i].x == startingLoc.x && route[i].y == startingLoc.y) {
					// our current location is at index i. Check the elements at i-1 and i+1 to find the closest one:
					const indexA = i>0 ? i-1: route.length-1;
					const indexB = (i+1)< route.length ? i+1: 0;
					const distA = LocXY.getDistance(startingLoc, route[indexA]);
					const distB = LocXY.getDistance(startingLoc, route[indexB]);
					if (distA < distB) {
						nextLoc = route[indexA];
					} else {
						nextLoc = route[indexB];
					}
					break;
				}
			}
			if (nextLoc) {
	 			for (let waypoint of waypoints) {
 					if (nextLoc.x == waypoint.x && nextLoc.y == waypoint.y) {
 						return waypoint;
 					}
 				}
			}
		}
*/
		// Something went wrong - we couldn't find ourselves in the path list.
		// for now, just go to the nearest uncharted waypoint:
		return waypoints[0];
	}

	static bestRouteTo(waypointFrom: WaypointBase, waypointTo: WaypointBase,
					   system: System, marketService: MarketService,
					   currentFuel: number, fuelCapacity: number,
					   minimumFuelLeftAtDestination: number) : {path: WaypointBase[], cost: number} | null {
		const path: WaypointBase[] = [];
		let cost = 0;
		const fuelCostByWaypointSymbol = marketService.getPricesForItemInSystemByWaypointSymbol(system.symbol, 'FUEL');
		const waypointsInSystem = system.waypoints || [];
		const fuelStationsInSystem = waypointsInSystem.filter((way) => fuelCostByWaypointSymbol.has(way.symbol));
		fuelStationsInSystem.push(waypointTo);
		const waypointsInDistOrder = this.sortWaypointsByDistanceFrom(fuelStationsInSystem, waypointFrom);
		let maxDist = currentFuel;
		const fuelCostAtFrom = fuelCostByWaypointSymbol.get(waypointFrom.symbol);
		const fuelCostAtTo = fuelCostByWaypointSymbol.get(waypointTo.symbol);
		if (fuelCostAtFrom) {
			// We could refuel before we travel
			// TODO: figure in the cost of this much fuel
			maxDist = fuelCapacity;
		}
		if (!fuelCostAtTo) {
			// If we can't refuel at our destination, reduce the distance we can go.
			maxDist -= minimumFuelLeftAtDestination;
		}
		const maxDistSquared = maxDist * maxDist;
		const reachableWaypoints = waypointsInDistOrder.filter((way) => LocXY.getDistanceSquared(waypointFrom, way) <= maxDistSquared);
		if (reachableWaypoints.some((way) => way.symbol == waypointTo.symbol)) {
			// simplest case: we can navigate directly to the destination
			path.push(waypointTo);
			cost = this.getCostToTravel(waypointFrom, waypointTo, fuelCostAtFrom?.purchasePrice || null, fuelCostAtTo?.purchasePrice || null,
					                    currentFuel, minimumFuelLeftAtDestination);
			return {path, cost};
		}
		// Consider each possible path:
		let lowestCost = Infinity;
		let bestRoute: {path: WaypointBase[], cost: number} | null = null;
		for (let waypoint of reachableWaypoints) {
			const fuelCostAtWaypoint = fuelCostByWaypointSymbol.get(waypoint.symbol);
			const distanceToWaypoint = LocXY.getDistance(waypointFrom, waypoint);
			let minimumFuelLeftAtWaypoint = minimumFuelLeftAtDestination + distanceToWaypoint;
			const costToWaypoint = this.getCostToTravel(waypointFrom, waypoint, fuelCostAtFrom?.purchasePrice || null, fuelCostAtWaypoint?.purchasePrice || null,
					                                    currentFuel, minimumFuelLeftAtWaypoint);
			const route = this.bestRouteTo(waypoint, waypointTo, system, marketService,
			                               currentFuel - distanceToWaypoint, fuelCapacity,
										   minimumFuelLeftAtDestination);
			if (route && (route.cost + costToWaypoint) < lowestCost) {
				bestRoute = {path: [waypoint, ...route.path], cost: route.cost + costToWaypoint};
				lowestCost = route.cost + costToWaypoint;
			}
		}
		return bestRoute;
	}
	static getCostToTravel(waypointFrom: WaypointBase, waypointTo: WaypointBase,
						   fuelCostAtFrom: number | null, fuelCostAtTo: number | null,
					       currentFuel: number, minimumFuelLeftAtDestination: number) : number{
		let cost = 0;
		let fuelNeeded = LocXY.getDistance(waypointFrom, waypointTo);
		if (fuelNeeded > currentFuel) {
			const fuelToBuyAtFrom = (fuelNeeded - currentFuel);
			if (fuelCostAtFrom) {
				cost = fuelCostAtFrom * fuelToBuyAtFrom;
			}
			fuelNeeded -= fuelToBuyAtFrom;
		}
		const fuelRemainingAtTo = currentFuel - fuelNeeded;
		const fuelToBuyAtTo = Math.min(0, minimumFuelLeftAtDestination - fuelRemainingAtTo);
		if (fuelCostAtTo) {
			cost += fuelCostAtTo * fuelToBuyAtTo;
		}
		return cost;
	}
	
}
