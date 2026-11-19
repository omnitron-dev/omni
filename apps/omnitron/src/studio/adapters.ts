import { createHash } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import {
  discoverStudioModels,
  providerId,
  studioEnv,
  studioEngine,
  studioInvocation,
  verifyAgyProfile,
  writeCodexConsultationCatalog,
} from './provider-cli.js';
import type { StudioMcpEndpoint } from './team-mcp.js';
import { STUDIO_TEAM_TOOLS } from '../shared/dto/studio.js';
import type { StudioFailure, StudioProvider, StudioResult, StudioTask } from '../shared/dto/studio.js';
import {
  selectStudioModel,
  studioCatalogFromListing,
  studioUsageReport,
  type StudioModelCatalog,
  type StudioUsageReport,
} from '../shared/dto/studio-policy.js';

export async function studioCatalog(
  provider: StudioProvider,
  executable: string,
  cwd: string,
  policyFile?: string
): Promise<StudioModelCatalog> {
  const listing = await discoverStudioModels(provider, executable, cwd);
  const catalog = studioCatalogFromListing(provider, provider, 'local', listing);
  catalog.teamTools = provider === 'codex' || provider === 'claude';
  if (policyFile) {
    const file = await open(policyFile, 'r');
    let policy: unknown;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 256 * 1024) throw Error('Use a model policy file of up to 256 KiB');
      policy = JSON.parse(await file.readFile('utf8'));
    } finally {
      await file.close();
    }
    if (
      !Array.isArray(policy) ||
      policy.length > listing.length ||
      new Set(policy.map((m) => m?.id)).size !== policy.length
    )
      throw Error('The model policy must list each selected model once');
    for (const entry of policy) {
      const model = catalog.models.find((m) => m.id === entry?.id);
      if (
        !model ||
        !entry ||
        typeof entry !== 'object' ||
        Object.keys(entry).some(
          (k) => !['id', 'classes', 'capabilities', 'qualityTier', 'costTier', 'price'].includes(k)
        )
      )
        throw Error('The model policy contains an unlisted model or unknown field');
      for (const key of ['classes', 'capabilities', 'qualityTier', 'costTier', 'price'] as const)
        if (Object.hasOwn(entry, key)) Object.assign(model, { [key]: entry[key] });
    }
  }
  catalog.revision = createHash('sha256').update(JSON.stringify(catalog.models)).digest('hex');
  const check = selectStudioModel(catalog, {
    provider,
    connector: catalog.connector,
    requirements: {},
    model: catalog.models[0]!.id,
  });
  if (!check.ok) throw Error(check.message);
  return catalog;
}

export interface StudioStream {
  answer: string;
  conversation: string | null;
  completed: boolean;
  failure: StudioFailure | null;
  usage: StudioUsageReport;
  verified: boolean;
}

interface ProviderUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}
interface ProviderEvent {
  event?: string;
  type?: string;
  thread_id?: string;
  conversation_id?: string;
  init?: { permission_mode?: string; conversation_id?: string };
  step_update?: { step_type?: string; text_delta?: string };
  result?: string | { status?: string; response?: string; conversation_id?: string; usage?: ProviderUsage };
  subtype?: string;
  is_error?: boolean;
  session_id?: string;
  model?: string;
  tools?: string[];
  permissionMode?: string;
  mcp_servers?: { name: string; status: string }[];
  item?: { type?: string; phase?: string; text?: string };
  usage?: ProviderUsage;
}
const usageReport = (usage: ProviderUsage | undefined) =>
  studioUsageReport({
    inputTokens: usage?.input_tokens ?? null,
    outputTokens: usage?.output_tokens ?? null,
    totalTokens: usage?.total_tokens ?? null,
  });
