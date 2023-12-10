import { AfterViewInit, Component, Input, ɵNgModuleTransitiveScopes } from '@angular/core';
import { liveQuery } from 'dexie';
import { Observable } from 'rxjs';
import { AccountService } from 'src/app/services/account.service';
import { DBService, JumpLink } from 'src/app/services/db.service';
import { FleetService } from 'src/app/services/fleet.service';
import { GalaxyService } from 'src/app/services/galaxy.service';
import { SvgMap } from 'src/app/utils/svg-map';
import { Faction } from 'src/models/Faction';
import { LocXY } from 'src/models/LocXY';
import { Ship } from 'src/models/Ship';
import { System, SystemType, SystemTypeAttributes } from 'src/models/System';
import { WaypointBase } from 'src/models/WaypointBase';

@Component({
	selector: 'app-galaxy-map',
	templateUrl: './galaxy-map.component.html',
	styleUrls: ['./galaxy-map.component.css']
})
export class GalaxyMapComponent extends SvgMap {
	showLabelAtStarSize = 2.5;

	showJumplines = false;
	showLabels = false;
	showFactions = true;
	autoLoadSystems = false;

	systems: System[] = [];
	selectedSystem: System | null | undefined = null;

	showGate = false;
	showShipyard = true;
	showMarket = true;
	showAsteroids = false;
	showDebris = false;
	filterGate = false;
	filterShipyard = false;
	filterMarket = false;
	filterAsteroids = false;
	filterDebris = false;

	selectedShip: Ship | null = null;
	allShips: Ship[] = [];
	factions: Faction[] = [];

	@Input() nearbyCenter: System | null | undefined = null;
	@Input() distance: number | null | undefined = null;

	constructor(public dbService: DBService,
	            public fleetService: FleetService,
				public galaxyService: GalaxyService,
				public accountService: AccountService) {
		super();
		super.baseObjectScale = .75;
		super.componentName = "galaxy-map-svg";
		this.galaxyService.activeSystem$.subscribe((system) => {
			this.selectedSystem = system;
			if (system) {
				this.centerOnLocation(system.x, system.y);
			}
		});
	    this.dbService.initDatabase().then(() => {
	        liveQuery(() => this.dbService.systems.toArray())
	        .subscribe((response) => {
				this.systems = response;
				// update the scale anytime the list of systems changes.
				// recompute the scale for this system:
				if (response.length) {
					const max = response.reduce((maxValue, system) => {
						const x = Math.abs(system.x);
						const y = Math.abs(system.y);
						return Math.max(maxValue, x, y);
					}, 0);
					this.scale = this.baseScale = (Math.max(this.width, this.width) / 2) / (max + 10);
				} else {
					this.scale = this.baseScale = 1;
				}
	        });
	    });
		
		this.fleetService.activeShip$.subscribe((ship) => {
			this.selectedShip = ship;
		});
		this.fleetService.allShips$.subscribe((shipLoc) => {
			this.allShips = shipLoc;
		});
		this.accountService.getFactions(20, 1).subscribe((response) => {
			this.factions = response.data;
		});
	}

