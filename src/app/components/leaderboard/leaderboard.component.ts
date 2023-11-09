import { Component } from '@angular/core';
import { AccountService } from 'src/app/services/account.service';
import { Agent } from 'src/models/Agent';

@Component({
	selector: 'app-leaderboard',
	templateUrl: './leaderboard.component.html',
	styleUrls: ['./leaderboard.component.css']
})
export class LeaderboardComponent {

	agents: Agent[] = [];
	sortKey: string = ''; // Initial sorting key
	sortDirection: number = 1; // 1 for ascending, -1 for descending

	constructor(public accountService: AccountService) {
	}
	onLoad() {
		this.accountService.getAllAgents().subscribe((response) => {
			this.agents = response;
		});
	}

	sortBy(key: string) {
		if (key === this.sortKey) {
			this.sortDirection = -this.sortDirection; // Toggle sorting direction if sorting by the same key
		} else {
			this.sortKey = key;
			this.sortDirection = 1; // Default to ascending order
		}
	}
}
