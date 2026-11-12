import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { omnitronMarkSvg } from '@omnitron-dev/prism/identity';

it('the public favicon uses the same geometry and palette as the shared identity', () => {
  expect(readFileSync(new URL('../public/logo.svg', import.meta.url), 'utf8').trim()).toBe(omnitronMarkSvg);
});
