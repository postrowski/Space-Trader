import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WaypointBaseComponent } from './waypoint-base.component';

describe('ShipNavRouteWaypointComponent', () => {
  let component: WaypointBaseComponent;
  let fixture: ComponentFixture<WaypointBaseComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [WaypointBaseComponent]
    });
    fixture = TestBed.createComponent(WaypointBaseComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
