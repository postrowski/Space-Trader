import { Component } from '@angular/core';
import { Ship } from 'src/models/Ship';
import { FleetService } from '../../services/fleet.service';
import { AccountService } from '../../services/account.service';
import { ModalService } from 'src/app/services/modal.service';
import { GalaxyService } from 'src/app/services/galaxy.service';
import { System } from 'src/models/System';

@Component({
	selector: 'app-fleet',
	templateUrl: './fleet.component.html',
	styleUrls: ['./fleet.component.css']
})
export class FleetComponent {
	showShips = 'All';
	showShipsAtSystem: string | null = null;
	systemsWithShipsArray: { key: string, value: number }[] = [];
	selectedSystem: System | null = null;
	ships: Ship[] = [];
	selectedShip: Ship | null = null; // Initialize selectselectedShipedMount as null
	shipTypes: { frameName: string, value: boolean }[] = [];

	constructor(public accountService: AccountService,
	            public fleetService: FleetService,
	            public galaxyService: GalaxyService,
	            public modalService: ModalService) {
		this.fleetService.activeShip$.subscribe((ship) => {
			this.selectedShip = ship;
		});
		this.galaxyService.activeSystem$.subscribe((system) => {
			this.selectedSystem = system;
		});
		this.fleetService.allShips$.subscribe((ships) => {
			this.ships = ships;
			const systemsWithShips = new Map();
			for (const ship of ships) {
				const shipsInSystem = systemsWithShips.get(ship.nav.systemSymbol) || 0;
				systemsWithShips.set(ship.nav.systemSymbol, shipsInSystem + 1);
				let found = false;
				for (const type of this.shipTypes) {
					if (type.frameName == ship.frame.name) {
						found = true;
						break;
					}
				}
				if (!found) {
					this.shipTypes.push({frameName:ship.frame.name, value: true})
				}
			}
			this.systemsWithShipsArray = Array.from(systemsWithShips, ([key, value]) => ({ key, value }));
		});
	}

	showShipType(ship: Ship) {
		for (const type of this.shipTypes) {
			if (type.frameName == ship.frame.name) {
				return type.value;
			}
		}
		return true;
	}
	update() {
		this.fleetService.updateFleet();
	}
	onShipSelectionChange() {
		if (this.selectedShip != null) {
			this.fleetService.setActiveShip(this.selectedShip);
		}
	}
	onShowShipsSelectionChange() {
		if (this.showShipsAtSystem) {
			this.galaxyService.setActiveSystemBySymbol(this.showShipsAtSystem);
		}
	}

	selectShip(ship: Ship) {
		this.selectedShip = ship; // Set selectedModule to the clicked module
		this.fleetService.setActiveShip(ship);
	}

	ngOnInit() {
	}
}
