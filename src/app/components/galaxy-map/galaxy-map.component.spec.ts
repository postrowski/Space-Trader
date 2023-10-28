import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GalaxyMapComponent } from './galaxy-map.component';

describe('GalaxyMapComponent', () => {
  let component: GalaxyMapComponent;
  let fixture: ComponentFixture<GalaxyMapComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [GalaxyMapComponent]
    });
    fixture = TestBed.createComponent(GalaxyMapComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
