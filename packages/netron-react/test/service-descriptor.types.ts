import { expectTypeOf } from 'vitest';
import { ServiceDescriptor, type ServiceArguments, type ServiceResult } from '@omnitron-dev/netron-protocol';
import type { NetronClient } from '@omnitron-dev/netron-browser';
import type { NetronReactClient } from '../src/core/client.js';
import { useService } from '../src/hooks/useService.js';

interface Catalog { read(id: string, limit?: number): Promise<{ title: string }>; label: string }
const descriptor = ServiceDescriptor.of<Catalog>('Catalog', '2.0.0');

// Compile-only oracle: no network or React hook runs in this function.
export function useServiceTypeChecks(react: NetronReactClient, browser: NetronClient) {
  expectTypeOf<ServiceArguments<Catalog, 'read'>>().toEqualTypeOf<[id: string, limit?: number]>();
  expectTypeOf<ServiceResult<Catalog, 'read'>>().toEqualTypeOf<{ title: string }>();
  expectTypeOf(react.invoke(descriptor, 'read', ['guide'])).toEqualTypeOf<Promise<{ title: string }>>();
  expectTypeOf(browser.invoke(descriptor, 'read', ['guide'])).toEqualTypeOf<Promise<{ title: string }>>();
  expectTypeOf(react.service(descriptor).read.call('guide')).toEqualTypeOf<Promise<{ title: string }>>();
  expectTypeOf(useService(descriptor).read.useQuery(['guide']).data).toEqualTypeOf<{ title: string } | undefined>();
  // @ts-expect-error Method names come from the shared interface.
  void react.invoke(descriptor, 'missing', []);
  // @ts-expect-error Scalar properties cannot be invoked.
  void react.invoke(descriptor, 'label', []);
  // @ts-expect-error Argument types come from the shared interface.
  void react.invoke(descriptor, 'read', [123]);
  // @ts-expect-error Required arguments cannot be omitted.
  void browser.invoke(descriptor, 'read', []);
}
