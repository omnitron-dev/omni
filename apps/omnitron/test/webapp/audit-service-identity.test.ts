import { describe, expect, it } from 'vitest';
import { actorWords } from '../../webapp/src/utils/audit-actor.js';

describe('audit service identity', () => {
  it('retains the principal kind beside a named subject', () => {
    expect(actorWords('master-control', 'service')).toMatchObject({ text: 'service: master-control', title: 'service: master-control' });
  });
  it('does not confuse a service subject with the trusted Unix caller', () => {
    expect(actorWords('omnitron-local', 'service').text).toBe('service: omnitron-local');
    expect(actorWords('omnitron-local', 'user').text).toBe('omnitron-local');
  });
  it('keeps the full identity in the tooltip when shortening a UUID', () => {
    const id = '019f2601-d65d-7b0b-9395-1f0d29385b1d';
    expect(actorWords(id, 'service')).toMatchObject({ text: 'service: 019f2601…', title: `service: ${id}` });
  });
});
