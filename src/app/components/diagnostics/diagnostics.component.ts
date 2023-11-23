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
    displayMode: 'All' | 'Single' | 'Multiple' = 'All';
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
			}
		});
	}
    onDisplayModeChange(): void {
        console.log('Selected display mode:', this.displayMode);
    }
    
	showMessage(message: LogMessage) {
		if (this.displayMode == 'All') {
			return true;
		}
		if (this.displayMode == 'Multiple') {
			if (this.showShip.some((ss) => ss.value)) {
				for (const show of this.showShip) {
					if (('BLACKRAT-' + show.shipSymbol == message.shipSymbol) || (show.shipSymbol == message.shipSymbol)) {
						return show.value;
					}
				}
			}
			return true;
		}
		return ('BLACKRAT-' + this.singleValue == message.shipSymbol) || (this.singleValue == message.shipSymbol);
	}
	onClear() {
		this.allMessages.length = 0;
	}
}
