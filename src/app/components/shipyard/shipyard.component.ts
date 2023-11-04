import { Component, Input, OnInit } from '@angular/core';
import { FleetService } from 'src/app/services/fleet.service';
import { GalaxyService } from 'src/app/services/galaxy.service';
import { Shipyard } from 'src/models/Shipyard';
import { Ship } from 'src/models/Ship';
import { WaypointBase, WaypointTrait } from 'src/models/WaypointBase';
import { ShipyardShip } from 'src/models/ShipyardShip';
import { ModalService } from 'src/app/services/modal.service';
import { ShipCargoItem } from 'src/models/ShipCargoItem';
import { AccountService } from 'src/app/services/account.service';
import { Agent } from 'src/models/Agent';
import { ShipMount } from 'src/models/ShipMount';
import { ShipyardService } from 'src/app/services/shipyard.service';

@Component({
  selector: 'app-shipyard',
  templateUrl: './shipyard.component.html',
  styleUrls: ['./shipyard.component.css']
})
export class ShipyardComponent implements OnInit{
	waypoint: WaypointBase | null = null;

	shipyard?: Shipyard;
	account: Agent | null = null;
	shipsAtWaypoint: Ship[] = [];
	selectedShip: Ship | null = null;
	constructor(public galaxyService: GalaxyService,
	            public fleetService: FleetService,
	            public accountService: AccountService,
	            public shipyardService: ShipyardService,
	            public modalService: ModalService) {
		modalService.waypoint$.subscribe((response) => {
			this.waypoint = response;
			this.ngOnInit();
		})
		accountService.agent$.subscribe((response) => {
			this.account = response;
		})
	}
	
	ngOnInit(): void {
		this.loadShips();
		this.loadShipyard();
	}
	
	hasTrait(traitSymbol: string) {
		if (this.waypoint?.traits) {
			for (let trait of this.waypoint.traits) {
				if (trait.symbol == traitSymbol) {
					return true;
				}
			}
		}
		return false;
	}
	
	hasShipyard() {
		return this.hasTrait(WaypointTrait[WaypointTrait.SHIPYARD]);
	}

	loadShipyard() {
		this.shipyard = undefined;
		if (this.waypoint && this.hasShipyard()) {
			this.shipyardService.getShipyard(this.waypoint.symbol, this.shipsAtWaypoint.length > 0)
			                    .subscribe((response) => {
				this.shipyard = response;
			});
		}
	}
	loadShips() {
		this.fleetService.allShips$.subscribe((allShips) => {
			this.shipsAtWaypoint.length = 0;
			for (let ship of allShips) {
				if (ship.nav.waypointSymbol == this.waypoint?.symbol) {
					this.shipsAtWaypoint.push(ship);
					if (this.selectedShip == null) {
						this.selectedShip = ship;
					}
				}
			}
			let fleetActiveShip = this.fleetService.getActiveShip();
			if (fleetActiveShip && this.shipsAtWaypoint.includes(fleetActiveShip)) {
				this.selectedShip = fleetActiveShip;
			}
		})
	}
	onPurchaseShip(ship: ShipyardShip) {
		if (this.waypoint) {
			this.fleetService.purchaseShip(ship.type, this.waypoint.symbol).subscribe((response) => {
				alert("Ship purchased!");
			});
		}
	}
	onDockShip(ship: Ship) {
		if (ship) {
			this.fleetService.dockShip(ship.symbol).subscribe((response) => {
			});
		}
	}
	onInstallMount(ship: Ship, cargoItem: ShipCargoItem) {
		if (cargoItem) {
			this.fleetService.installMount(ship.symbol, cargoItem.symbol).subscribe((response) => {
				alert("mount installed!");
			});
		}
	}
	onRemoveMount(ship: Ship, mount: ShipMount) {
		if (mount) {
			this.fleetService.removeMount(ship.symbol, mount.symbol).subscribe((response) => {
				alert("mount removed!");
			});
		}
	}
}
