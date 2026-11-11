import { describe, it, expect } from 'vitest';
import { asUser, createLumenFixture } from '../../../packages/titan-lumen/tests/netron-fixture.js';

describe('Native Netron identity and shared document policy', () => {
  it('applies configured document grants without trusting role claims in RPC arguments', async () => {
    const service = createLumenFixture({
      'public.pdx': '# Public\nCorpus public.',
      'internal.pdx': '---\naccess: internal\n---\n# Internal\nCorpus internal.',
      'secret.pdx': '---\naccess: confidential\n---\n# Secret\nCorpus confidential.',
    }, { accessFilter: { grants: {
      anonymous: ['docs.read.public'], staff: ['docs.read.public'],
      security_officer: ['docs.read.*'], admin: ['*'],
    } } });
    for (const token of [undefined, 'staff', 'security_officer', 'admin']) {
      const client = await asUser(service, token);
      const expected = token === 'admin' || token === 'security_officer'
        ? ['internal.pdx', 'public.pdx', 'secret.pdx'] : ['public.pdx'];
      const results = await Reflect.apply(client.search, client, ['Corpus', { filter: { roles: ['admin'] } }]);
      expect(results.map((hit: { path: string }) => hit.path).sort()).toEqual(expected);
      expect(await client.getDocument('secret.pdx') !== null).toBe(expected.length === 3);
    }
    const staff = await asUser(service, 'staff');
    await expect(staff.executePlayground('42')).rejects.toMatchObject({ code: 403 });
    const admin = await asUser(service, 'admin');
    expect(await admin.executePlayground('42')).toMatchObject({ result: 42 });
  });
});
