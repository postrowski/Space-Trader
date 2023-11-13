import { Component} from '@angular/core';
import { DBService } from 'src/app/services/db.service';
import { FleetService } from 'src/app/services/fleet.service';
import { LocXY } from 'src/models/LocXY';
import { System } from 'src/models/System';
import { GalaxyService } from '../../services/galaxy.service';

@Component({
  selector: 'app-galaxy',
  templateUrl: './galaxy.component.html',
  styleUrls: ['./galaxy.component.css']
})
export class GalaxyComponent {
	nearbySystems: System[] = [];
	selectedSystem?: System | null;
	systemsWithShips: Map<string, number> = new Map();
	centerSystemStr: string = "";
	centerSystem?: System | null;
	nearbySystemCount: number = 20;
	searchInProgress = false;
	message = "";
	
	constructor(public galaxyService: GalaxyService,
	            public fleetService: FleetService,
	            public dbService: DBService) {
		this.galaxyService.activeSystem$.subscribe((system) => {
			this.selectedSystem = system;
			if (this.centerSystem == null && system) {
				this.centerSystem = system;
				this.centerSystemStr = system.symbol;
				this.onNearbySystemsChange();
			}
		});
		this.fleetService.allShips$.subscribe((ships) => {
			this.systemsWithShips.clear();
			for (let ship of ships) {
			  const shipsInSystem = this.systemsWithShips.get(ship.nav.systemSymbol) || 0;
			  this.systemsWithShips.set(ship.nav.systemSymbol, shipsInSystem + 1);
			}
		});
	}
	

	onNearbySystemsChange() {
		this.message = 'looking for system...';
		this.searchInProgress = true;
		this.dbService.systems
			.where('symbol')
			.equalsIgnoreCase(this.centerSystemStr)
			.first()
			.then((existingSystem) => {
				if (existingSystem) {
					this.centerSystem = existingSystem;
					this.onNearestCountChange();
				} else {
					this.message = "no match for system " + this.centerSystemStr;
					this.searchInProgress = false;
					this.centerSystem = null;
				}
			});
	}
	
	maxRange(): number {
		if (this.nearbySystems.length > 1 && this.centerSystem) {
			let lastSys = this.nearbySystems[this.nearbySystems.length - 1];
			return LocXY.getDistance(lastSys, this.centerSystem);
		}
		return 0;
	}
	onNearestCountChange() {
		if (this.centerSystem) {
			if (this.nearbySystemCount < 1) {
				this.message = 'enter valid count';
			} else {
				this.message = 'scanning nearby...';
				let distance = 1000;
				this.findNearbySystems(this.centerSystem, distance, 0);
			}
		}
	}
	findNearbySystems(loc: LocXY, distance: number, previousSearchCount: number) {
		this.findSystemsNearLocation(loc, distance)
			.then((result: System[]) => {
				console.log(`found ${result.length} systems within ${distance}`)
				if ((result.length < this.nearbySystemCount) &&
				    (result.length > previousSearchCount)) {
					// search farther out, unless we didnt increase our system count
					// when we increased the search last time.
					this.findNearbySystems(loc, distance * 3, result.length);
				} else {
					this.nearbySystems = result.sort((s1, s2) => {
						let d1 = LocXY.getDistance(s1, this.centerSystem!);
						let d2 = LocXY.getDistance(s2, this.centerSystem!);
						if (d1 < d2) {
							return -1;
						}
						if (d1 > d2) {
							return 1;
						}
						return 0;
					}).slice(0, this.nearbySystemCount);
					this.searchInProgress = false;
					this.message = '';
				}
			})
			.catch((error) => {
				this.searchInProgress = false;
				this.message = 'nothing found';
			});
	}
	async findSystemsNearLocation(loc: LocXY, distance: number): Promise<System[]> {
		  // Use the where clause to filter systems that meet the distance condition
		const dist2 = distance * distance;
		return await this.dbService.systems
		    .where('x').between(loc.x - distance, loc.x + distance)
//		    .and((system: System) => system.y >= y - distance && system.y <= y + distance)
			.filter((system: System) => {
				// Check if the system is within the specified distance
				return LocXY.getDistanceSquared(system, loc) < dist2;
			}).toArray();
	}

	setShowGalaxy(show: boolean) {
		this.galaxyService.showGalaxy = show;
	}
	 
	update() {
		this.galaxyService.loadMoreGalaxies();
	}

	onDoubleClickSystem(system: System | null) {
		this.galaxyService.setActiveSystem(system);
		this.galaxyService.showGalaxy = false;
	}	
	onSelectSystem(system: System | null) {
		// Tell the galaxy service to set the selected active system,
		// this will in turn notify our subscription on this.galaxyService.activeSystem$
		// which will then update our this.selectedSystem variable. 
		this.galaxyService.setActiveSystem(system);
	}

	onJump(waypointSymbol: string) {
		const ship = this.fleetService.getActiveShip();
		if (ship) {
			this.fleetService.jumpShip(ship?.symbol, waypointSymbol)
			.subscribe((response) => {
			});
		}
	}
	onWarp(system: System) {
		const ship = this.fleetService.getActiveShip();
		if (ship) {
			this.fleetService.warpShip(ship?.symbol, system.symbol)
			.subscribe((response) => {
			});
		}
	}
	identifyList(index:number, list: System) {
    	return `${list.symbol}`;
	}
	
	hasShipyard(system: System): boolean {
		return System.hasShipyard(system);
	}
	hasMarketplace(system: System): boolean {
		return System.hasMarketplace(system);
	}
	hasJumpGate(system: System): boolean {
		return System.hasJumpGate(system);
	}
	hasAsteroidField(system: System): boolean {
		return System.hasAsteroidField(system);
	}
	hasAsteroidMarket(system: System): boolean {
		return System.hasAsteroidMarket(system);
	}
	hasUncharted(system: System): boolean {
		return System.hasUncharted(system);
	}
	getDistance(loc1: LocXY, loc2: LocXY) {
		return LocXY.getDistance(loc1, loc2);
	}
	getShipCount(system: System): string {
		const count = this.systemsWithShips.get(system.symbol) || 0;
		if (count) {
			return '' + count;
		}
		return '';
	}
}