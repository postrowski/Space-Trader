import { HttpClient } from '@angular/common/http';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DBService } from 'src/app/services/db.service';
import { Agent } from 'src/models/Agent';
import { Faction, FactionSymbol } from 'src/models/Faction';
import { AccountService } from '../../services/account.service';

@Component({
	selector: 'app-agent',
	templateUrl: './agent.component.html',
	styleUrls: ['./agent.component.css']
})

export class AgentComponent {
	agent: Agent | null = null;
	userName: string = 'Blackrat';
	factions: Faction[] = [];
	selectedFaction: Faction | undefined;

	// Define an Output property to emit an event
	@Output() updateErrorMessageEvent = new EventEmitter<string>();

	constructor(private http: HttpClient,
	            public accountService: AccountService,
	            public dbService: DBService
	            ) {
		this.accountService.agent$.subscribe((agent) => {
			this.agent = agent;
		});
		const values = Object.values(FactionSymbol);
		values.forEach((value, index) => {
			const faction: Faction = {
				symbol: value.toString(),
				name: '',
				description: '',
				headquarters: '',
				traits:  [],
				isRecruiting: true
			}
			faction.name = faction.symbol.substring(0,1) +
			               faction.symbol.substring(1).toLowerCase();
			this.factions.push(faction);
		});
	}

	handleUpdate() {
		this.accountService.fetchAgent();
	}
	onRegisterAccount() {
		if (this.selectedFaction) {
			this.accountService.registerAccount(this.userName,
			                                    this.selectedFaction.symbol);
		}
	}

	onDeleteDataBase() {
		const userResponse = confirm("Are you sure you want to reset the database?");
		if (userResponse) {
			this.dbService.deleteDatabase();
		}
	}
}
