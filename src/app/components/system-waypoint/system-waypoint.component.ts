import { Component, Input } from '@angular/core';
import { WaypointBase, WaypointTrait, WaypointType } from 'src/models/WaypointBase';
import { GalaxyService } from '../../services/galaxy.service';
import { MatDialog } from '@angular/material/dialog';
import { ModalService } from 'src/app/services/modal.service';
import { AccountService } from 'src/app/services/account.service';
import { FleetService } from 'src/app/services/fleet.service';
import { Ship } from 'src/models/Ship';
import { ContractService } from 'src/app/services/contract.service';

@Component({
  selector: 'app-system-waypoint',
  templateUrl: './system-waypoint.component.html',
  styleUrls: ['./system-waypoint.component.css']
})
export class SystemWaypointComponent {
	waypoint!: WaypointBase;
	constructor(public galaxyService: GalaxyService,
	            public accountService: AccountService, 
	            public fleetService: FleetService,
	            public contractService: ContractService,
	            public modalService: ModalService) {
		this.galaxyService.activeSystemWaypoint$.subscribe((waypoint) => {
			if (waypoint) {
				this.waypoint = waypoint;
			}
		});
	}
	onClick(waypointSymbol: string) {
		this.galaxyService.setActiveSystemWaypointBySymbol(waypointSymbol);
	}
	onDoubleClick(waypointSymbol: string) {
		this.galaxyService.setActiveSystemWaypointBySymbol(waypointSymbol);
		this.galaxyService.showGalaxy = false;
	}
	hasTrait(traitSymbol: string) {
		if (this.waypoint.traits) {
			for (let trait of this.waypoint.traits) {
				if (trait.symbol == traitSymbol) {
					return true;
				}
			}
		}
		return false;
	}
	hasMarketplace() {
		return this.hasTrait(WaypointTrait[WaypointTrait.MARKETPLACE]);
	}
	hasShipyard() {
		return this.hasTrait(WaypointTrait[WaypointTrait.SHIPYARD]);
	}
	isUncharted(){
		return this.hasTrait(WaypointTrait[WaypointTrait.UNCHARTED]);
	}
	isJumpGate() {
		return this.waypoint.type == WaypointType[WaypointType.JUMP_GATE];
	}
	isMineable() {
		return this.waypoint.type == WaypointType[WaypointType.ASTEROID_FIELD]
		    || this.waypoint.type == WaypointType[WaypointType.DEBRIS_FIELD];
	}
	isFactionHQ(){
		return this.accountService.isFactionHQ(this.waypoint.symbol);
	}
	getShipAtWaypoint() : Ship | null {
		for (const ship of this.fleetService.getShips()) {
			if ((ship.nav.status !== 'IN_TRANSIT') && 
			   (ship.nav.waypointSymbol == this.waypoint.symbol)) {
				return ship;
			}
		}
		return null;
	}
	onNegotiateContract() {
		const ship = this.getShipAtWaypoint();
		if (ship) {
			this.contractService.negotiateContract(ship.symbol)
							 .subscribe((response) => {
			});
		}
	}
	onCreateChart() {
		const ship = this.getShipAtWaypoint();
		if (ship) {
			this.fleetService.createChart(ship.symbol)
							 .subscribe((response) => {
				if (response.data.waypoint.symbol == this.waypoint.symbol) {
					this.waypoint.traits = response.data.waypoint.traits;
				}
			});
		}		
	}
}
