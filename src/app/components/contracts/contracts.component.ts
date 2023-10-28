import { Component } from '@angular/core';
import { Contract } from 'src/models/Contract';
import { ContractService } from '../../services/contract.service';

@Component({
  selector: 'app-contracts',
  templateUrl: './contracts.component.html',
  styleUrls: ['./contracts.component.css']
})
export class ContractsComponent {
	contracts: Contract[] = [];
	selectedContract?: Contract | null;
	
	constructor(public contractService: ContractService) {
		this.contractService.selectedContract$.subscribe((contract) => {
			this.selectedContract = contract;
		});
		this.contractService.allContracts$.subscribe((contracts) => {
			this.contracts = contracts;
		});
	}
	
	update() {
		this.contractService.updateContracts();
	}
	
	selectContract(contract: Contract) {
		this.contractService.setSelectedContract(contract);
	}
}
