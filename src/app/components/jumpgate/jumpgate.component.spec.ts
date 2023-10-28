import { ComponentFixture, TestBed } from '@angular/core/testing';

import { JumpgateComponent } from './jumpgate.component';

describe('JumpgateComponent', () => {
  let component: JumpgateComponent;
  let fixture: ComponentFixture<JumpgateComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [JumpgateComponent]
    });
    fixture = TestBed.createComponent(JumpgateComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
