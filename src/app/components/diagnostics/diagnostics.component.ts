import { Component } from '@angular/core';
import { AutomationService } from 'src/app/services/automation.service';
import { LogMessage } from 'src/app/utils/log-message';

@Component({
  selector: 'app-diagnostics',
  templateUrl: './diagnostics.component.html',
  styleUrls: ['./diagnostics.component.css']
})
export class DiagnosticsComponent {

	allMessages: LogMessage[] = [];
	allShipSymbols: string[] = [];
	showShip: { shipSymbol: string, value: boolean }[] = [];
    singleValue = '';

	constructor(public automationService: AutomationService) {
		automationService.messageSubject.subscribe((message) => {
			this.allMessages.push(message);
			const ship = message.shipSymbol.replace('BLACKRAT-', '');
			if (!this.allShipSymbols.includes(ship)) {
				this.allShipSymbols.push(ship);
				this.allShipSymbols.sort();
				this.showShip.push({shipSymbol: ship, value: true});
				this.showShip.sort((a, b) => {
					if (a.shipSymbol.length < b.shipSymbol.length) return -1;
					if (a.shipSymbol.length > b.shipSymbol.length) return 1;
					if (a.shipSymbol < b.shipSymbol) return -1;
					if (a.shipSymbol > b.shipSymbol) return 1;
					return 0;
				});
				this.showShip = [...this.showShip];
			}
		});
	}
    
	showMessage(message: LogMessage) {
		if (this.showShip.some((ss) => ss.value)) {
			for (const show of this.showShip) {
				if (('BLACKRAT-' + show.shipSymbol == message.shipSymbol) ||
				     (show.shipSymbol == message.shipSymbol)) {
					return show.value;
				}
			}
		}
		return true;
	}
	onClear() {
		this.allMessages.length = 0;
	}
}
