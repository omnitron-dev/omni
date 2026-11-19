import { randomUUID } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ExecutionEngine } from '@xec-sh/core';
import type { StudioProvider, StudioTask } from '../shared/dto/studio.js';
import type { StudioMcpEndpoint } from './team-mcp.js';
import { STUDIO_TEAM_TOOLS } from '../shared/dto/studio.js';

export const providerId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(id);
export const studioEngine = () =>
  new ExecutionEngine({
    defaultShell: false,
    quiet: true,
    enableEvents: false,
    retry: { retries: 0 },
    preferLocal: false,
  });

const tokenEnv = 'OMNITRON_STUDIO_MCP_TOKEN';
export function studioEnv(provider: StudioProvider, endpoint?: StudioMcpEndpoint): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [
    'HOME',
    'USERPROFILE',
    'PATH',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SystemRoot',
    'LANG',
    'LC_ALL',
    'SSL_CERT_FILE',
  ])
    if (process.env[key]) env[key] = process.env[key]!;
  if (provider === 'claude')
    Object.assign(env, {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS: '1',
      CLAUDE_CODE_DISABLE_CRON: '1',
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
      ENABLE_TOOL_SEARCH: 'false',
    });
  if (endpoint) env[tokenEnv] = endpoint.token;
  return env;
}

const disabledFeatures = [
  'shell_tool',
  'unified_exec',
  'apps',
  'plugins',
  'hooks',
  'browser_use',
  'computer_use',
  'image_generation',
  'code_mode',
  'code_mode_host',
  'view_image',
  'goals',
  'multi_agent',
  'multi_agent_v2',
  'skill_mcp_dependency_install',
  'tool_suggest',
  'remote_plugin',
  'skill_search',
];

const codexPrivacy = [
  '--ignore-user-config',
  '--ignore-rules',
  '--strict-config',
  '--enable',
  'skip_host_skill_discovery',
  '--sandbox',
  'read-only',
  '--skip-git-repo-check',
  '--json',
  ...disabledFeatures.flatMap((f) => ['--disable', f]),
  ...[
    'web_search="disabled"',
    'agents.enabled=false',
    'project_doc_max_bytes=0',
    'skills.include_instructions=false',
    'skills.bundled.enabled=false',
  ].flatMap((s) => ['-c', s]),
];
const claudePrivacy = [
  '--print',
  '--verbose',
  '--restricted',
  '--strict-mcp-config',
  '--tools',
  '',
  '--disable-slash-commands',
  '--no-chrome',
  '--setting-sources',
  '',
  '--settings',
  '{"disableAllHooks":true,"autoMemoryEnabled":false}',
  '--permission-mode',
  'dontAsk',
  '--permission-prompts',
  'none',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
];

export function studioInvocation(
  provider: StudioProvider,
  task: StudioTask,
  endpoint?: StudioMcpEndpoint,
  initialSession?: string
) {
  if (!providerId(task.model) || (task.conversation !== null && !providerId(task.conversation)))
    throw Error('Invalid provider identity');
  if (Boolean(task.teamTools) !== Boolean(endpoint)) throw Error('Room MCP connection unavailable');
  const prompt =
    task.instructions +
    (endpoint
      ? '\nUse the Studio tools for this room when needed.\n\n'
      : '\nUse only the material in the conversation.\n\n') +
    task.prompt;
  if (provider === 'codex') {
    const mcp = endpoint
      ? [
          'mcp_servers.studio.url=' + JSON.stringify(endpoint.url),
          'mcp_servers.studio.bearer_token_env_var=' + JSON.stringify(tokenEnv),
          'mcp_servers.studio.enabled_tools=' + JSON.stringify(STUDIO_TEAM_TOOLS),
          'mcp_servers.studio.required=true',
          'mcp_servers.studio.default_tools_approval_mode="approve"',
        ].flatMap((setting) => ['-c', setting])
      : [];
    return {
      args: [
        '-a',
        'never',
        'exec',
        ...codexPrivacy,
        ...mcp,
        '--model',
        task.model,
        ...(task.conversation ? ['resume', task.conversation] : []),
        '-',
      ],
      input: prompt,
    };
  }
  if (provider === 'claude') {
    const mcp = endpoint
      ? [
          '--mcp-config',
          JSON.stringify({
            mcpServers: {
              studio: {
                type: 'http',
                url: endpoint.url,
                headers: { Authorization: 'Bearer ${OMNITRON_STUDIO_MCP_TOKEN}' },
              },
            },
          }),
          '--allowedTools',
          STUDIO_TEAM_TOOLS.map((n) => 'mcp__studio__' + n).join(','),
        ]
      : [];
    return {
      args: [
        ...claudePrivacy,
        ...mcp,
        '--model',
        task.model,
        ...(task.conversation
          ? ['--resume', task.conversation]
          : initialSession
            ? ['--session-id', initialSession]
            : []),
      ],
      input: JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n',
    };
  }
  if (provider === 'agy' && !endpoint)
    return {
      args: [
        '--sandbox',
        '--mode',
        'plan',
        '--settings',
        JSON.stringify({
          toolPermission: 'strict',
          allowNonWorkspaceAccess: false,
          statusLine: { enabled: false },
          title: { enabled: false },
          permissions: {
            deny: [
              'read_file(*)',
              'write_file(*)',
              'read_url(*)',
              'execute_url(*)',
              'command(*)',
              'unsandboxed(*)',
              'mcp(*)',
            ],
          },
        }),
        '--disable-slash-commands',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--model',
        task.model,
        ...(task.conversation ? ['--conversation', task.conversation] : []),
      ],
      input: JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n',
    };
  throw Error('The selected CLI cannot isolate the requested Studio tools');
}

