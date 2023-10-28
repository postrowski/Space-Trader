import { Component, Input, OnInit } from '@angular/core';
import { GalaxyService } from 'src/app/services/galaxy.service';
import { Ship } from 'src/models/Ship';
import { ShipModule } from 'src/models/ShipModule';
import { ShipMount } from 'src/models/ShipMount';
@Component({
  selector: 'app-ship-details',
  templateUrl: './ship-details.component.html',
  styleUrls: ['./ship-details.component.css']
})
export class ShipDetailsComponent implements OnInit {
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
	
	constructor(public galaxyService: GalaxyService) {}
	
	selectedModule: ShipModule | null = null; // Initialize selectedModule as null
	selectedMount: ShipMount | null = null; // Initialize selectedMount as null

	onWaypointSymbolClick(waypointSymbol: string) {
		this.galaxyService.setActiveSystemWaypointBySymbol(waypointSymbol);
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

	ngOnInit() {
		// Set the selectedModule to the first module in the list
		if (this.ship && this.ship?.modules.length > 0) {
			this.selectedModule = this.ship?.modules[0];
		}
		if (this.ship && this.ship?.mounts.length > 0) {
			this.selectedMount = this.ship?.mounts[0];
		}
	}
}
