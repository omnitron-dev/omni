import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lumen-mcp-stdio-')); roots.push(root);
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'public guide.md'), '---\nid: public-guide\nslug: /guide\n---\n# Public guide\n\nA searchable needle in the body.\n\n:::note{access="confidential"}\nHIDDEN_SECTION_CANARY\n:::\n');
  writeFileSync(join(root, 'docs', 'secret.md'), '---\naccess: confidential\n---\n# Private\nHIDDEN_DOCUMENT_CANARY');
  const cli = new URL('../src/cli/index.ts', import.meta.url).href;
  // An external process fixture, deliberately outside an ESM package boundary.
  const entry = join(root, 'entry.mjs');
  writeFileSync(entry, `import { runLumenCli } from ${JSON.stringify(cli)};
try { await runLumenCli(['mcp', '--stdio', '--root', ${JSON.stringify(root)}]); }
catch (error) { console.error(error.message); process.exitCode = 1; }
`);
  return { root, args: ['--import', import.meta.resolve('tsx'), entry] };
}

it('serves the public projection through an actual official stdio client', async () => {
  const { root, args } = fixture();
  const client = new Client({ name: 'lumen-stdio-acceptance', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args, cwd: root, stderr: 'pipe',
    env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), NODE_ENV: 'test', VITEST: '1' } });
  try {
    await client.connect(transport);
    const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
    expect(client.getServerVersion()).toMatchObject({ name: '@omnitron-dev/lumen', version });
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['search_corpus', 'get_document', 'lumen_inspect_ast']);
    const resources = await client.listResources();
    expect(resources.resources.map(resource => resource.uri)).toEqual(['lumen://corpus/docs/public%20guide.md']);
    const read = await client.readResource({ uri: resources.resources[0]!.uri });
    expect(JSON.stringify(read)).toContain('searchable needle');
    expect(JSON.stringify(read)).not.toContain('HIDDEN_');
    const search = await client.callTool({ name: 'search_corpus', arguments: { query: 'needle', limit: 1 } });
    expect(search.structuredContent).toMatchObject({ results: [{ path: 'docs/public guide.md' }] });
    const absent = await client.callTool({ name: 'search_corpus', arguments: { query: 'HIDDEN_' } });
    expect(absent.structuredContent).toEqual({ results: [] });
    const inspect = await client.callTool({ name: 'lumen_inspect_ast', arguments: { docId: 'docs/public guide.md' } });
    expect(inspect.structuredContent).toMatchObject({ type: 'doc', docId: 'docs/public guide.md' });
    expect(JSON.stringify(inspect)).not.toContain('HIDDEN_');
    const denied = await client.callTool({ name: 'get_document', arguments: { path: 'docs/secret.md' } });
    expect(denied.structuredContent).toEqual({ path: 'docs/secret.md', content: null });
    const forged = await client.callTool({ name: 'get_document', arguments: { path: 'docs/secret.md', roles: ['admin'] } });
    expect(forged.isError).toBe(true);
    expect(JSON.stringify(forged)).not.toContain('HIDDEN_DOCUMENT_CANARY');
    await expect(client.readResource({ uri: 'lumen://corpus/docs/secret.md' })).rejects.toThrow();
  } finally { await client.close(); }
});

it('keeps every stdout line valid protocol JSON and ends when stdin closes', async () => {
  const { args } = fixture();
  const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  try {
    const reply = new Promise<void>((resolve, reject) => {
      child.stdout.on('data', () => { if (stdout.includes('\n')) resolve(); });
      child.once('exit', code => reject(new Error(`Exited before reply ${code}: ${stderr}`)));
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'stdout-audit', version: '1' },
    } }) + '\n');
    await reply;
    child.stdin.end();
    const [code] = await once(child, 'exit', { signal: AbortSignal.timeout(15000) });
    expect(code, stderr).toBe(0);
    const lines = stdout.trim().split('\n').map(line => JSON.parse(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: '@omnitron-dev/lumen' } } });
    expect(stderr).toContain('command: mcp');
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit', { signal: AbortSignal.timeout(15000) }); } }
});

it('closes an oversized unterminated frame without waiting for its newline or EOF', async () => {
  const { args } = fixture();
  const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  child.stdin.on('error', () => { /* Transport closes the pipe on refusal. */ });
  try {
    for (let chunk = 0; chunk < 16; chunk++) child.stdin.write(Buffer.alloc(65536, 32));
    child.stdin.write('x');
    const [code] = await once(child, 'exit', { signal: AbortSignal.timeout(15000) });
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('ReadBuffer exceeded maximum size of 1048576 bytes');
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit', { signal: AbortSignal.timeout(15000) }); } }
});
