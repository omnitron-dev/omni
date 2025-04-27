import { Test } from '@nestjs/testing';
import { Injectable } from '@nestjs/common';

import { NETRON_INSTANCE } from '../constants';
import { InjectNetron } from './inject-netron.decorator';

describe('@InjectNetron Decorator', () => {
  it('should inject Netron instance correctly', async () => {
    const mockNetronInstance = { some: 'instance' };

    @Injectable()
    class TestService {
      constructor(@InjectNetron() public readonly netron: any) { }
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        TestService,
        { provide: NETRON_INSTANCE, useValue: mockNetronInstance },
      ],
    }).compile();

    const testService = moduleRef.get(TestService);
    expect(testService.netron).toBe(mockNetronInstance);
  });
});
