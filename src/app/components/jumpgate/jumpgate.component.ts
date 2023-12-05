import { Component, Input } from '@angular/core';
import { FleetService } from 'src/app/services/fleet.service';
import { GalaxyService } from 'src/app/services/galaxy.service';
import { JumpgateService } from 'src/app/services/jumpgate.service';
import { ModalService } from 'src/app/services/modal.service';
import { JumpGate } from 'src/models/JumpGate';
import { Ship } from 'src/models/Ship';
import { WaypointBase, WaypointTrait } from 'src/models/WaypointBase';

@Component({
  selector: 'app-jumpgate',
  templateUrl: './jumpgate.component.html',
  styleUrls: ['./jumpgate.component.css']
})
export class JumpgateComponent {
	waypoint: WaypointBase | null = null;
	jumpgate?: JumpGate;
	shipsAtWaypoint: Ship[] = [];
	selectedShip: Ship | null = null;
	constructor(public fleetService: FleetService,
	            public jumpgateService: JumpgateService,
	            public galaxyService: GalaxyService,
	            public modalService: ModalService) {
		modalService.waypoint$.subscribe((response) => {
			this.waypoint = response;
			this.ngOnInit();
		})
	}
	
	ngOnInit(): void {
		this.loadShips();
		this.loadJumpgate();
	}
	
	loadJumpgate() {
		if (WaypointBase.isJumpGate(this.waypoint)) {
			this.jumpgateService.getJumpgate(this.waypoint!.symbol, this.shipsAtWaypoint.length > 0)
			                    .subscribe((response) => {
				this.jumpgate = response;
			});
		}
	}
	
	onSelectShip(ship: Ship) {
		this.selectedShip = ship;
	}
	
	loadShips() {
		this.fleetService.allShips$.subscribe((allShips) => {
			this.shipsAtWaypoint.length = 0;
			for (let ship of allShips) {
				if (ship.nav?.waypointSymbol == this.waypoint?.symbol) {
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
	onWaypointClicked(waypointSymbol: string) {
		this.galaxyService.setActiveSystemBySymbol(waypointSymbol);
	}
	
	onJump(targetWaypoint: string) {
		if (this.selectedShip) {
			this.fleetService.jumpShip(this.selectedShip.symbol, targetWaypoint)
				.subscribe((response)=> {
					this.galaxyService.setActiveSystemBySymbol(targetWaypoint);
				});
			this.modalService.close();
		}
	}
}
