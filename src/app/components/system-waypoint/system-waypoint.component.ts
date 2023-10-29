import { Component, Input } from '@angular/core';
import { WaypointBase, WaypointTrait, WaypointType } from 'src/models/WaypointBase';
import { GalaxyService } from '../../services/galaxy.service';
import { MatDialog } from '@angular/material/dialog';
import { ModalService } from 'src/app/services/modal.service';
import { AccountService } from 'src/app/services/account.service';
import { FleetService } from 'src/app/services/fleet.service';
import { Ship } from 'src/models/Ship';
import { ContractService } from 'src/app/services/contract.service';
import { ConstructionMaterial, ConstructionSite } from 'src/models/ConstructionSite';

@Component({
  selector: 'app-system-waypoint',
  templateUrl: './system-waypoint.component.html',
  styleUrls: ['./system-waypoint.component.css']
})
export class SystemWaypointComponent {
	waypoint!: WaypointBase;
	constructionSite: ConstructionSite | null = null;
	
	constructor(public galaxyService: GalaxyService,
	            public accountService: AccountService, 
	            public fleetService: FleetService,
	            public contractService: ContractService,
	            public modalService: ModalService) {
		this.galaxyService.activeSystemWaypoint$.subscribe((waypoint) => {
			if (waypoint) {
				this.waypoint = waypoint;
				this.constructionSite = null;
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
		return WaypointBase.isAsteroid(this.waypoint) || WaypointBase.isDebrisField(this.waypoint);
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
	onSupplyConstructionMaterial(material: ConstructionMaterial) {
		const ship = this.getShipAtWaypoint();
		if (ship) {
			for (const inv of ship.cargo.inventory) {
				if (inv.symbol == material.tradeSymbol) {
					const units = Math.min(inv.units, (material.required - material.fulfilled));
					this.galaxyService.supplyConstructionSite(this.waypoint.symbol, ship.symbol,
					                                          inv.symbol, units)
									  .subscribe((response) => {
						this.constructionSite = response.data.construction;
						ship.cargo = response.data.cargo;
					});
					return;
				}
			} 
		}
	}
	
	onGetConstructionSite() {
		const ship = this.getShipAtWaypoint();
		if (ship) {
			this.galaxyService.getConstructionSite(this.waypoint.symbol)
							  .subscribe((response) => {
				this.constructionSite = response.data;
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
