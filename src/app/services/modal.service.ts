import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { WaypointBase } from 'src/models/WaypointBase';
import { ModalComponent } from '../components/modal/modal.component';
import { GalaxyService } from './galaxy.service';

@Injectable({ providedIn: 'root' })
export class ModalService {
    private modals: ModalComponent[] = [];
    
	private waypointSubject = new BehaviorSubject<WaypointBase | null>(null);
	waypoint$: Observable<WaypointBase | null> = this.waypointSubject.asObservable();

	constructor(public galaxyService: GalaxyService) {
	}
	
    add(modal: ModalComponent) {
        // ensure component has a unique id attribute
        if (!modal.id || this.modals.find(x => x.id === modal.id)) {
            throw new Error('modal must have a unique id attribute');
        }

        // add modal to array of active modals
        this.modals.push(modal);
    }

    remove(modal: ModalComponent) {
        // remove modal from array of active modals
        this.modals = this.modals.filter(x => x === modal);
    }

    open(id: string, waypoint: WaypointBase) {
		this.waypointSubject.next(waypoint);
        // open modal specified by id
        const modal = this.modals.find(x => x.id === id);

        if (!modal) {
            throw new Error(`modal '${id}' not found`);
        }

        modal.open();
    }

    close() {
        // close the modal that is currently open
        const modal = this.modals.find(x => x.isOpen);
        modal?.close();
    }
}