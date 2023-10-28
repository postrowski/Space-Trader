import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, shareReplay } from 'rxjs';
import { Agent } from 'src/models/Agent';
import { Contract } from 'src/models/Contract';
import { Faction, FactionSymbol } from 'src/models/Faction';
import { Meta } from 'src/models/Meta';
import { Ship } from 'src/models/Ship';
import { DBService } from './db.service';

@Injectable({
	providedIn: 'root'
})
export class AccountService {
	private apiUrl = 'https://api.spacetraders.io/v2/';
	token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZGVudGlmaWVyIjoiQkxBQ0tSQVQiLCJ2ZXJzaW9uIjoidjIiLCJyZXNldF9kYXRlIjoiMjAyMy0xMC0yMSIsImlhdCI6MTY5NzkwNjcxNiwic3ViIjoiYWdlbnQtdG9rZW4ifQ.XpFjrRBcESAxsiB27SPzEkn3ukhtJomzWyhnddtujuTJyQTrXnRbuoW1P1UwruVj5Y1pu4_4381kOXvJRIFOP2Io2PHKH4z7FdTPlk5pC-LNnHIwUIN3eWbo0YPboiu9B9MRlUMG-8FGftg7AGT5u2G198M9C4e-_kNEdUMSBn3gyits3ARt0Fk5zJHt_3bk3d4ZTylxfYXlS-iAr3s4iGsy5L4UKR-iBjEnT4cunl9QFwmwcMNsmUk1RDcyu8wz_6q-oEhU6QJd8Qd_w8y5lxCo7Ub-l_JNd47eqTS-RdhSTv0hQLvKbG0dkIEDS6c8hstjP-QRGJ2zJ__UrrxAiQ";
	
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
					if (error.message.contains("Token reset_date does not match the server.")) {
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
