import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, throwError, shareReplay } from 'rxjs';
import { Agent } from 'src/models/Agent';
import { Contract } from 'src/models/Contract';
import { Faction } from 'src/models/Faction';
import { Meta } from 'src/models/Meta';
import { Ship } from 'src/models/Ship';
import { DBService } from './db.service';

@Injectable({
	providedIn: 'root'
})
export class AccountService {
	private apiUrl = 'https://api.spacetraders.io/v2/';
	token = "";
  //token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZGVudGlmaWVyIjoiQkxBQ0tSQVQiLCJ2ZXJzaW9uIjoidjIuMS4wIiwicmVzZXRfZGF0ZSI6IjIwMjMtMTAtMjgiLCJpYXQiOjE2OTg1MTQwMzksInN1YiI6ImFnZW50LXRva2VuIn0.lHZyexTjEbauwFD5vhsOPnxlHcesyjTUuED6DZfT40LCFEVF-AoiwzvM0lhA58uDKZrb9FogGSfeCDGvdpge-M_FLSo-a3PRWWITQRGeS6460j27fR5Pv3rkTBn0DU-pbY6xS7e8b-UTvwzHBOfbAvq-4AanjPX-rOh1JKUlvbkRPfI7HedvL8EQtvZTO7a5bWKkwGs4uopLzZlcRC5Aj1WhSwiKq22mi-Hv_KlXNUeKA0L5LLzyzHUq21vx3gHd-XV2vUhD5H_793y1DLmEGi4kjtEUJYte4K1V-8sgkOGCU6do0K8lzQNXg2LMV87z_X2FP2mMZiKvRsnMHE_kuQ"
	errorMessages: string[] = [];
	accountValid = false;

	private agentSubject = new BehaviorSubject<Agent | null>(null);
	agent$: Observable<Agent | null> = this.agentSubject.asObservable();

	private contractSubject = new BehaviorSubject<Contract | null>(null);
	contract$: Observable<Contract | null> = this.contractSubject.asObservable();

	private factionSubject = new BehaviorSubject<Faction | null>(null);
	faction$: Observable<Faction| null> = this.factionSubject.asObservable();

	private allFactionsSubject = new BehaviorSubject<Faction[] >([]);
	allFactions$: Observable<Faction[]> = this.allFactionsSubject.asObservable();

	constructor(private http: HttpClient,
	            public dbService: DBService) {
		this.dbService.initDatabase().then(() => {
			this.dbService.agents.toArray().then((response) => {
				if (response && response.length > 0) {
					this.token = response[0].agentToken;
					this.fetchAgent();
				}
			});
		}, (error) => {
			console.error("Error opening DB: " + error)
		});
	}

	// Event handler to update the field with the emitted value
	updateErrorMessage(value: string) {
		if (value == '') {
			this.errorMessages.length = 0;
		} else {
			this.errorMessages.push(value);
		}
	}

	getHeader(): HttpHeaders {
		return new HttpHeaders({
			'Accept': 'application/json',
			'Content-Type': 'application/json',
			'Authorization': 'Bearer ' + this.token
		});
	}

	updateAgent(agent: Agent) {
		this.agentSubject.next(agent);
	}
	//////////////////////
	// Agent calls
	fetchAgent():Observable<{data: Agent}> {
		if (!this.token || this.token == '') {
		    // Use throwError to create an Observable that emits an error
		    return throwError('Token is empty');
		}
		let headers = this.getHeader();
		const observable = this.http.get<{data: Agent}>(this.apiUrl + 'my/agent', { headers })
		      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe(
				(response: any) => {
					this.accountValid = true;
					this.updateAgent(response.data);
				},
				(error: any) => {
					while (error.error) {
						error = error.error;
					}
					if (error.message.includes("Token reset_date does not match the server.")) {
					}
					this.accountValid = false;
				}
			);
		return observable;
	}
	registerAccount(userName: string, factionSymbol: string) {
		// Define the request body
		const requestBody = {
			symbol: userName,
			faction: factionSymbol,
			//email: 'paul_ostrowski@hotmail.com'
		};

		// Define the HTTP headers
		let headers = this.getHeader();
		headers = headers.delete('Authorization');
		headers = new HttpHeaders({
			'Accept': 'application/json',
			'Content-Type': 'application/json'
		});
		this.http
			.post<{data: {agent:Agent, contract:Contract, faction: Faction, ship: Ship, token: string}}>
			(this.apiUrl + 'register', JSON.stringify(requestBody), { headers })
			.subscribe(
				(response: any) => {
					this.updateErrorMessage(JSON.stringify(response));
					this.updateAgent(response.data.agent);
					this.contractSubject.next(response.data.contract);
					this.factionSubject.next(response.data.faction);
					this.token = response.data.token;
					this.dbService.agents.add({
						agentToken: response.data.token,
						agentRole: 'primary'
					});
				},
				(error: any) => {
				}
			);
	}

	isFactionHQ(waypointSymbol: string) {
		for (let faction of this.allFactionsSubject.value) {
			if (faction.headquarters == waypointSymbol) {
				return true;
			}
		}
		return false;
	}

	//////////////////////
	// Faction Calls
	getFaction(factionSymbol: string): Observable<{data: Faction}> {
		const headers = this.getHeader();
		return this.http.get<{data: Faction}>(`${this.apiUrl}factions/${factionSymbol}`, { headers });
	}
	getFactions(limit: number, page: number): Observable<{data: Faction[], meta: Meta}> {
		const headers = this.getHeader();
		const params = { limit, page};
		const observable = this.http.get<{data: Faction[], meta: Meta}>(`${this.apiUrl}factions`, { headers, params })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
			this.allFactionsSubject.next(response.data);
		}, (error) => {});
		return observable;
	}
}
