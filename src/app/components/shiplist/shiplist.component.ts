import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { FleetService } from 'src/app/services/fleet.service';
import { GalaxyService } from 'src/app/services/galaxy.service';
import { Ship } from 'src/models/Ship';
import { ShipCargoItem } from 'src/models/ShipCargoItem';
import { WaypointBase } from 'src/models/WaypointBase';
import { ModalService } from 'src/app/services/modal.service';
import { SurveyService } from 'src/app/services/survey.service';
import { AccountService } from 'src/app/services/account.service';
import { Agent } from 'src/models/Agent';
import { MarketService } from 'src/app/services/market.service';

@Component({
  selector: 'app-shiplist',
  templateUrl: './shiplist.component.html',
  styleUrls: ['./shiplist.component.css']
})
export class ShiplistComponent implements OnInit {

	waypoint: WaypointBase | null = null;
	shipsAtWaypoint: Ship[] = [];
	selectedShip: Ship | null = null;
	selectedCargoItem: ShipCargoItem | null = null;
	showMine = true;
	showSurvey = true;
	showSellAll = true;
	account: Agent | null = null;

	@Output() onMineClicked: EventEmitter<Ship> = new EventEmitter<Ship>();

	constructor(public galaxyService: GalaxyService,
				public fleetService: FleetService,
	            public accountService: AccountService,
	            public marketService: MarketService,
				public surveyService: SurveyService,
				public modalService: ModalService) {
		this.modalService.waypoint$.subscribe((waypoint) => {
			this.waypoint = waypoint;
			this.ngOnInit();
		});
		this.surveyService.allSurveys$.subscribe((surveys) => {
			this.ngOnInit();
		});
		accountService.agent$.subscribe((response) => {
			this.account = response;
		})
	}

	ngOnInit(): void {
		this.loadShips();
	}

	onDrop(event: CdkDragDrop<string[]>) {
		if (event.previousContainer !== event.container) {
			// Move the item from one ship to another
			let cargoItem = event.item.data;
			let sourceShipSymbol = this.getDragShipSymbol(event, true);
			let destShipSymbol = this.getDragShipSymbol(event, false);
			if (sourceShipSymbol && destShipSymbol && cargoItem) {
				for (let destShip of this.shipsAtWaypoint) {
					if (destShip.symbol == destShipSymbol) {
						let roomOnDestShip = destShip.cargo.capacity - destShip.cargo.units;
						let units = Math.min(cargoItem.units, roomOnDestShip);
						if (units > 0) {
							this.fleetService.transferCargo(sourceShipSymbol, destShipSymbol,
								cargoItem.symbol, units).subscribe((response) => {
								});
						}
						return;
					}
				}
			}
		}
	}
	
	onDropJettison(event: CdkDragDrop<string[]>) {
		let cargoItem = event.item.data;
		let sourceShipSymbol = this.getDragShipSymbol(event, true);
		if (sourceShipSymbol && cargoItem) {
			const userResponse = confirm(`You're about to jettison ${cargoItem.units} of ${cargoItem.symbol}. Are you certain?`);
			if (userResponse) {
				this.fleetService.jettisonCargo(sourceShipSymbol, cargoItem.symbol, cargoItem.units)
				                 .subscribe((response) => {
					});
			}
		}
	}
	
	onDropSell(event: CdkDragDrop<string[]>) {
		let cargoItem = event.item.data;
		let sourceShipSymbol = this.getDragShipSymbol(event, true);
		if (sourceShipSymbol && cargoItem) {
			// TODO: how to limit the number of items being sold?
			// for example, if the item has a trade limit on it.
			this.marketService.sellCargo(sourceShipSymbol, cargoItem.symbol, cargoItem.units)
			                  .subscribe((response) => {
				}, (error) => {
					
				});
		}
	}
	
	getDragShipSymbol(event: CdkDragDrop<string[]>, source: boolean) {
		let container = source ? event.previousContainer : event.container;
		let sourceList = container.element.nativeElement;
		while (sourceList.parentElement) {
			sourceList = sourceList.parentElement;
			if (sourceList.tagName.toUpperCase() == 'TABLE') {
				let tableNode = sourceList;
				let firstRow = tableNode.firstChild;
				let firstTd = firstRow?.firstChild;
				let textNode = firstTd?.firstChild;
				return textNode?.textContent;
			}
		}
		return null;
	}

	loadShips() {
		this.fleetService.allShips$.subscribe((allShips) => {
			this.shipsAtWaypoint.length = 0;
			for (let ship of allShips) {
				if (ship.nav?.waypointSymbol == this.waypoint?.symbol) {
					this.shipsAtWaypoint.push(ship);
					if (this.selectedShip == null) {
						this.selectedShip = ship;
					}
				}
			}
			let fleetActiveShip = this.fleetService.getActiveShip();
			if (fleetActiveShip && this.shipsAtWaypoint.includes(fleetActiveShip)) {
				this.selectedShip = fleetActiveShip;
			}
		})
	}
	
	onSelectShip(ship: Ship) {
		this.selectedShip = ship;
		this.selectedCargoItem = null;
	}
	
	onOrbitShip(ship: Ship) {
		if (ship) {
			this.fleetService.orbitShip(ship.symbol)
			                 .subscribe((response) => {
										});
		}
	}
	
	onDockShip(ship: Ship) {
		if (ship) {
			this.fleetService.dockShip(ship.symbol)
			                 .subscribe((response) => {
										});
		}
	}

	onCreateSurvey(ship: Ship) {
		this.fleetService.createSurvey(ship.symbol);
	}

	canSurvey(ship: Ship) {
		if (ship) {
			for (let mount of ship.mounts) {
				if (mount.symbol.startsWith('MOUNT_SURVEYOR'))
					return true;
			}
		}
		return false;
	}

	onMine(ship: Ship) {
		if (ship) {
			this.onMineClicked.emit(ship);
		}
	}
	
	selectCargoItem(item: ShipCargoItem) {
		this.selectedCargoItem = item;
	}
}
