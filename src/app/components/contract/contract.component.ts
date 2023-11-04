import { Component, Input } from '@angular/core';
import { FleetService } from 'src/app/services/fleet.service';
import { Contract } from 'src/models/Contract';
import { ContractService } from '../../services/contract.service';
import { GalaxyService } from '../../services/galaxy.service';

@Component({
  selector: 'app-contract',
  templateUrl: './contract.component.html',
  styleUrls: ['./contract.component.css']
})
export class ContractComponent {
	@Input() contract: Contract | null = null;
	
	constructor(public galaxyService: GalaxyService,
	            public contractService: ContractService,
	            public fleetService: FleetService) {}
	onDestination(destinationSymbol: string) {
		this.galaxyService.setActiveSystemWaypointBySymbol(destinationSymbol);
	}
	
	onAcceptContract() {
		if (this.contract) {
			this.contractService.acceptContract(this.contract.id).subscribe((response) => {
				this.contract!.accepted = true;
			});
		}
	}
	onDeliver() {
		if (this.contract) {
			const ship = this.fleetService.getActiveShip();
			if (!ship) {
				return;
			}
			for (const cargo of ship.cargo.inventory) {
				if (cargo.units <= 0) {
					continue;
				}
				for (const deliverable of this.contract?.terms.deliver) {
					if (cargo.symbol !== deliverable.tradeSymbol) {
						continue;
					}
					if (ship.nav.waypointSymbol != deliverable.destinationSymbol) {
						continue;
					}
					const unitsLeft = deliverable.unitsRequired - deliverable.unitsFulfilled;
					if (unitsLeft > 0) {
						const units = Math.min(cargo.units, unitsLeft);
						this.contractService.deliverCargo(this.contract.id, ship.symbol, deliverable.tradeSymbol, units)
						                    .subscribe((response) => {
							this.contract?.update(response.data.contract);
						});
					}
					break;
				}
			}
		}
	}
	onFulfill() {
		if (this.contract) {
			this.contractService.fulfillContract(this.contract.id).subscribe((response) => {
				this.contract!.fulfilled = true;
			});
		}
	}
}