export function readStudioEvent(
  provider: StudioProvider,
  state: StudioStream,
  event: ProviderEvent,
  team = false,
  model?: string
): void {
  if (provider === 'agy') {
    if (event.event === 'init') {
      if (event.init?.permission_mode !== 'strict') throw Error('The adapter did not confirm strict tool permissions');
      state.verified = true;
      state.conversation = event.conversation_id ?? event.init?.conversation_id ?? null;
    }
    if (event.event === 'step_update' && event.step_update?.step_type === 'agent_response')
      state.answer += typeof event.step_update.text_delta === 'string' ? event.step_update.text_delta : '';
    if (event.event === 'result') {
      if (!state.verified || !event.result || typeof event.result !== 'object' || event.result.status !== 'SUCCESS') {
        state.failure = 'provider';
        return;
      }
      state.answer = event.result.response ?? '';
      state.conversation = event.result.conversation_id ?? null;
      state.completed = true;
      state.usage = usageReport(event.result.usage);
    }
  } else if (provider === 'claude') {
    if (event.type === 'system' && event.subtype === 'init') {
      const permitted = team ? STUDIO_TEAM_TOOLS.map((n) => 'mcp__studio__' + n) : [];
      if (
        event.permissionMode !== 'dontAsk' ||
        !Array.isArray(event.tools) ||
        event.tools.length !== permitted.length ||
        !permitted.every((n) => event.tools!.includes(n)) ||
        !Array.isArray(event.mcp_servers) ||
        event.mcp_servers.length !== (team ? 1 : 0) ||
        (team && !event.mcp_servers.some((s) => s.name === 'studio' && s.status === 'connected')) ||
        event.model !== model ||
        !providerId(event.session_id)
      )
        throw Error('Claude Code did not confirm the selected model and tool restrictions');
      state.verified = true;
      state.conversation = event.session_id;
    }
    if (event.type === 'result') {
      if (
        event.subtype !== 'success' ||
        event.is_error ||
        !state.verified ||
        event.session_id !== state.conversation ||
        typeof event.result !== 'string'
      ) {
        state.failure = 'provider';
        return;
      }
      state.answer = event.result;
      state.usage = usageReport(event.usage);
      state.completed = true;
    }
  } else if (provider === 'codex') {
    if (event.type === 'thread.started') {
      state.conversation = event.thread_id ?? null;
      state.verified = true;
    }
    if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.phase !== 'commentary')
      state.answer = event.item.text ?? '';
    if (event.type === 'turn.completed') {
      state.completed = true;
      state.usage = usageReport(event.usage);
    }
    if (event.type === 'turn.failed' || event.type === 'error') state.failure = 'provider';
  }
  if (typeof state.answer !== 'string' || Buffer.byteLength(state.answer) > 128 * 1024)
    throw Error('Reply exceeds the Studio limit');
}

/** Only public response events enter the transcript. Native thread IDs never come from the browser. */
export async function runStudioTurn(
  provider: StudioProvider,
  executable: string,
  cwd: string,
  task: StudioTask,
  signal: AbortSignal,
  preview: (value: string) => void,
  endpoint?: StudioMcpEndpoint,
  initialSession?: string
): Promise<StudioResult> {
  const { args, input } = studioInvocation(provider, task, endpoint, initialSession);
  const state: StudioStream = {
    answer: '',
    conversation: null,
    completed: false,
    failure: null,
    usage: studioUsageReport(),
    verified: false,
  };
  const decoder = new StringDecoder('utf8');
  const stop = new AbortController();
  let buffered = '';
  let bytes = 0;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const old = state.answer;
    readStudioEvent(provider, state, JSON.parse(line), Boolean(endpoint), task.model);
    if (state.answer !== old) preview(state.answer);
  };
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      try {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) throw Error('Provider stream exceeded its limit');
        buffered += decoder.write(chunk);
        let newline: number;
        while ((newline = buffered.indexOf('\n')) >= 0) {
          consume(buffered.slice(0, newline));
          buffered = buffered.slice(newline + 1);
        }
        if (Buffer.byteLength(buffered) > 512 * 1024) throw Error('Provider event exceeded its limit');
      } catch {
        state.failure = 'protocol';
        stop.abort();
      }
      done();
    },
    final(done) {
      try {
        consume(buffered + decoder.end());
      } catch {
        state.failure = 'protocol';
      }
      done();
    },
  });
  const executor = studioEngine();
  const deadline = AbortSignal.timeout(180_000);
  const active = AbortSignal.any([signal, stop.signal, deadline]);
  let modelFile: string | null = null;
  try {
    if (provider === 'agy') await verifyAgyProfile(executor, executable, cwd, active);
    if (provider === 'codex') {
      modelFile = await writeCodexConsultationCatalog(executor, executable, cwd, task.model, active);
      if (!modelFile) return { status: 'failed', failure: 'model-changed' };
      args.unshift('-c', 'model_catalog_json=' + JSON.stringify(modelFile));
    }
    const result = await executor.execute({
      command: executable,
      args,
      stdin: input,
      stdout: sink,
      env: studioEnv(provider, endpoint),
      envMode: 'replace',
      cwd,
      shell: false,
      detached: process.platform !== 'win32',
      signal: active,
      maxBuffer: 2 * 1024 * 1024,
      nothrow: true,
    });
    if (
      result.exitCode !== 0 ||
      state.failure ||
      !state.verified ||
      !state.completed ||
      !state.answer.trim() ||
      !providerId(state.conversation) ||
      (endpoint && !endpoint.discovered()) ||
      ((task.conversation ?? initialSession) && (task.conversation ?? initialSession) !== state.conversation)
    )
      return {
        status: 'failed',
        failure:
          state.failure ??
          (/sign.?in|unauthori[sz]ed|authentication required/i.test(result.stderr) ? 'sign-in' : 'protocol'),
      };
    return { status: 'completed', answer: state.answer, conversation: state.conversation, usage: state.usage };
  } catch {
    return { status: 'failed', failure: state.failure ?? (deadline.aborted ? 'timeout' : 'provider') };
  } finally {
    try {
      await executor.dispose();
    } finally {
      if (modelFile) await rm(modelFile, { force: true });
    }
  }
}