const codexModels = ['-c', 'model_provider="openai"', 'debug', 'models'];
type CodexModel = Record<string, unknown> & { slug: string; visibility: string; display_name: string };
const listedCodexModels = (stdout: string): CodexModel[] =>
  (JSON.parse(stdout) as { models: CodexModel[] }).models.filter((m) => m.visibility === 'list');

/** Codex models can request Code Mode in their catalog defaults. Keep the actual model's metadata
 * and select direct MCP tools for Studio. This leaves the CLI's code host and shell disabled. */
export async function writeCodexConsultationCatalog(
  engine: ExecutionEngine,
  binary: string,
  cwd: string,
  selected: string,
  signal: AbortSignal
): Promise<string | null> {
  const result = await engine.execute({
    command: binary,
    args: codexModels,
    cwd,
    shell: false,
    env: studioEnv('codex'),
    envMode: 'replace',
    signal,
    timeout: 40_000,
    maxBuffer: 8 * 1024 * 1024,
    nothrow: true,
  });
  if (result.exitCode !== 0) throw Error('Codex model discovery unavailable');
  const listed = listedCodexModels(result.stdout).filter((m) => m.slug === selected);
  if (listed.length !== 1) return null;
  const direct = {
    ...listed[0],
    node_repl_disabled: true,
    supports_search_tool: false,
    apply_patch_tool_type: null,
    experimental_supported_tools: [],
  } as Record<string, unknown>;
  delete direct['tool_mode'];
  const file = join(cwd, 'studio-model-' + randomUUID() + '.json');
  await writeFile(file, JSON.stringify({ models: [direct] }), { mode: 0o600, flag: 'wx' });
  return file;
}

type Model = { id: string; label: string };
type Probe = (args: string[], input?: string) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>;

class CatalogUnavailable extends Error {}

// Antigravity starts global hooks, MCP servers and enabled plugins independently of tool permissions.
// Its CLI has no per-launch customization switch. Check those sources before giving it a prompt.
export async function checkAgyIntegrations(pluginsJson: string, directory = join(homedir(), '.gemini', 'config')) {
  const config = async (file: string): Promise<Record<string, unknown>> => {
    const handle = await open(join(directory, file), 'r').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!handle) return {};
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 512 * 1024) throw Error();
      const value: unknown = JSON.parse((await handle.readFile('utf8')).trim() || '{}');
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
      return value as Record<string, unknown>;
    } finally {
      await handle.close();
    }
  };
  try {
    const hooks = await config('hooks.json');
    const mcp = await config('mcp_config.json');
    const plugins: unknown = JSON.parse(pluginsJson);
    const servers = mcp['mcpServers'] ?? {};
    if (
      !Array.isArray(plugins) ||
      plugins.some((p) => p?.enabled !== false) ||
      Object.entries(hooks).some(
        ([name, hook]) => name !== '$schema' && (hook as { enabled?: boolean } | null)?.enabled !== false
      ) ||
      !servers ||
      typeof servers !== 'object' ||
      Array.isArray(servers) ||
      Object.values(servers).some((server) => server?.disabled !== true)
    )
      throw Error();
  } catch {
    throw new CatalogUnavailable(
      'Antigravity requires a local profile with global hooks, MCP servers and plugins disabled.'
    );
  }
}

export async function verifyAgyProfile(engine: ExecutionEngine, binary: string, cwd: string, signal?: AbortSignal) {
  const plugins = await engine.execute({
    command: binary,
    args: ['plugin', 'list', '--json'],
    cwd,
    shell: false,
    env: studioEnv('agy'),
    envMode: 'replace',
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    ...(signal && { signal }),
    nothrow: true,
  });
  if (plugins.exitCode !== 0) throw new CatalogUnavailable('Antigravity could not verify the local plugin profile.');
  await checkAgyIntegrations(plugins.stdout);
}

