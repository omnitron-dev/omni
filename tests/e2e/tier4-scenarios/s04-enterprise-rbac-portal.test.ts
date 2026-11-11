import { describe, it, expect } from 'vitest';
import { parseDocument, toHtmlSsr } from '@omnitron-dev/lumen-ast';
import { asUser, createLumenFixture } from '../../../packages/titan-lumen/tests/netron-fixture.js';

describe('Enterprise portal: authenticated read to rendered projection', () => {
  it('renders useful content without leaking confidential sections to staff or anonymous readers', async () => {
    const service = createLumenFixture({ 'architecture.pdx': [
      '---', 'title: Platform architecture', '---',
      '# Overview', 'Public topology.',
      ':::note{access="internal"}', 'Internal cluster-canary.', ':::',
      ':::note{access="confidential"}', 'Hardware signing-key-canary.', ':::',
    ].join('\n') });
    for (const token of [undefined, 'staff', 'security_officer', 'admin']) {
      const client = await asUser(service, token);
      const content = await client.getDocument('architecture.pdx');
      expect(content).not.toBeNull();
      const html = toHtmlSsr(await parseDocument(content!));
      expect(html).toContain('Public topology');
      expect(html.includes('cluster-canary')).toBe(Boolean(token));
      expect(html.includes('signing-key-canary')).toBe(token === 'security_officer' || token === 'admin');
      const hiddenSearch = await client.search('signing-key-canary');
      expect(hiddenSearch).toHaveLength(token === 'security_officer' || token === 'admin' ? 1 : 0);
    }
  });
});
