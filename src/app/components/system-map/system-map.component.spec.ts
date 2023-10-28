import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SystemMapComponent } from './system-map.component';

describe('SystemComponent', () => {
  let component: SystemMapComponent;
  let fixture: ComponentFixture<SystemMapComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [SystemMapComponent]
    });
    fixture = TestBed.createComponent(SystemMapComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
