import { createHash, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { openStudioMcp } from '../../src/studio/team-mcp.js';
import { readStudioEvent, runStudioTurn, studioCatalog, type StudioStream } from '../../src/studio/adapters.js';
import { checkAgyIntegrations, studioEnv, studioInvocation } from '../../src/studio/provider-cli.js';
import { handleStudioTask, serveStudioConnection } from '../../src/commands/studio.js';
import {
  STUDIO_TEAM_TOOLS,
  type IOmnitronStudioService,
  type StudioTask,
  type StudioResult,
} from '../../src/shared/dto/studio.js';
import { studioUsageReport } from '../../src/shared/dto/studio-policy.js';

const task = (prompt = 'Synthetic consultation'): StudioTask => ({
  model: 'example',
  instructions: 'Read the current team state.',
  conversation: null,
  turnId: randomUUID(),
  prompt,
  teamTools: true,
});
const stream = (): StudioStream => ({
  answer: '',
  conversation: null,
  completed: false,
  failure: null,
  usage: studioUsageReport(),
  verified: false,
});
const fixtures = () => mkdtemp(join(tmpdir(), 'studio-transport-test-'));

describe('Studio turn MCP', () => {
  it('admits the scoped bearer, validates all tool arguments, and revokes discovery and calls on cancellation', async () => {
    const stop = new AbortController();
    const calls: unknown[] = [];
    const endpoint = await openStudioMcp(stop.signal, async (name, args) => {
      calls.push({ name, args });
      if (name === 'flow_propose') throw Error('private /path/credential');
      return { name };
    });
    const client = new Client({ name: 'studio-test', version: '1' });
    const auth = { authorization: 'Bearer ' + endpoint.token };
    try {
      expect((await fetch(endpoint.url, { method: 'POST' })).status).toBe(401);
      expect(
        (await fetch(endpoint.url, { method: 'POST', headers: { ...auth, origin: 'https://other.example' } })).status
      ).toBe(403);
      const forgedHost = await new Promise<number | undefined>((resolve, reject) => {
        request(endpoint.url, { method: 'POST', headers: { ...auth, host: 'other.example' } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
          .on('error', reject)
          .end();
      });
      expect(forgedHost).toBe(403);
      expect((await fetch(endpoint.url, { method: 'POST', headers: auth, body: 'x'.repeat(200 * 1024) })).status).toBe(
        413
      );
      await client.connect(
        new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: auth } })
      );
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(STUDIO_TEAM_TOOLS);
      expect(endpoint.discovered()).toBe(true);
      const ok = await client.callTool({
        name: 'team_note',
        arguments: { key: 'result', text: 'Observed.', revision: 0 },
      });
      expect(ok.content).toMatchObject([{ type: 'text', text: '{"name":"team_note"}' }]);
      const forged = await client
        .callTool({ name: 'team_state', arguments: { connection: 'other', room: 'other' } })
        .catch((err: Error) => err);
      expect(forged instanceof Error || forged.isError).toBe(true);
      const denied = await client.callTool({ name: 'flow_propose', arguments: { definition: {} } });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied)).not.toContain('/path/');
      expect(calls).toEqual([
        { name: 'team_note', args: { key: 'result', text: 'Observed.', revision: 0 } },
        { name: 'flow_propose', args: { definition: {} } },
      ]);
      stop.abort();
      await endpoint.close();
      await expect(fetch(endpoint.url, { method: 'POST', headers: auth })).rejects.toThrow();
    } finally {
      await client.close();
      await endpoint.close();
    }
  });

  it('supplies provider-native MCP configuration only on opted-in turns and only passes the bearer in the child environment', async () => {
    const endpoint = await openStudioMcp(new AbortController().signal, async () => ({}));
    try {
      for (const provider of ['codex', 'claude'] as const) {
        const job = task();
        const cmd = studioInvocation(provider, job, endpoint);
        expect(JSON.stringify(cmd)).not.toContain(job.turnId);
        expect(JSON.stringify(cmd)).not.toContain(endpoint.token);
        expect(cmd.args.join(' ')).toContain(endpoint.url);
        expect(cmd.args.join(' ')).toContain(provider === 'codex' ? 'required=true' : '--strict-mcp-config');
        expect(studioEnv(provider, endpoint)['OMNITRON_STUDIO_MCP_TOKEN']).toBe(endpoint.token);
        expect(studioEnv(provider)['OMNITRON_STUDIO_MCP_TOKEN']).toBeUndefined();
        const plain = studioInvocation(provider, { ...job, teamTools: false });
        expect(plain.args.join(' ')).not.toContain('mcp_servers.studio');
        expect(plain.args).not.toContain('--mcp-config');
      }
      for (const provider of ['agy', 'kimi'] as const)
        expect(() => studioInvocation(provider, task(), endpoint)).toThrow();
    } finally {
      await endpoint.close();
    }
  });

  it('checks Antigravity hooks, server startup and plugins even for a strict, tool-less member', async () => {
    const dir = await fixtures();
    try {
      await checkAgyIntegrations('[]', dir);
      await writeFile(join(dir, 'hooks.json'), JSON.stringify({ audit: { enabled: false } }));
      const file = join(dir, 'mcp_config.json');
      await writeFile(file, JSON.stringify({ mcpServers: { external: { disabled: true } } }));
      await checkAgyIntegrations('[{"enabled":false}]', dir);
      await expect(checkAgyIntegrations('[{"enabled":true}]', dir)).rejects.toThrow('global hooks');
      await writeFile(file, JSON.stringify({ mcpServers: { external: { command: 'private-command' } } }));
      await expect(checkAgyIntegrations('[]', dir)).rejects.toThrow('global hooks');
      await writeFile(file, '{}');
      await writeFile(join(dir, 'hooks.json'), JSON.stringify({ export: { PreInvocation: [{}] } }));
      await expect(checkAgyIntegrations('[]', dir)).rejects.toThrow('global hooks');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')(
    'lists canonical Claude subscription models and keeps invalid CLI diagnostics private',
    async () => {
      const scratch = await fixtures();
      try {
        const binary = join(scratch, 'claude');
        await writeFile(
          binary,
          `#!/usr/bin/env node
const a = process.argv.slice(2);
if (a.includes('--help')) console.log('--restricted --strict-mcp-config --tools --permission-prompts --disable-slash-commands --input-format');
else if (a.includes('status')) console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',email:'private-account@example.test'}));
else {
  let data=''; process.stdin.on('data',(c)=>data+=c); process.stdin.on('end',()=>{
    const msg=JSON.parse(data);
    if (msg.type!=='control_request' || msg.request.subtype!=='initialize') process.exit(1);
    const model={resolvedModel:'chosen-model-v3',displayName:'Selected model'};
    console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:msg.request_id,
      response:{models:[{...model,value:'default'},{...model,value:'alias'},{...model,value:'other-alias'}]}}}));
  });
}
`,
          { mode: 0o700 }
        );
        const catalog = await studioCatalog('claude', binary, scratch);
        expect(catalog.teamTools).toBe(true);
        expect(catalog.models.map((m) => m.id)).toEqual(['chosen-model-v3']);
        expect(JSON.stringify(catalog)).not.toContain('private-account');
        await writeFile(
          binary,
          "#!/usr/bin/env node\nconsole.error('private-account@example.test'); process.exit(1);\n",
          { mode: 0o700 }
        );
        await expect(studioCatalog('claude', binary, scratch)).rejects.toThrow('required isolation flags');
        await expect(studioCatalog('kimi', binary, scratch)).rejects.toThrow('Kimi execution is unavailable');
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    }
  );

  it('accepts only Claude init receipts for the chosen model and exact toolset, then records the final public answer', () => {
    const id = randomUUID();
    const init = {
      type: 'system',
      subtype: 'init',
      permissionMode: 'dontAsk',
      model: 'example',
      session_id: id,
      tools: STUDIO_TEAM_TOOLS.map((n) => 'mcp__studio__' + n),
      mcp_servers: [{ name: 'studio', status: 'connected' }],
    };
    expect(() =>
      readStudioEvent('claude', stream(), { ...init, tools: [...init.tools, 'Bash'] }, true, 'example')
    ).toThrow();
    expect(() => readStudioEvent('claude', stream(), init, true, 'changed')).toThrow();
    const state = stream();
    readStudioEvent('claude', state, init, true, 'example');
    readStudioEvent('claude', state, {
      type: 'result',
      subtype: 'success',
      result: 'Public answer',
      session_id: id,
      usage: { input_tokens: 12, output_tokens: 3 },
    });
    expect(state).toMatchObject({
      answer: 'Public answer',
      conversation: id,
      verified: true,
      completed: true,
      usage: { inputTokens: 12, outputTokens: 3 },
    });
  });

  it.skipIf(process.platform === 'win32')(
    'resumes a Claude session after an interrupted connector left its private working directory',
    async () => {
      const scratch = await fixtures();
      const session = randomUUID();
      const dir = join(tmpdir(), 'omnitron-studio-claude-' + createHash('sha256').update(session).digest('hex'));
      const job = { ...task(), conversation: session, teamTools: false };
      const results: StudioResult[] = [];
      const service = {
        async heartbeat() {
          return { active: true };
        },
        async teamTool() {
          throw Error('Unexpected tool call');
        },
        async finishTurn(data) {
          results.push(data.result);
        },
      } satisfies Pick<IOmnitronStudioService, 'heartbeat' | 'teamTool' | 'finishTurn'>;
      const binary = join(scratch, 'claude');
      const run = () =>
        handleStudioTask(service, 'connection', 'claude', binary, scratch, job, AbortSignal.timeout(5000));
      try {
        await writeFile(
          binary,
          `#!/usr/bin/env node
const a=process.argv.slice(2), id=a[a.indexOf('--resume')+1], emit=(e)=>console.log(JSON.stringify(e));
process.stdin.resume(); process.stdin.on('end',()=>{
  emit({type:'system',subtype:'init',tools:[],mcp_servers:[],permissionMode:'dontAsk',session_id:id,model:'example'});
  emit({type:'result',subtype:'success',session_id:id,result:'Resumed.'});
});\n`,
          { mode: 0o700 }
        );
        await mkdir(dir, { mode: 0o700 });
        await run();
        expect(results.at(-1)).toMatchObject({ status: 'completed', conversation: session, answer: 'Resumed.' });
        await mkdir(dir, { mode: 0o700 });
        await writeFile(join(dir, 'preserve'), 'owned by someone else');
        await run();
        expect(results.at(-1)).toMatchObject({ status: 'failed', failure: 'protocol' });
        expect(await readdir(dir)).toEqual(['preserve']);
      } finally {
        await rm(dir, { recursive: true, force: true });
        await rm(scratch, { recursive: true, force: true });
      }
    }
  );

  it.skipIf(process.platform === 'win32')(
    'dispatches two simultaneous native-CLI fixtures to different turns and removes both private working directories',
    async () => {
      const scratch = await fixtures();
      try {
        const binary = join(scratch, 'provider');
        await writeFile(
          binary,
          `#!/usr/bin/env node
(async()=>{
 const args=process.argv.slice(2);
 if (args.includes('debug')) {console.log(JSON.stringify({models:[{slug:'example',display_name:'Example',visibility:'list',tool_mode:'code_mode_only'}]}));return;}
 const file=JSON.parse(args.find(a=>a.startsWith('model_catalog_json=')).slice('model_catalog_json='.length));
 const model=JSON.parse(require('node:fs').readFileSync(file,'utf8')).models[0];
 if (!model.node_repl_disabled || model.tool_mode || model.slug!=='example') throw Error('unsafe model profile');
 const url=JSON.parse(args.find(a=>a.startsWith('mcp_servers.studio.url=')).split('=')[1]);
 const headers={authorization:'Bearer '+process.env.OMNITRON_STUDIO_MCP_TOKEN,'content-type':'application/json',accept:'application/json, text/event-stream'};
 let id=0; async function rpc(method,params) {
   const res=await fetch(url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
   const reply=await res.json(); if (!reply.result) throw Error('mock MCP failed'); return reply.result;
 }
 await rpc('initialize',{protocolVersion:'2025-11-25',clientInfo:{name:'fixture',version:'1'},capabilities:{}});
 await rpc('tools/list',{});
 const state=await rpc('tools/call',{name:'team_state',arguments:{}});
 const answer=JSON.parse(state.content[0].text).marker;
 const say=(v)=>console.log(JSON.stringify(v));
 say({type:'thread.started',thread_id:'native-'+answer});
 say({type:'item.completed',item:{type:'agent_message',text:answer}});
 say({type:'turn.completed',usage:{input_tokens:2,output_tokens:2}});
})().catch(()=>process.exit(1));
`,
          { mode: 0o700 }
        );
        const jobs = [task('one'), task('two')];
        const waiting = [...jobs];
        const stop = new AbortController();
        const guard = AbortSignal.timeout(8000);
        const tools: { turnId: string; name: string }[] = [];
        const finals = new Map<string, StudioResult>();
        let release!: () => void;
        const rendezvous = new Promise<void>((resolve) => {
          release = resolve;
        });
        const service = {
          async nextTurn() {
            return waiting.shift() ?? null;
          },
          async heartbeat() {
            return { active: true };
          },
          async teamTool(data) {
            expect(data.connection).toBe('private-connection');
            tools.push({ turnId: data.turnId, name: data.name });
            if (tools.length === 2) release();
            await rendezvous;
            return { marker: jobs.find((entry) => entry.turnId === data.turnId)?.prompt };
          },
          async finishTurn(data) {
            finals.set(data.turnId, data.result);
            if (finals.size === 2) stop.abort();
          },
        } satisfies Partial<IOmnitronStudioService>;
        await serveStudioConnection(
          service,
          'private-connection',
          'codex',
          binary,
          scratch,
          2,
          AbortSignal.any([stop.signal, guard])
        );
        expect(finals.size).toBe(2);
        for (const job of jobs)
          expect(finals.get(job.turnId)).toMatchObject({ status: 'completed', answer: job.prompt });
        expect(tools.map((call) => call.turnId).sort()).toEqual(jobs.map((job) => job.turnId).sort());
        expect(await readdir(scratch)).toEqual(['provider']);
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    }
  );
});

for (const provider of ['codex', 'claude'] as const) {
  const binary = process.env['OMNITRON_STUDIO_LIVE_TEAM_' + provider.toUpperCase()];
  it.skipIf(!binary)(
    'consults a real ' + provider + ' subscription using a synthetic MCP-only marker',
    async () => {
      const scratch = await fixtures();
      const marker = 'sample-' + randomUUID();
      let reads = 0;
      const stop = AbortSignal.timeout(120_000);
      const endpoint = await openStudioMcp(stop, async (name) => {
        if (name !== 'team_state') throw Error();
        reads++;
        return { marker };
      });
      try {
        const model = process.env['OMNITRON_STUDIO_MODEL_' + provider.toUpperCase()];
        const catalog = await studioCatalog(provider, binary!, scratch);
        expect(catalog.models.map((m) => m.id)).toContain(model);
        const job = {
          ...task('Call team_state now and report the exact synthetic marker in its result.'),
          model: model!,
        };
        const reply = await runStudioTurn(provider, binary!, scratch, job, stop, () => {}, endpoint);
        expect(reply.status).toBe('completed');
        expect(reads).toBeGreaterThan(0);
        expect(reply.status === 'completed' && reply.answer).toContain(marker);
      } finally {
        await endpoint.close();
        await rm(scratch, { recursive: true, force: true });
      }
    },
    150_000
  );
}
