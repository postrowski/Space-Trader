import { Injectable } from '@angular/core';
import { LocXY } from 'src/models/LocXY';
import { Ship } from 'src/models/Ship';
import { System } from 'src/models/System';
import { UiWaypoint } from '../utils/ui-waypoint';
import { DBService } from './db.service';

interface ScheduledEvent {
	callback: () => void;
	time?: number;
	conditions?: () => boolean;
}

@Injectable({
	providedIn: 'root',
})
export class EventQueueService {
	private events: ScheduledEvent[] = [];
	private eventPumpInterval: any = null;
	private framesPerSecond = 10;

	constructor(public dbService: DBService) { }

	// Method to register an event to be executed at a specific time
	scheduleEvent(callback: () => void, timeStr: string): void {
		const time = new Date(timeStr).getTime();
		this.events.push({ callback, time });
	    this.startEventPump(); // Start the event pump if not already running
    }

	// Method to register an event to be executed when conditions are met
	scheduleEventWithConditions(
		callback: () => void,
		conditions: () => boolean
	): void {
		this.events.push({ callback, conditions });
	    this.startEventPump(); // Start the event pump if not already running
	}

	// Method to update a changing value every second
	trackMovement(ship: Ship, withinSystem: System | null, callback: (system: string, value: LocXY) => void, onCompleteCallback: (ship: Ship, loc: LocXY) => void): void {
		const departure = new Date(ship.nav.route.departureTime);
		const arrival = new Date(ship.nav.route.arrival);
		const totalTripDurationMilliseconds = (arrival.getTime() - departure.getTime());
		let departureLoc: LocXY = ship.nav.route.origin;
		let destinationLoc: LocXY  = ship.nav.route.destination;
		const departureSystemSymbol = ship.nav.route.origin.systemSymbol; 
		const destinationSytemSymbol = ship.nav.route.destination.systemSymbol; 
		if (withinSystem) {
			const uiWaypoints = UiWaypoint.getUiWaypointsFromSystem(withinSystem);
			for (let uiWaypoint of uiWaypoints) {
				if (uiWaypoint.base.symbol == ship.nav.route.origin.symbol) {
					departureLoc = uiWaypoint.loc;
				}
				if (uiWaypoint.base.symbol == ship.nav.route.destination.symbol) {
					destinationLoc = uiWaypoint.loc;
				}
			}
		}
		const movementTracker = setInterval(() => {
			const now = Date.now();
			const tripDurationSoFarMilliseconds = (now - departure.getTime());
			let percentComplete = 1.0;
			if (totalTripDurationMilliseconds > 0) {
				percentComplete = 1.0 * tripDurationSoFarMilliseconds / totalTripDurationMilliseconds;
				if (percentComplete > 1) {
					percentComplete = 1;
				}
			}
			if (departureSystemSymbol == destinationSytemSymbol) {
				// Call the callback with the updated value
				const shipLoc = new LocXY(
					(destinationLoc.x - departureLoc.x) * percentComplete + departureLoc.x,
					(destinationLoc.y - departureLoc.y) * percentComplete + departureLoc.y
				);
				callback(departureSystemSymbol, shipLoc);
			} else {
				// Call the callback with the updated value
				this.dbService.systems.get(departureSystemSymbol).then((srcSys) => {
					this.dbService.systems.get(destinationSytemSymbol).then((destSys) =>{
						if (destSys && srcSys) {
							const shipLoc = new LocXY(
								(destSys.x - srcSys.x) * percentComplete + srcSys.x,
								(destSys.y - srcSys.y) * percentComplete + srcSys.y
							);
							callback(departureSystemSymbol, shipLoc);
						}
					});
				});
			}
			
			if (percentComplete == 1.0) {
				// We've reach the end of our movement, stop the tracker
				clearInterval(movementTracker);
				if (ship.nav.status === "IN_TRANSIT") {
					ship.nav.status = "IN_ORBIT";
					ship.nav.waypointSymbol = ship.nav.route.destination.symbol;
					ship.nav.systemSymbol = ship.nav.route.destination.systemSymbol;
				}
				if (onCompleteCallback) {
					onCompleteCallback(ship, destinationLoc);
				}
			}
		}, 1000/this.framesPerSecond);
	}

	// Method to start the event pump
	private startEventPump(): void {
		if (this.eventPumpInterval === null) {
			this.eventPumpInterval = setInterval(() => {
				this.processEvents();

				// If there are no more events, shut down the event pump
				if (this.events.length === 0) {
					clearInterval(this.eventPumpInterval);
					this.eventPumpInterval = null;
				}
			}, 1000); // Check every second
		}
	}
	
	// Method to process the scheduled events
	processEvents(): void {
		const currentTime = Date.now();

		for (let i = 0; i < this.events.length; i++) {
			const event = this.events[i];

			if (event.time == null || event.time <= currentTime) {
				// Check conditions if provided, and execute the callback if conditions are met
				if (!event.conditions || event.conditions()) {
					event.callback();
					this.events.splice(i, 1); // Remove the processed event from the queue
				}
			}
		}
	}
}
