import { Component, OnInit } from '@angular/core';
import { AccountService } from 'src/app/services/account.service';
import { ModalService } from 'src/app/services/modal.service';
import { Faction } from 'src/models/Faction';

@Component({
  selector: 'app-factions',
  templateUrl: './factions.component.html',
  styleUrls: ['./factions.component.css']
})
export class FactionsComponent implements OnInit{
	factions: Faction[] = [];
	selectedFaction: Faction | null = null; // Initialize selectselectedFactionedMount as null

	constructor(public accountService: AccountService) {
	}

	ngOnInit() {
		this.update();
	}
	
	update() {
		this.accountService.getFactions(20, 1).subscribe((reponse) => {
			this.factions = reponse.data.sort((f1, f2) => {
				// Compare the 'name' property of each faction:
				const name1 = f1.name.toLowerCase();
				const name2 = f2.name.toLowerCase();

				if (name1 < name2) {
					return -1;
				}
				if (name1 > name2) {
					return 1;
				}
				return 0; // Names are equal
			});

		});
	}
	onFactionSelectionChange() {
	}

	onSelectFaction(faction: Faction) {
		this.selectedFaction = faction; // Set selectedModule to the clicked module
	}

}
