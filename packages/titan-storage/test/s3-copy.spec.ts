import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { realS3Adapter } from './real-adapters.js';

it('sends the raw source key as an encoded S3 path in one CopyObject request', async ({ onTestFinished }) => {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.headers['x-amz-copy-source']}`);
    res.setHeader('Content-Type', 'application/xml');
    res.end('<CopyObjectResult><ETag>"copied"</ETag></CopyObjectResult>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(() => server[Symbol.asyncDispose]());
  const { port } = server.address() as AddressInfo;
  const adapter = await realS3Adapter(`http://127.0.0.1:${port}`, 'test', 'test', 'copy-test');
  onTestFinished(() => adapter.onDestroy());

  const result = await adapter.copy({ sourceKey: 'я//a b/%2F+?#.txt', destinationKey: 'copy.txt' });
  expect(result.etag).toBe('copied');
  expect(requests).toEqual(['PUT copy-test/%D1%8F//a%20b/%252F%2B%3F%23.txt']);
});
