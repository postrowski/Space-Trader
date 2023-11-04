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
}