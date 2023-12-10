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

	allShipSymbols: string[] = [];
	allowShips: { shipSymbol: string, value: boolean }[] = [];

	constructor(public automationService: AutomationService,
	            public fleetService: FleetService) {
		this.automationService.running$.subscribe((running) => {
			this.running = running;
		});
		this.allowShips = this.automationService.automationEnabledShips;
		this.fleetService.allShips$.subscribe((ships) => {
			for (const ship of ships) {
				if (this.allShipSymbols.includes(ship.symbol)) {
					continue;
				}
				this.allShipSymbols.push(ship.symbol);
				this.allowShips.push({shipSymbol: ship.symbol, value: true});
			}
			
			this.allowShips.sort((a, b) => {
				if (a.shipSymbol.length < b.shipSymbol.length) return -1;
				if (a.shipSymbol.length > b.shipSymbol.length) return 1;
				if (a.shipSymbol < b.shipSymbol) return -1;
				if (a.shipSymbol > b.shipSymbol) return 1;
				return 0;
			});
			this.allowShips = [...this.allowShips];
			this.automationService.setAutomationEnabledShips(this.allowShips);
		});
	}
	onStart() {
		this.automationService.start();
	}
	onStep() {
		this.automationService.singleStep();
	}
	onStop() {
		this.automationService.stop();
	}
	onAllowShipsChanged() {
		this.automationService.setAutomationEnabledShips(this.allowShips);
	}
}