async function readCatalog(provider: StudioProvider, probe: Probe): Promise<Model[]> {
  if (provider === 'kimi')
    throw new CatalogUnavailable(
      'Kimi execution is unavailable. Studio has no verified subscription mode that isolates global MCP servers and hooks for each turn.'
    );
  const helpArgs = provider === 'codex' ? ['exec', '--help'] : ['--help'];
  const help = await probe(helpArgs);
  const required =
    provider === 'codex'
      ? ['--ignore-user-config', '--ignore-rules', '--strict-config', '--sandbox', '--disable']
      : provider === 'claude'
        ? [
            '--restricted',
            '--strict-mcp-config',
            '--tools',
            '--permission-prompts',
            '--disable-slash-commands',
            '--input-format',
          ]
        : ['--settings', '--sandbox', '--disable-slash-commands', '--input-format', '--output-format'];
  if (help.exitCode !== 0 || required.some((flag) => !(help.stdout + help.stderr).includes(flag)))
    throw new CatalogUnavailable(
      'The installed ' +
        provider +
        ' CLI lacks the required isolation flags. Select a compatible executable with --binary.'
    );
  if (provider === 'codex') {
    const features = await probe(['features', 'list']);
    const names = new Set(features.stdout.split(/\r?\n/).map((line) => line.trim().split(/\s+/, 1)[0]));
    if (features.exitCode !== 0 || [...disabledFeatures, 'skip_host_skill_discovery'].some((f) => !names.has(f)))
      throw new CatalogUnavailable('The installed Codex CLI cannot confirm all required tool restrictions.');
    const auth = await probe(['login', 'status']);
    if (auth.exitCode !== 0 || !/logged in using chatgpt/i.test(auth.stderr + auth.stdout))
      throw new CatalogUnavailable('Codex requires a local ChatGPT subscription login.');
    const result = await probe(codexModels);
    if (result.exitCode !== 0)
      throw new CatalogUnavailable(
        'Codex could not list its models. Check the selected installation and subscription.'
      );
    return listedCodexModels(result.stdout).map((m) => ({ id: m.slug, label: m.display_name }));
  }
  if (provider === 'claude') {
    const status = await probe(['--restricted', '--strict-mcp-config', 'auth', 'status', '--json']);
    const auth = status.exitCode === 0 && JSON.parse(status.stdout);
    if (!auth || auth.loggedIn !== true || !['claude.ai', 'oauth_token'].includes(auth.authMethod))
      throw new CatalogUnavailable('Claude Code requires a local Claude subscription login.');
    const input =
      JSON.stringify({ type: 'control_request', request_id: 'studio-catalog', request: { subtype: 'initialize' } }) +
      '\n';
    const result = await probe(claudePrivacy, input);
    if (result.exitCode !== 0)
      throw new CatalogUnavailable('Claude Code could not initialize its local model catalog.');
    const reply = result.stdout
      .trim()
      .split(/\r?\n/)
      .map((l) => JSON.parse(l))
      .find(
        (e) =>
          e.type === 'control_response' &&
          e.response?.request_id === 'studio-catalog' &&
          e.response?.subtype === 'success'
      );
    const models: Model[] = [];
    for (const m of reply?.response?.response?.models ?? []) {
      // Several display aliases can resolve to the same model. Persist and pass the canonical ID.
      if (m.value !== 'default' && providerId(m.resolvedModel) && !models.some((old) => old.id === m.resolvedModel))
        models.push({ id: m.resolvedModel, label: m.displayName });
    }
    return models;
  }
  const result = await probe(['models']);
  if (result.exitCode !== 0)
    throw new CatalogUnavailable('Antigravity could not list its models. Check the local subscription login.');
  return result.stdout
    .split(/\r?\n/)
    .filter((s) => s.includes('\t'))
    .map((s) => {
      const [id, ...rest] = s.split('\t');
      return { id: id!.trim(), label: rest.join(' ').trim() };
    });
}

/** Metadata-only probes keep raw stdout, stderr, account metadata and authentication details off the Console. */
export async function discoverStudioModels(provider: StudioProvider, executable: string, cwd: string) {
  const executor = studioEngine();
  try {
    if (provider === 'agy') await verifyAgyProfile(executor, executable, cwd);
    const models = await readCatalog(provider, async (args, input) => {
      const result = await executor.execute({
        command: executable,
        args,
        ...(input && { stdin: input }),
        cwd,
        shell: false,
        env: studioEnv(provider),
        envMode: 'replace',
        maxBuffer: 8 * 1024 * 1024,
        timeout: 40_000,
        nothrow: true,
      });
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    });
    if (
      !models.length ||
      models.length > 512 ||
      models.some(
        (m) =>
          !providerId(m.id) ||
          typeof m.label !== 'string' ||
          !m.label.trim() ||
          m.label.length > 256 ||
          /[\u0000-\u001f\u007f]/.test(m.label)
      )
    )
      throw new CatalogUnavailable('The provider returned an invalid model catalog.');
    return models;
  } catch (error) {
    // JSON parsing and process errors may contain captured output, argument values or paths.
    if (error instanceof CatalogUnavailable) throw error;
    throw new CatalogUnavailable('The selected provider could not confirm a valid model catalog.');
  } finally {
    await executor.dispose();
  }
}
