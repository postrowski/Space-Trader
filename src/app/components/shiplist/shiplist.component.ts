import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
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
import { ShipMount } from 'src/models/ShipMount';

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
	@Input() showMine: string = 'false';
	@Input() showMount: string = 'false';
	@Input() showSurvey: string = 'false';
	@Input() showSell: string = 'false';
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
		if (sourceShipSymbol && cargoItem && this.waypoint) {
			let units = cargoItem.units;
			// Limit the number of items being sold to the max for this market.
			const marketItem = this.marketService.getItemAtMarket(this.waypoint.symbol, cargoItem.symbol);
			if (marketItem && units > marketItem.tradeVolume) {
				units = marketItem.tradeVolume;
			}
			this.marketService.sellCargo(sourceShipSymbol, cargoItem.symbol, units)
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
		this.fleetService.setActiveShip(ship);
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
		return ship?.mounts.some(mount => {return mount.symbol.startsWith('MOUNT_SURVEYOR')});
	}

	canMine(ship: Ship) {
		return ship?.mounts.some(mount => {return mount.symbol.startsWith('MOUNT_MINING_LASER')});
	}

	onMine(ship: Ship) {
		if (ship) {
			this.onMineClicked.emit(ship);
		}
	}

	onInstallMount(ship: Ship, cargoItem: ShipCargoItem) {
		if (cargoItem) {
			this.fleetService.installMount(ship.symbol, cargoItem.symbol).subscribe((response) => {
				alert("mount installed!");
			});
		}
	}
	onRemoveMount(ship: Ship, mount: ShipMount) {
		if (mount) {
			this.fleetService.removeMount(ship.symbol, mount.symbol).subscribe((response) => {
				alert("mount removed!");
			});
		}
	}
	
	selectCargoItem(item: ShipCargoItem) {
		this.selectedCargoItem = item;
	}
}
