import { TestBed } from '@angular/core/testing';

import { JumpgateService } from './jumpgate.service';

describe('JumpgateService', () => {
  let service: JumpgateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(JumpgateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
