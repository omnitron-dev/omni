import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { STUDIO_PROVIDERS, STUDIO_ROLES } from '../shared/dto/studio-policy.js';
import { STUDIO_TEAM_TOOLS, type StudioTeamTool } from '../shared/dto/studio.js';

const id = z.string().min(1).max(128);
const text = z
  .string()
  .min(1)
  .max(32 * 1024);
const requestId = z.uuid().optional();
const object = z.record(z.string(), z.unknown());

const definitions = {
  team_state: [
    'Read the team roster, assignments, shared notes and messages. Supply a turn to read its result.',
    { turnId: id.optional() },
  ],
  team_catalog: ['List the approved providers and models available to this room.', {}],
  team_invite: [
    'Invite a specialist under the team budget. The lead selects a role and may select a provider and model.',
    {
      name: z.string().min(1).max(80),
      role: z.enum(STUDIO_ROLES),
      provider: z.enum(STUDIO_PROVIDERS).optional(),
      model: id.optional(),
      requestId,
    },
  ],
  team_assign: [
    'As team lead, give a member a task and return its tracked assignment.',
    { memberId: id, task: text, requestId },
  ],
  team_note: [
    'Write a shared room note using its current revision. Use revision 0 to create a note.',
    {
      key: id,
      text,
      revision: z.number().int().nonnegative(),
      requestId,
    },
  ],
  team_message: ['Send a message to a named member of this room.', { memberId: id, text, requestId }],
  flow_catalog: ['Read the declared dataflow nodes and connection types for this project.', {}],
  flow_preview: [
    'Validate a flow definition and preview it against one supplied sample event.',
    { definition: object, event: object },
  ],
  flow_propose: [
    'As team lead, save a draft flow definition in this room for operator review.',
    { definition: object, requestId },
  ],
} satisfies Record<StudioTeamTool, [string, z.ZodRawShape]>;

type Invoke = (name: StudioTeamTool, args: Record<string, unknown>) => Promise<unknown>;
export interface StudioMcpEndpoint {
  url: string;
  token: string;
  discovered(): boolean;
  close(): Promise<void>;
}

const maxRequestBytes = 192 * 1024;

/** A per-turn MCP listener. The Netron connection and the bound turn stay inside invoke. */
export async function openStudioMcp(signal: AbortSignal, invoke: Invoke): Promise<StudioMcpEndpoint> {
  signal.throwIfAborted();
  const token = randomBytes(32).toString('base64url');
  const authorization = Buffer.from('Bearer ' + token);
  const stop = new AbortController();
  const active = AbortSignal.any([signal, stop.signal]);
  let listed = false;

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const host = '127.0.0.1:' + req.socket.localPort;
    const reject = (code: number) => {
      res.writeHead(code).end();
    };
    if (
      req.socket.remoteAddress !== '127.0.0.1' ||
      req.headers.host !== host ||
      (req.headers.origin !== undefined && req.headers.origin !== 'http://' + host)
    )
      return reject(403);
    if (req.url !== '/mcp') return reject(404);
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (supplied.length !== authorization.length || !timingSafeEqual(authorization, supplied)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return reject(401);
    }
    if (active.aborted) return reject(410);
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return reject(405);
    }
    if (Number(req.headers['content-length']) > maxRequestBytes) return reject(413);
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of req) {
      received += chunk.length;
      if (received > maxRequestBytes) return reject(413);
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string' && (key === 'accept' || key === 'content-type' || key.startsWith('mcp-')))
        headers.set(key, value);
    }
    const mcp = new McpServer({ name: 'studio', version: '1.0' }, { maxToolInputElements: 4096 });
    for (const name of STUDIO_TEAM_TOOLS) {
      const [description, properties] = definitions[name];
      mcp.registerTool(name, { description, inputSchema: z.strictObject(properties) }, async (args) => {
        try {
          active.throwIfAborted();
          const result = await invoke(name, args);
          active.throwIfAborted();
          return { content: [{ type: 'text', text: JSON.stringify(result ?? null) }] };
        } catch {
          // Netron errors can contain private workspace, session and transport identifiers.
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'Studio declined the operation. Read the current room state and check the assignment and arguments.',
              },
            ],
          };
        }
      });
    }
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: maxRequestBytes,
    });
    await mcp.connect(transport);
    try {
      const response = await transport.handleRequest(
        new Request('http://' + host + '/mcp', {
          method: 'POST',
          headers,
          body,
          signal: active,
        })
      );
      const payload = await response.text();
      if (response.ok && payload && (JSON.parse(payload) as { result?: { tools?: unknown } }).result?.tools)
        listed = true;
      res.writeHead(response.status, Object.fromEntries(response.headers)).end(payload);
    } finally {
      await mcp.close();
    }
  }

  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 10_000, headersTimeout: 5000 }, (req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    });
  });
  server.maxConnections = 12;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw Error('Studio MCP listener unavailable');
  }
  let closing: Promise<void> | undefined;
  const close = () => {
    if (!closing) {
      stop.abort();
      closing = new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      signal.removeEventListener('abort', onAbort);
    }
    return closing;
  };
  const onAbort = () => {
    void close();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) {
    await close();
    signal.throwIfAborted();
  }
  return { url: 'http://127.0.0.1:' + address.port + '/mcp', token, discovered: () => listed, close };
}
