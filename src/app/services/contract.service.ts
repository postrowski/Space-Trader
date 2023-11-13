
import { HttpClient } from '@angular/common/http';
import { Injectable, OnInit } from '@angular/core';
import { BehaviorSubject, concatMap, delay, map, Observable, of, shareReplay, timer } from 'rxjs';
import { Agent } from 'src/models/Agent';
import { Contract } from 'src/models/Contract';
import { ShipCargo } from 'src/models/ShipCargo';
import { FleetService } from './fleet.service';
import { AccountService } from './account.service';
import { Meta } from 'src/models/Meta';
import { ShipCargoItem } from 'src/models/ShipCargoItem';
import { ContractDeliverGood } from 'src/models/ContractDeliverGood';

@Injectable({
	providedIn: 'root'
})
export class ContractService implements OnInit {

    private apiUrlMyContracts = 'https://api.spacetraders.io/v2/my/contracts';
	private apiUrlMyShips = 'https://api.spacetraders.io/v2/my/ships';

	private allContractsSubject = new BehaviorSubject<Contract[]>([]);
	allContracts$: Observable<Contract[]> = this.allContractsSubject.asObservable();

	private selectedContractSubject = new BehaviorSubject<Contract | null>(null);
	selectedContract$: Observable<Contract | null> = this.selectedContractSubject.asObservable();

	private acceptedContractSubject = new BehaviorSubject<Contract | null>(null);
	acceptedContract$: Observable<Contract | null> = this.acceptedContractSubject.asObservable();

	setSelectedContract(Contract: Contract) {
		this.selectedContractSubject.next(Contract);
	}

	getSelectedContract(): Contract | null {
		return this.selectedContractSubject.value;
	}
	getContracts(): Contract[] {
		return this.allContractsSubject.value;
	}

	constructor(private http: HttpClient,
				public accountService: AccountService,
	            public fleetService: FleetService) {
	}

	ngOnInit() {
		this.selectFirstContract();
	}
	selectFirstContract() {
		// Set the selectedContract to the first Contract in the list
		if (this.allContractsSubject.value.length > 0) {
			const unfulfilled = this.allContractsSubject.value.filter((c)=> !c.fulfilled);
			if (unfulfilled && unfulfilled.length > 0) {
				this.setSelectedContract(unfulfilled[0]);
			} else {
				this.setSelectedContract(this.allContractsSubject.value[0]);
			}
		}
	}
	getContractForAcceptance(contract: Contract) {
		if (contract.accepted && !contract.fulfilled) {
			this.acceptedContractSubject.next(contract);
		} else {
			const acceptedContract = this.acceptedContractSubject.getValue();
			if (acceptedContract && acceptedContract.fulfilled) {
				this.acceptedContractSubject.next(null);
			}
		}
	}
	private addContract(newContract: Contract) {
		for (let contract of this.allContractsSubject.value) {
			if (contract.id == newContract.id) {
				contract.update(newContract);
				this.getContractForAcceptance(contract);
				return;
			}
		}
		const contract = new Contract();
		contract.update(newContract);
		this.getContractForAcceptance(contract);
		this.allContractsSubject.value.push(contract);
		
		let selectedContract = this.getSelectedContract();
		if (selectedContract == null || this.getContracts().indexOf(selectedContract) == -1) {
			this.selectFirstContract();
		}
	};
	
	
	
	//////////////////////
	// Contract API Calls
	getAllContracts(): Observable<Contract[]> {
		const observable = this.getContracts2(20, 1)
		      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
		}, (error) => {});
		return observable;
	}

	getContracts2(limit: number, page: number): Observable<Contract[]> {
		return this.getContractsApi(limit, page)
				   .pipe(concatMap((response) => {
						if (response.meta.total > limit * page) {
							// If there are more pages, recursively load them
							 return timer(400).pipe(delay(400), // Introduce a 400ms delay between requests
							                        concatMap(() => this.getContracts2(limit, page + 1)),
							                                  map((nextPageResults) => [...response.data, ...nextPageResults])
							        );
						}
						// No more pages, just return the data from this page
						return of(response.data);
					})
			);
	}
	
	getContractsApi(limit: number, page: number): Observable<{data:Contract[], meta: Meta}> {
		const headers = this.accountService.getHeader();
		const params = { limit, page }
		const observable = this.http.get<{data: Contract[], meta: Meta}>(`${this.apiUrlMyContracts}`, {headers, params})
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			for (const contract of response.data) {
				this.addContract(contract);
			}
		}, (error) => {});
		return observable;
	}

	negotiateContract(shipSymbol: string): Observable<{ data: {contract: Contract}}>{
		const headers = this.accountService.getHeader();
		const observable = this.http.post<{ data: {contract: Contract}}>
			(`${this.apiUrlMyShips}/${shipSymbol}/negotiate/contract`,
				{}, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			this.addContract(response.data.contract);
		}, (error) => {});
		return observable;
	}
	getContract(contractId: string) : Observable<{data: Contract}> {
		const headers = this.accountService.getHeader();
		const observable = this.http.get<{data: Contract}>(`${this.apiUrlMyContracts}/${contractId}`, {headers})
      		  .pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			this.addContract(response.data);
		}, (error) => {});
		return observable;                     
	}
	acceptContract(contractId: string) : Observable<{data: {agent: Agent, contract: Contract}}> {
		const headers = this.accountService.getHeader();
		const observable = this.http.post<{data: {agent: Agent, contract: Contract}}>
		                     (`${this.apiUrlMyContracts}/${contractId}/accept`, {}, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			this.addContract(response.data.contract);
			this.accountService.updateAgent(response.data.agent);
		}, (error) => {});
		return observable;                     
	}
	
	deliverCargo(contractId: string, shipSymbol: string, tradeSymbol: string, units: number) :
	                           Observable<{ data: {contract: Contract, cargo: ShipCargo}}> {
		const body = {shipSymbol, tradeSymbol, units};
		const headers = this.accountService.getHeader();
		const observable = this.http.post<{ data: {contract: Contract, cargo: ShipCargo}}>
		                     (`${this.apiUrlMyContracts}/${contractId}/deliver`, body, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			this.addContract(response.data.contract);
			this.fleetService.updateShipCargo(shipSymbol, response.data.cargo);
		}, (error) => {});
		return observable;
	}
	fulfillContract(contractId: string) : Observable<{data: {agent: Agent, contract: Contract}}> {
		const headers = this.accountService.getHeader();
		const observable = this.http.post<{ data: {agent: Agent, contract: Contract}}>
		                     (`${this.apiUrlMyContracts}/${contractId}/fulfill`, {}, { headers })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			this.addContract(response.data.contract)
			this.accountService.updateAgent(response.data.agent);
		}, (error) => {});
		return observable;                     
	}

	static getContractDeliverable(tradeSymbol: string, contract: Contract): ContractDeliverGood | null {
		for (let goods of contract.terms.deliver) {
			if (goods.tradeSymbol == tradeSymbol) {
				const remainingUnits = goods.unitsRequired - goods.unitsFulfilled;
				if (remainingUnits > 0) {
					return goods;
				}
			}
		}
		return null;
	}

}
