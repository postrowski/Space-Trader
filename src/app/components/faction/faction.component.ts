import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Faction } from 'src/models/Faction';
import { AccountService } from '../../services/account.service';

@Component({
	selector: 'app-faction',
	templateUrl: './faction.component.html',
	styleUrls: ['./faction.component.css']
})
export class FactionComponent {
	@Input() faction?: Faction;
	factionSymbol: string = "COSMIC";
}
