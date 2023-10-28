import { Component, Input } from '@angular/core';
import { ShipyardShip } from 'src/models/ShipyardShip';
@Component({
	selector: 'app-shipyard-ship',
	templateUrl: './shipyardShip.component.html',
	styleUrls: ['./shipyardShip.component.css']
})
export class ShipyardShipComponent {
	@Input() ship!: ShipyardShip; 
}
