import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SystemWaypointComponent } from './system-waypoint.component';

describe('SystemWaypointComponent', () => {
  let component: SystemWaypointComponent;
  let fixture: ComponentFixture<SystemWaypointComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [SystemWaypointComponent]
    });
    fixture = TestBed.createComponent(SystemWaypointComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
