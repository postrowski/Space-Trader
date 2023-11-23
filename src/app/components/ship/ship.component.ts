import { Component, Input, OnInit } from '@angular/core';
import { FleetService } from 'src/app/services/fleet.service';
import { GalaxyService } from 'src/app/services/galaxy.service';
import { MarketService } from 'src/app/services/market.service';
import { ModalService } from 'src/app/services/modal.service';
import { Ship } from 'src/models/Ship';
import { ShipModule } from 'src/models/ShipModule';
import { ShipMount } from 'src/models/ShipMount';
@Component({
	selector: 'app-ship',
	templateUrl: './ship.component.html',
	styleUrls: ['./ship.component.css']
})
export class ShipComponent implements OnInit {
	_ship: Ship | null = null;
	
	@Input()
	set ship(value: Ship | null) {
		// Custom logic to execute when ship is set
		this._ship = value;
		this.ngOnInit();
	}

	get ship(): Ship | null {
		return this._ship;
	}
	
	constructor(public galaxyService: GalaxyService,
	            public fleetService: FleetService,
	            public marketService: MarketService,
	            public modalService: ModalService) {}
	
	selectedModule: ShipModule | null = null; // Initialize selectedModule as null
	selectedMount: ShipMount | null = null; // Initialize selectedMount as null

	onWaypointSymbolClick(waypointSymbol: string) {
		this.galaxyService.setActiveSystemWaypointBySymbol(waypointSymbol);
	}
	onOrbitShip(ship: Ship) {
		if (ship) {
			this.fleetService.orbitShip(ship.symbol).subscribe((response) => {
			});
		}
	}
	onDockShip(ship: Ship) {
		if (ship) {
			this.fleetService.dockShip(ship.symbol).subscribe((response) => {
			});
		}
	}
	hasSensor(ship: Ship) {
		return Ship.containsMount(ship, 'MOUNT_SENSOR');
	}
	canRefine(ship: Ship) {
		return Ship.containsModule(ship, 'MODULE_ORE_REFINERY');
	}
	canSiphon(ship: Ship) {
		return Ship.containsMount(ship, 'MOUNT_GAS_SIPHON_');
	}
	onScanSystem(ship: Ship) {
		if (ship != null) {
			this.fleetService.scanSystems(ship.symbol).subscribe((response) => {
				for (let system of response.data.systems) {
					this.galaxyService.addSystem(system);
				}
			});
		}
	}
	onRefuel(ship: Ship) {
		if (ship != null) {
			this.marketService.refuelShip(ship.symbol, ship.fuel.capacity - ship.fuel.current, false)
							  .subscribe((response) => {
							  			 });
		}
	}
	onRefuelFromCargo(ship: Ship) {
		if (ship != null) {
			this.marketService.refuelShip(ship.symbol, ship.fuel.capacity - ship.fuel.current, true)
							  .subscribe((response) => {
							  			 });
		}
	}
	onRefine(ship: Ship) {
		if (ship != null) {
			for (let inv of ship.cargo.inventory) {
				if (inv.symbol.endsWith("_ORE")) {
					this.fleetService.shipRefine(ship.symbol, inv.symbol.slice(0, -4))
									 .subscribe((response) => {
									            });
				}
			}
		}
	}
	onSiphon(ship: Ship) {
		if (ship) {
			this.fleetService.siphonGas(ship.symbol)
					.subscribe((response) => {});
		}
	}

	onShipFlightModeChange(ship: Ship) {
		this.fleetService.setFlightMode(ship.symbol, ship.nav.flightMode)
		                 .subscribe((response) => {
		                            });
	}

	timeUntil(date: string) {
		return new Date(date).getTime() - new Date().getTime();
	}
	showModuleDetails(module: ShipModule) {
		this.selectedModule = module; // Set selectedModule to the clicked module
	}
	showMountDetails(mount: ShipMount) {
		this.selectedMount = mount; // Set selectedMount to the clicked module
	}

	getShipPowerString(ship: Ship) {
		return `power: ${Ship.getPowerAvailable(ship)} available of ${ship.reactor.powerOutput}`;
	}
	getShipInventory() {
		if (!this._ship) {
			return '';
		}

		return this._ship.cargo.inventory.map((item) => {
			return `${item.units} ${item.symbol}`;
		}).join('\n');
	}
	
	ngOnInit() {
		// Set the selectedModule to the first module in the list
		if (this._ship && this._ship?.modules.length > 0) {
			this.selectedModule = this._ship?.modules[0];
		}
		if (this._ship && this._ship?.mounts.length > 0) {
			this.selectedMount = this._ship?.mounts[0];
		}
	}
}
