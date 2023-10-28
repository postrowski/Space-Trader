import { Component, Input, OnInit } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { FleetService } from 'src/app/services/fleet.service';
import { GalaxyService } from 'src/app/services/galaxy.service';
import { Ship } from 'src/models/Ship';
import { ShipCargoItem } from 'src/models/ShipCargoItem';
import { Survey } from 'src/models/Survey';
import { WaypointBase, WaypointTrait } from 'src/models/WaypointBase';
import { ModalService } from 'src/app/services/modal.service';
import { SurveyService } from 'src/app/services/survey.service';

@Component({
	selector: 'app-mine',
	templateUrl: './mine.component.html',
	styleUrls: ['./mine.component.css']
})
export class MineComponent implements OnInit {

	waypoint: WaypointBase | null = null;
	shipsAtWaypoint: Ship[] = [];
	selectedShip: Ship | null = null;
	selectedCargoItem: ShipCargoItem | null = null;
	selectedSurvey: Survey | null = null;
	allSurveys: Survey[] = [];
	waypointSurveys: Survey[] = [];

	constructor(public galaxyService: GalaxyService,
				public fleetService: FleetService,
				public surveyService: SurveyService,
				public modalService: ModalService) {
		this.modalService.waypoint$.subscribe((waypoint) => {
			this.waypoint = waypoint;
			this.waypointSurveys = this.allSurveys.filter((s)=> s.symbol === this.waypoint?.symbol);
			this.ngOnInit();
		});
		this.surveyService.allSurveys$.subscribe((surveys) => {
			this.allSurveys = surveys;
			this.waypointSurveys = this.allSurveys.filter((s)=> s.symbol === this.waypoint?.symbol);
			if (this.selectedSurvey && surveys.indexOf(this.selectedSurvey) == -1) {
				this.selectedSurvey = null;
			}
			this.ngOnInit();
		});

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
				this.fleetService.jettisonCargo(sourceShipSymbol,
					cargoItem.symbol, cargoItem.units).subscribe((response) => {
					});
			}
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
			this.fleetService.orbitShip(ship.symbol).subscribe((response) => {
			});
		}
	}

	getDepositSymbols(survey: Survey): string {
		if (!survey || !survey.deposits) {
			return '';
		}
		return survey.deposits.map((item) => item.symbol).join(', ');
	}
	onDeleteSurvey(survey: Survey) {
		this.surveyService.deleteSurvey(survey);
	}
	selectSurvey(item: Survey) {
		if (this.selectedSurvey == item) {
			this.selectedSurvey = null;
		} else {
			this.selectedSurvey = item;
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
			if (this.selectedSurvey) {
				const survey = this.selectedSurvey;
				this.fleetService.extractResourcesWithSurvey(ship.symbol, survey)
					.subscribe((response) => {});
			} else {
				this.fleetService.extractResources(ship.symbol)
					.subscribe((response) => {});
			}
		}
	}
	selectCargoItem(item: ShipCargoItem) {
		this.selectedCargoItem = item;
	}
}