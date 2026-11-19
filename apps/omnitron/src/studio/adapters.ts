import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { ExecutionEngine } from '@xec-sh/core';
import type { StudioFailure, StudioProvider, StudioResult, StudioTask } from '../shared/dto/studio.js';
import {
  selectStudioModel,
  studioCatalogFromListing,
  studioUsageReport,
  type StudioModelCatalog,
  type StudioUsageReport,
} from '../shared/dto/studio-policy.js';

const agentEnv = () =>
  Object.fromEntries(
    ['HOME', 'USERPROFILE', 'PATH', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'LANG', 'LC_ALL', 'SSL_CERT_FILE'].flatMap(
      (key) => (process.env[key] ? [[key, process.env[key]!]] : [])
    )
  );
const engine = () =>
  new ExecutionEngine({
    defaultShell: false,
    quiet: true,
    enableEvents: false,
    retry: { retries: 0 },
    preferLocal: false,
  });
const safeId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(id);
const codexPrivacy = [
  '--ignore-user-config',
  '--ignore-rules',
  '--disable',
  'shell_tool',
  '--disable',
  'unified_exec',
  '--sandbox',
  'read-only',
  '--skip-git-repo-check',
  '--json',
];
const agyPrivacy = [
  '--sandbox',
  '--mode',
  'plan',
  '--settings',
  JSON.stringify({ toolPermission: 'strict', allowNonWorkspaceAccess: false }),
  '--disable-slash-commands',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
];

export async function studioCatalog(
  provider: StudioProvider,
  executable: string,
  cwd: string,
  policyFile?: string
): Promise<StudioModelCatalog> {
  const executor = engine();
  try {
    const result = await executor.execute({
      command: executable,
      args: provider === 'agy' ? ['models'] : ['debug', 'models'],
      cwd,
      shell: false,
      env: agentEnv(),
      envMode: 'replace',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 40_000,
      nothrow: true,
    });
    if (result.exitCode !== 0)
      throw Error(
        `The installed ${provider} CLI could not list models. Select a supported executable with --binary and check its local login.`
      );
    const listing: { id: string; label: string }[] =
      provider === 'agy'
        ? result.stdout
            .split(/\r?\n/)
            .filter((s) => s.includes('\t'))
            .map((s) => {
              const [id, ...rest] = s.split('\t');
              return { id: id!.trim(), label: rest.join(' ').trim() };
            })
        : (JSON.parse(result.stdout).models as { slug: string; display_name: string; visibility: string }[])
            .filter((m) => m.visibility === 'list')
            .map((m) => ({ id: m.slug, label: m.display_name }));
    if (!listing.length || listing.length > 512 || listing.some((m) => !safeId(m.id) || !m.label))
      throw Error('The provider returned an invalid model catalog');
    const catalog = studioCatalogFromListing(provider, provider, 'local', listing);
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
  } finally {
    await executor.dispose();
  }
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
  result?: { status?: string; response?: string; conversation_id?: string; usage?: ProviderUsage };
  item?: { type?: string; phase?: string; text?: string };
  usage?: ProviderUsage;
}
const usageReport = (usage: ProviderUsage | undefined) =>
  studioUsageReport({
    inputTokens: usage?.input_tokens ?? null,
    outputTokens: usage?.output_tokens ?? null,
    totalTokens: usage?.total_tokens ?? null,
  });
export function readStudioEvent(provider: StudioProvider, state: StudioStream, event: ProviderEvent): void {
  if (provider === 'agy') {
    if (event.event === 'init') {
      if (event.init?.permission_mode !== 'strict') throw Error('The adapter did not confirm strict tool permissions');
      state.verified = true;
      state.conversation = event.conversation_id ?? event.init?.conversation_id ?? null;
    }
    if (event.event === 'step_update' && event.step_update?.step_type === 'agent_response')
      state.answer += typeof event.step_update.text_delta === 'string' ? event.step_update.text_delta : '';
    if (event.event === 'result') {
      if (!state.verified || event.result?.status !== 'SUCCESS') {
        state.failure = 'provider';
        return;
      }
      state.answer = event.result.response ?? '';
      state.conversation = event.result.conversation_id ?? null;
      state.completed = true;
      state.usage = usageReport(event.result.usage);
    }
  } else {
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
  preview: (value: string) => void
): Promise<StudioResult> {
  const { model } = task;
  if (!safeId(model) || (task.conversation !== null && !safeId(task.conversation)))
    throw Error('Invalid provider identity');
  const prompt = task.instructions + '\nUse only the material in the conversation.\n\n' + task.prompt;
  const args =
    provider === 'agy'
      ? [...agyPrivacy, '--model', model, ...(task.conversation ? ['--conversation', task.conversation] : [])]
      : [
          '-a',
          'never',
          'exec',
          ...codexPrivacy,
          '--model',
          model,
          ...(task.conversation ? ['resume', task.conversation] : []),
          '-',
        ];
  const input = provider === 'agy' ? JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n' : prompt;
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
    readStudioEvent(provider, state, JSON.parse(line));
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
  const executor = engine();
  const deadline = AbortSignal.timeout(180_000);
  try {
    const result = await executor.execute({
      command: executable,
      args,
      stdin: input,
      stdout: sink,
      env: agentEnv(),
      envMode: 'replace',
      cwd,
      shell: false,
      detached: process.platform !== 'win32',
      signal: AbortSignal.any([signal, stop.signal, deadline]),
      maxBuffer: 2 * 1024 * 1024,
      nothrow: true,
    });
    if (
      result.exitCode !== 0 ||
      state.failure ||
      !state.verified ||
      !state.completed ||
      !state.answer.trim() ||
      !safeId(state.conversation) ||
      (task.conversation && task.conversation !== state.conversation)
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
    await executor.dispose();
  }
}
