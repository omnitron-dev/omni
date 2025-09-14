import { SERVICE_ANNOTATION } from '@omnitron-dev/netron';

import { Service } from './service.decorator';

describe('@Service Decorator', () => {
  it('should set metadata correctly', () => {
    @Service('example.service@1.0.0')
    class ExampleService {}

    const metadata = Reflect.getMetadata('NETRON_SERVICE_METADATA', ExampleService);
    expect(metadata).toBe('example.service@1.0.0');
  });

  it('should apply original Netron decorator correctly', () => {
    @Service('example.service@2.3.4')
    class ExampleService {}

    const netronMetadata = Reflect.getMetadata(SERVICE_ANNOTATION, ExampleService);

    expect(netronMetadata).toBeDefined();
    expect(netronMetadata.name).toBe('example.service');
    expect(netronMetadata.version).toBe('2.3.4');
  });
});
