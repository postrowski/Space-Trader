import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, throwError, shareReplay, concatMap, map, of, timer, delay } from 'rxjs';
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
	
	token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZGVudGlmaWVyIjoiQkxBQ0tSQVQiLCJ2ZXJzaW9uIjoidjIuMS40IiwicmVzZXRfZGF0ZSI6IjIwMjMtMTItMDIiLCJpYXQiOjE3MDE1NTg1NTcsInN1YiI6ImFnZW50LXRva2VuIn0.z3g9S99epz5Jw6NOyeXp2_kie405lCvfD4hxmzw5M9LSigb7XKThmEvqYU6y0_tzOiRhkcrLQIaamfoSpR_2R_but2sB6-exeyzlHW7SDdWuBC5tatj68lov22wqY0zubvIrGm48SWF19i34BBDNLwyPRihaRjAGFGWeFgPxn9X9X09PF_YTbuWxsZBYjFPisc-pnadzRPkXGfKgKfcUifMQpSMgznPdGrzVYXIgh2GVXltH8GpMggQTzbcrKzsPvRhUxG37uNVWxSiQ1t7dmcj2WNwGtx7KlX__ctlmV1UhJoqx3GX-tlfQHt2H3NWHFVOeUmybb44VilQp-tKzbw";
	
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
				}
				this.fetchAgent();
			});
		}, (error) => {
			console.error("Error opening DB: " + error)
		});
	}
	onServerReset() {
		this.errorMessages = [];
		this.accountValid = false;
		this.agentSubject.next(null);
		this.contractSubject.next(null);
		this.factionSubject.next(null);
		this.allFactionsSubject.next([]);
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
					this.dbService.agents.add({
						agentToken: this.token,
						agentRole: 'primary'
					});
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

	getAllAgents(): Observable<Agent[]> {
		const observable = this.getAgents2(20, 1)
		      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
		}, (error) => {});
		return observable;
	}

	getAgents2(limit: number, page: number): Observable<Agent[]> {
		return this.getAgents(limit, page)
				   .pipe(concatMap((response) => {
						if (response.meta.total > limit * page) {
							// If there are more pages, recursively load them
							 return timer(400).pipe(delay(400), // Introduce a 400ms delay between requests
							                        concatMap(() => this.getAgents2(limit, page + 1)),
							                                  map((nextPageResults) => [...response.data, ...nextPageResults])
							        );
						}
						// No more pages, just return the data from this page
						return of(response.data);
					})
			);
	}
	
	getAgents(limit: number, page: number): Observable<{data:Agent[], meta: Meta}> {
		const params = {
			limit: limit,
			page: page
		}
		const observable = this.http.get<{data:Agent[], meta: Meta}>(`${this.apiUrl}/agents`, { params })
      		.pipe(shareReplay(1)); // Use the shareReplay operator so our service can subscribe, and so can the caller
		observable.subscribe((response)=> {
		}, (error) => {});
		return observable;
	}

	isFactionHQ(waypointSymbol: string) {
		for (let faction of this.allFactionsSubject.value) {
			if (faction.headquarters == waypointSymbol) {
				return true;
			}
		}
		return (this.agentSubject.value?.headquarters == waypointSymbol);
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