	// Define a filter condition (modify as needed)
	isVisibleViafilters(system: System): boolean {
		if (!this.filterGate && !this.filterShipyard && !this.filterMarket && !this.filterAsteroids && !this.filterDebris) {
			// If no filters are applied, return true for all systems
			return true;
		}

		for (const waypoint of system.waypoints || []) {
			if ((this.filterGate      && WaypointBase.isJumpGate(waypoint)) ||
				(this.filterAsteroids && WaypointBase.isAsteroidField(waypoint)) ||
				(this.filterDebris    && WaypointBase.isDebrisField(waypoint)) ||
			    (this.filterShipyard  && WaypointBase.hasShipyard(waypoint)) ||
			    (this.filterMarket    && WaypointBase.hasMarketplace(waypoint))) {
				return true;
			}
		}
		return false;
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

	
	getFactions(quadX: number, quadY: number) {
		const facts = [];
		for (const f of this.factions) {
			let loc = this.getFactionSystemLoc(f);
			if (loc) {
				if ((loc.x < 0) == (quadX < 0) &&
					(loc.y < 0) == (quadY < 0)) {
					facts.push(f);
				}
			}
		}
		return facts.sort((f1, f2) => {
			let l1 = this.getFactionSystemLoc(f1);
			let l2 = this.getFactionSystemLoc(f2);
			if (l1 && l2) {
				if (l1.y < l2.y) {
					return -1;
				}
				if (l1.y > l2.y) {
					return 1;
				}
				if (l1.x < l2.x) {
					return -1;
				}
				if (l1.x > l2.x) {
					return 1;
				}
			}
			return 0;
		});
	}
	getShipSystemLoc(ship: Ship): LocXY | null {
		return null;
	}
	getFactionSystemLoc(faction: Faction): LocXY | null {
		return this.getLoc(faction.headquarters);
	}
	getLoc(systemSymbol: string): LocXY | null {
		const system = this.galaxyService.getSystemBySymbol(systemSymbol);
		if (!system)
			return null;
		return system;
	}

	private autoLoadInterval: any;
	onAutoLoadSystemsChange() {
		if (this.autoLoadInterval) {
			clearInterval(this.autoLoadInterval);
		}
		if (this.autoLoadSystems) {
			this.autoLoadInterval = setInterval(() => {
				if (!this.galaxyService.loadMoreGalaxies()) {
					clearInterval(this.autoLoadInterval);
					this.autoLoadInterval = null;
				}
			}, 700);
		}

	}
	onLoadSystems() {
		this.galaxyService.loadMoreGalaxies();
	}
	onSystemClick(system: System) {
		this.galaxyService.setActiveSystemWaypointBySymbol(system.symbol);
	}

	onSystemDoubleClick(system: System) {
		this.galaxyService.setActiveSystemWaypointBySymbol(system.symbol);
		this.galaxyService.showGalaxy = false;
	}

	getSystemType(system: System) {
		const matchingKey = SystemType[system.type as keyof typeof SystemType];
		if (matchingKey !== undefined) {
			const systemType = matchingKey as SystemType;
			return SystemTypeAttributes[systemType];
		}
		return undefined;
	}
	getSystemSize(system: System) {
		return this.getSystemType(system)?.size;
	}
	getFillColor(system: System) {
		return this.getSystemType(system)?.fillColor;
	}
	getEdgeColor(system: System) {
		return this.getSystemType(system)?.edgeColor;
	}
	getTextColor(system: System) {
		return this.getSystemType(system)?.textColor;
	}

	identifyList(index: number, list: System) {
		return `${list.symbol}`;
	}
	
	onScale() {
		this.showLabels = this.objectScale > this.showLabelAtStarSize;
	}
	
	jumpLines$: Observable<{ s1: WaypointBase; s2: WaypointBase}[]> = new Observable((observer) => {
		if (this.showJumplines) {
			this.dbService.systems.toArray().then((jumpgateSystems: System[]) => {
				jumpgateSystems = jumpgateSystems.filter((sys) => System.hasJumpGate(sys));
				//const jumpgateBySymbol = new Map<string, WaypointBase>();
				const systemBySymbol = new Map<string, System>();
				jumpgateSystems.forEach(sys => {
					for (const way of sys.waypoints || []) {
						if (WaypointBase.isJumpGate(way)) {
							//jumpgateBySymbol.set(way.symbol, way);
							systemBySymbol.set(way.symbol, sys);
							break;
						}
					}
				});
				
				this.dbService.jumplinks.toArray().then((jumpLinks: JumpLink[]) => {
					const links: { s1: WaypointBase; s2: WaypointBase}[] = [];
					for (const jumpLink of jumpLinks) {
						const fromSys: WaypointBase | undefined = systemBySymbol.get(jumpLink.fromSymbol);
						const toSys: WaypointBase | undefined = systemBySymbol.get(jumpLink.toSymbol);
						if (fromSys && toSys) {
							links.push({s1: fromSys, s2: toSys});
						}
					}
					observer.next(links);
					observer.complete();
				});
			});
		} else {
			observer.next([]);
			observer.complete();
		}
	});
}
