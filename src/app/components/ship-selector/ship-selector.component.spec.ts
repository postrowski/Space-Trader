import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ShipSelectorComponent } from './ship-selector.component';

describe('ShipSelectorComponent', () => {
  let component: ShipSelectorComponent;
  let fixture: ComponentFixture<ShipSelectorComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [ShipSelectorComponent]
    });
    fixture = TestBed.createComponent(ShipSelectorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
