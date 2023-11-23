import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Survey } from 'src/models/Survey';
import { WaypointBase } from 'src/models/WaypointBase';

@Injectable({
	providedIn: 'root'
})
export class SurveyService {

	private allSurveysSubject = new BehaviorSubject<Survey[]>([]);
	allSurveys$: Observable<Survey[]> = this.allSurveysSubject.asObservable();

	selectedSurvey: Survey | null = null;

	constructor() { }

	onServerReset() {
		this.allSurveysSubject.next([]);
		this.selectedSurvey = null;
	}

	deleteSurvey(survey: Survey) {
		const index = this.allSurveysSubject.value.indexOf(survey);
		if (index != -1) {
		    const currentSurveys = this.allSurveysSubject.value.slice();
		    currentSurveys.splice(index, 1);
		    this.allSurveysSubject.next(currentSurveys);
			if (survey == this.selectedSurvey) {
				this.selectedSurvey = null;
			}
		}
	}

	addSurvey(survey: Survey) {
		this.startTimeBySurvey.set(survey, new Date().toISOString());
	    const updatedSurveys = [...this.allSurveysSubject.value, survey];
	    this.allSurveysSubject.next(updatedSurveys);
		this.expireSurveys();
	}

	getSurveysForWaypoint(waypoint: WaypointBase): Survey[] {
		return this.allSurveysSubject.value.filter((survey) => survey.symbol == waypoint.symbol);
	}
	
	getStartTime(survey: Survey) {
		return this.startTimeBySurvey
	}
	public startTimeBySurvey = new Map<Survey, string>();

	private expiryInterval: any;
	private expireSurveys() {
		this.allSurveysSubject.value.sort((s1, s2) => {
			return new Date(s1.expiration).getTime() - new Date(s2.expiration).getTime();
		});
		while (this.allSurveysSubject.value.length) {
			const nextSurvey = this.allSurveysSubject.value[0];
			const millisTillNext = new Date(nextSurvey.expiration).getTime() - Date.now();
			if (millisTillNext <= 0) {
				if (nextSurvey == this.selectedSurvey) {
					this.selectedSurvey = null;
				}
				this.startTimeBySurvey.delete(nextSurvey);
				this.allSurveysSubject.value.shift();
			} else {
				if (this.expiryInterval) {
					clearInterval(this.expiryInterval);
				}
				this.expiryInterval = setInterval(() => {
					this.expireSurveys()
				}, millisTillNext);
				break;
			}
		}
	}

}
