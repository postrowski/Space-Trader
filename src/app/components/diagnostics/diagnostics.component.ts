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

	constructor(public automationService: AutomationService) {
		automationService.messageSubject.subscribe((message) => {
			this.allMessages.push(message);
			if (!this.allShipSymbols.includes(message.shipSymbol)) {
				this.allShipSymbols.push(message.shipSymbol);
				this.allShipSymbols.sort();
				this.showShip.push({shipSymbol: message.shipSymbol, value: true});
			}
		});
	}
	showMessage(message: LogMessage) {
		if (this.showShip.some((ss) => ss.value)) {
			for (const show of this.showShip) {
				if (show.shipSymbol == message.shipSymbol) {
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
