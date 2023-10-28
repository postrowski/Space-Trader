import { TestBed } from '@angular/core/testing';

import { ExplorationService } from './exploration.service';

describe('ExplorationService', () => {
  let service: ExplorationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ExplorationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
