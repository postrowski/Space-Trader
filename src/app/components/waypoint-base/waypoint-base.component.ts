import { Component, Input } from '@angular/core';
import { EventQueueService } from 'src/app/services/event-queue.service';
import { LocXY } from 'src/models/LocXY';
import { Ship } from 'src/models/Ship';
import { WaypointBase } from 'src/models/WaypointBase';
import { FleetService } from '../../services/fleet.service';
import { GalaxyService } from '../../services/galaxy.service';

@Component({
  selector: 'app-waypoint-base',
  templateUrl: './waypoint-base.component.html',
  styleUrls: ['./waypoint-base.component.css']
})
export class WaypointBaseComponent {
	_waypoint: WaypointBase | undefined = undefined;
	title: string = "";
	@Input() waypointSymbol?: string = "";
	@Input() 
	set waypoint(waypoint: WaypointBase | undefined) {
		this._waypoint = waypoint;
		if (waypoint) {
			this.title = `${waypoint.type}: [${waypoint.x}, ${waypoint.y}]`;
			this.waypointSymbol = waypoint.symbol;
		} else {
			this.title = "";
		}
	}
	get waypoint() : WaypointBase | undefined {
		return this._waypoint;
	}
	
	activeShip: Ship | null = null;
	
	constructor(public galaxyService: GalaxyService,
				public fleetService: FleetService,
	            public eventQueueService: EventQueueService) {
		this.fleetService.activeShip$.subscribe((ship) => {
			this.activeShip = ship;
		});
	}
	onClick(waypointSymbol: string | undefined) {
		if (waypointSymbol) {
			this.galaxyService.setActiveSystemWaypointBySymbol(waypointSymbol);
		}
	}
	onNavigateTo(waypointSymbol: string | undefined) {
		const ship = this.fleetService.getActiveShip();
		if (ship && waypointSymbol) {
			this.fleetService.navigateShip(ship.symbol, waypointSymbol).subscribe((response) => {
			});
		}
	}
	onWarpTo(waypointSymbol: string | undefined) {
		const ship = this.fleetService.getActiveShip();
		if (ship && waypointSymbol) {
			this.fleetService.warpShip(ship.symbol, waypointSymbol).subscribe((response) => {
			});
		}
	}
	onJumpTo(waypointSymbol: string | undefined) {
		const ship = this.fleetService.getActiveShip();
		if (ship && waypointSymbol) {
			this.fleetService.jumpShip(ship.symbol, waypointSymbol).subscribe((response) => {
			});
		}
	}

	isSameSystem() {
		if (this.activeShip) {
			return this.waypointSymbol?.startsWith(this.activeShip.nav.systemSymbol);
		}
		return false;
	}
}
