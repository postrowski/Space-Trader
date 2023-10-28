import { Component } from '@angular/core';
import { AutomationService } from 'src/app/services/automation.service';
import { FleetService } from 'src/app/services/fleet.service';

@Component({
	selector: 'app-automation',
	templateUrl: './automation.component.html',
	styleUrls: ['./automation.component.css']
})
export class AutomationComponent {
	running: boolean = false;
	
	constructor(public automationService: AutomationService,
	            public fleetService: FleetService) {
		this.automationService.running$.subscribe((running) => {
			this.running = running;
		});
	}
	onStart() {
		this.automationService.start();
	}
	onStep() {
		this.automationService.step();
	}
	onStop() {
		this.automationService.stop();
	}
}
