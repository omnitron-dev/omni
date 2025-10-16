# Flow-Shell: Universal Shell Automation for Flow-Machine

**Version**: 1.0.0
**Date**: October 16, 2025
**Status**: Specification - Ready for Implementation
**Domain**: Shell automation, remote execution, infrastructure orchestration
**Integration**: Flow-Machine architecture with full effect tracking and cognitive capabilities

---

## Executive Summary

**Flow-Shell** is a comprehensive shell automation system built on the Flow-Machine architecture, integrating the battle-tested xec-core execution engine with Flow's compositional, effect-tracked, and cognitive capabilities. It provides a universal abstraction for shell operations across local, SSH, Docker, and Kubernetes environments while maintaining full compatibility with the Flow-Machine's meta-programming and reflexivity features.

### Core Value Proposition

1. **Universal Execution Context** - Single API for local, remote, container, and cluster execution
2. **Flow Composition** - All shell operations are Flows with full pipe support
3. **Effect Tracking** - Automatic tracking of IO, Process, Network, FileSystem effects
4. **Type Safety** - Full TypeScript types with runtime validation
5. **Cognitive Integration** - Shell operations that learn from execution patterns
6. **Production Ready** - Built on proven xec-core with comprehensive error handling

### Key Features

```typescript
import { $shell, local, ssh, docker, k8s } from '@omnitron-dev/holon-flow/shell';
import { flow } from '@omnitron-dev/holon-flow';

// Universal shell context
const result = await $shell`ls -la`;

// Remote execution
const remoteResult = await ssh({ host: 'server.com', user: 'admin' })
  .pipe($shell`ls -la`);

// Docker execution
const dockerResult = await docker({ image: 'node:20' })
  .pipe($shell`node --version`);

// Kubernetes execution
const k8sResult = await k8s({ pod: 'app-123', namespace: 'prod' })
  .pipe($shell`kubectl get pods`);

// Complex flow composition
const deployFlow = flow<DeployConfig, DeployResult>()
  .pipe(validateConfig)
  .pipe(ssh({ host: 'staging.server' }))
  .pipe($shell`git pull origin main`)
  .pipe($shell`npm install`)
  .pipe($shell`npm run build`)
  .pipe($shell`pm2 restart app`);

// Effect tracking
console.log(deployFlow.effects()); // FileSystem | Network | Process
```

---

## Part I: Architecture & Philosophy

### 1.1 Design Principles

**Universal Shell Context ($)**

The universal shell context provides a consistent API across all execution targets:

```typescript
/**
 * Universal shell context - the $ function
 *
 * Can execute on:
 * - Local machine (default)
 * - Remote SSH servers
 * - Docker containers
 * - Kubernetes pods
 */
interface ShellContext {
  /**
   * Execute a shell command using template literals
   *
   * @example
   * const result = await $shell`ls -la ${directory}`;
   */
  (strings: TemplateStringsArray, ...values: any[]): ShellFlow<void, ShellResult>;

  /**
   * Change working directory for subsequent commands
   */
  cd(path: string): ShellContext;

  /**
   * Set environment variables
   */
  env(vars: Record<string, string>): ShellContext;

  /**
   * Configure shell options
   */
  config(options: ShellOptions): ShellContext;

  /**
   * Access to underlying execution engine
   */
  engine: ExecutionEngine;
}
```

**Flow-First Design**

Every shell operation is a Flow with full composition support:

```typescript
/**
 * ShellFlow extends Flow with shell-specific capabilities
 */
interface ShellFlow<In = void, Out = ShellResult> extends Flow<In, Out> {
  /**
   * Pipe output to another command
   */
  pipe<Next>(next: ShellFlow<Out, Next>): ShellFlow<In, Next>;
  pipe<Next>(next: Flow<Out, Next>): Flow<In, Next>;

  /**
   * Get effect flags (implements Flow.effects())
   */
  effects(): EffectFlags;

  /**
   * Execute the flow (Flow interface)
   */
  (input: In): Promise<Out>;

  /**
   * Stream-specific operations
   */
  stdout(): AsyncIterableIterator<string>;
  stderr(): AsyncIterableIterator<string>;
  lines(): AsyncIterableIterator<string>;

  /**
   * Result transformations
   */
  text(): Promise<string>;
  json<T>(): Promise<T>;
  exitCode(): Promise<number>;

  /**
   * Error handling
   */
  nothrow(): ShellFlow<In, Out>;
  retry(options: RetryOptions): ShellFlow<In, Out>;
  timeout(ms: number): ShellFlow<In, Out>;

  /**
   * Cognitive capabilities
   */
  learn(examples: ShellExample[]): Promise<void>;
  explain(): ShellExplanation;
}
```

**Effect Tracking Integration**

All shell operations automatically track their effects:

```typescript
/**
 * Shell-specific effect flags
 */
enum ShellEffectFlags {
  // Base effects (from Flow)
  Process = EffectFlags.Process,
  FileSystem = EffectFlags.FileSystem,
  Network = EffectFlags.Network,
  IO = EffectFlags.IO,

  // Shell-specific effects
  ShellExecution = 1 << 16,
  RemoteExecution = 1 << 17,
  ContainerExecution = 1 << 18,
  ClusterExecution = 1 << 19,

  // Privilege effects
  Sudo = 1 << 20,
  Root = 1 << 21,

  // State effects
  SystemModification = 1 << 22,
  ConfigurationChange = 1 << 23,
  DataMutation = 1 << 24,

  // Security effects
  CredentialAccess = 1 << 25,
  NetworkBinding = 1 << 26,
  PrivilegedPort = 1 << 27,
}

/**
 * Effect analysis for shell commands
 */
interface ShellEffectAnalysis {
  flags: EffectFlags;
  commands: CommandEffect[];
  risks: SecurityRisk[];
  dependencies: string[];
  resources: ResourceRequirement[];
}

interface CommandEffect {
  command: string;
  type: 'read' | 'write' | 'execute' | 'delete' | 'network';
  target: string;
  privileges: 'user' | 'sudo' | 'root';
  reversible: boolean;
  idempotent: boolean;
}

interface SecurityRisk {
  level: 'low' | 'medium' | 'high' | 'critical';
  category: 'privilege_escalation' | 'data_loss' | 'network_exposure' | 'injection';
  description: string;
  mitigation: string;
}
```

### 1.2 Target Abstraction Layer

**ExecutionTarget Interface**

All execution environments implement a common interface:

```typescript
/**
 * Base interface for all execution targets
 */
interface ExecutionTarget {
  /**
   * Target type identifier
   */
  readonly type: 'local' | 'ssh' | 'docker' | 'kubernetes';

  /**
   * Target configuration
   */
  readonly config: TargetConfig;

  /**
   * Execute a command
   */
  execute(command: ShellCommand): Promise<ShellResult>;

  /**
   * Execute with streaming
   */
  stream(command: ShellCommand): AsyncIterableIterator<ShellChunk>;

  /**
   * Check if target is available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get target metadata
   */
  metadata(): TargetMetadata;

  /**
   * Cleanup resources
   */
  dispose(): Promise<void>;
}

/**
 * Target metadata
 */
interface TargetMetadata {
  os: 'linux' | 'darwin' | 'windows' | 'unknown';
  arch: 'x64' | 'arm64' | 'unknown';
  shell: string;
  capabilities: Capability[];
  limits: ResourceLimits;
}

interface Capability {
  name: string;
  available: boolean;
  version?: string;
}

interface ResourceLimits {
  maxMemory?: number;
  maxCpu?: number;
  maxProcesses?: number;
  timeout?: number;
}
```

**Target Implementations**

```typescript
/**
 * Local execution target
 */
class LocalTarget implements ExecutionTarget {
  readonly type = 'local';

  constructor(config: LocalTargetConfig) {
    // Wraps xec-core LocalAdapter
  }
}

/**
 * SSH remote execution target
 */
class SSHTarget implements ExecutionTarget {
  readonly type = 'ssh';

  constructor(config: SSHTargetConfig) {
    // Wraps xec-core SSHAdapter
    // Connection pooling
    // Key management
    // Agent forwarding
  }

  /**
   * File transfer operations
   */
  upload(local: string, remote: string): Promise<void>;
  download(remote: string, local: string): Promise<void>;

  /**
   * Port forwarding
   */
  forward(local: number, remote: number): Promise<Tunnel>;
}

/**
 * Docker container execution target
 */
class DockerTarget implements ExecutionTarget {
  readonly type = 'docker';

  constructor(config: DockerTargetConfig) {
    // Wraps xec-core DockerAdapter
    // Container lifecycle management
    // Volume management
    // Network management
  }

  /**
   * Container operations
   */
  start(): Promise<void>;
  stop(): Promise<void>;
  remove(): Promise<void>;
  logs(): AsyncIterableIterator<string>;
}

/**
 * Kubernetes pod execution target
 */
class KubernetesTarget implements ExecutionTarget {
  readonly type = 'kubernetes';

  constructor(config: K8sTargetConfig) {
    // Wraps xec-core KubernetesAdapter
    // Pod selection
    // Namespace management
    // Context management
  }

  /**
   * Pod operations
   */
  scale(replicas: number): Promise<void>;
  rollout(): Promise<void>;
  status(): Promise<PodStatus>;
}
```

### 1.3 Command Composition & Piping

**Compositional Shell Operations**

```typescript
/**
 * Shell command builder
 */
class ShellCommandBuilder {
  /**
   * Build command from template
   */
  build(strings: TemplateStringsArray, ...values: any[]): ShellCommand;

  /**
   * Build command from parts
   */
  fromParts(parts: CommandPart[]): ShellCommand;

  /**
   * Parse command string
   */
  parse(command: string): ShellCommand;
}

interface ShellCommand {
  command: string;
  args: string[];
  options: ShellOptions;
  env: Record<string, string>;
  cwd: string;
  stdin?: string | Stream;
}

interface ShellOptions {
  shell?: string | boolean;
  timeout?: number;
  encoding?: BufferEncoding;
  throwOnNonZeroExit?: boolean;
  sudo?: boolean;
  nothrow?: boolean;
  retry?: RetryOptions;
}

/**
 * Command piping
 */
interface CommandPipe {
  /**
   * Pipe stdout to next command
   */
  pipe(next: ShellFlow): ShellFlow;

  /**
   * Pipe with transformation
   */
  pipeThrough(transform: Flow<string, string>): ShellFlow;

  /**
   * Conditional piping
   */
  pipeIf(condition: boolean, next: ShellFlow): ShellFlow;
}

/**
 * Stream processing
 */
interface StreamProcessor {
  /**
   * Line-by-line processing
   */
  lines(): AsyncIterableIterator<string>;

  /**
   * Chunk processing
   */
  chunks(size?: number): AsyncIterableIterator<Buffer>;

  /**
   * JSON stream processing
   */
  jsonLines<T>(): AsyncIterableIterator<T>;

  /**
   * Filtered streaming
   */
  grep(pattern: RegExp): AsyncIterableIterator<string>;

  /**
   * Transformed streaming
   */
  map<T>(fn: (line: string) => T): AsyncIterableIterator<T>;
}
```

---

## Part II: Core Components

### 2.1 ShellFlow Base Class

```typescript
/**
 * Base class for all shell flows
 */
export class BaseShellFlow<In = void, Out = ShellResult> implements ShellFlow<In, Out> {
  protected readonly target: ExecutionTarget;
  protected readonly options: ShellOptions;
  protected readonly _effects: Set<Effect>;
  protected readonly flags: EffectFlags;

  constructor(
    target: ExecutionTarget,
    command: ShellCommand,
    options: ShellOptions = {}
  ) {
    this.target = target;
    this.options = options;
    this._effects = this.analyzeEffects(command);
    this.flags = this.computeFlags();
  }

  /**
   * Execute the shell command (Flow interface)
   */
  async call(input: In): Promise<Out> {
    const command = this.prepareCommand(input);
    const result = await this.target.execute(command);
    return this.processResult(result) as Out;
  }

  /**
   * Make callable (Flow requirement)
   */
  async execute(input: In): Promise<Out> {
    return this.call(input);
  }

  /**
   * Pipe composition (Flow interface)
   */
  pipe<Next>(next: Flow<Out, Next>): Flow<In, Next> {
    if (isShellFlow(next)) {
      return new PipedShellFlow(this, next);
    }
    return flow(async (input: In) => {
      const intermediate = await this(input);
      return next(intermediate);
    });
  }

  /**
   * Get effect flags (Flow interface)
   */
  effects(): EffectFlags {
    return this.flags;
  }

  /**
   * Stream operations
   */
  async *stdout(): AsyncIterableIterator<string> {
    const command = this.prepareCommand(undefined as In);
    for await (const chunk of this.target.stream(command)) {
      if (chunk.stream === 'stdout') {
        yield chunk.data;
      }
    }
  }

  async *stderr(): AsyncIterableIterator<string> {
    const command = this.prepareCommand(undefined as In);
    for await (const chunk of this.target.stream(command)) {
      if (chunk.stream === 'stderr') {
        yield chunk.data;
      }
    }
  }

  async *lines(): AsyncIterableIterator<string> {
    let buffer = '';
    for await (const chunk of this.stdout()) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        yield line;
      }
    }
    if (buffer) yield buffer;
  }

  /**
   * Result transformations
   */
  async text(): Promise<string> {
    const result = await this(undefined as In);
    return result.stdout;
  }

  async json<T>(): Promise<T> {
    const text = await this.text();
    return JSON.parse(text);
  }

  async exitCode(): Promise<number> {
    const result = await this(undefined as In);
    return result.exitCode;
  }

  /**
   * Error handling
   */
  nothrow(): ShellFlow<In, Out> {
    return new BaseShellFlow(
      this.target,
      this.command,
      { ...this.options, nothrow: true }
    );
  }

  retry(options: RetryOptions): ShellFlow<In, Out> {
    return new BaseShellFlow(
      this.target,
      this.command,
      { ...this.options, retry: options }
    );
  }

  timeout(ms: number): ShellFlow<In, Out> {
    return new BaseShellFlow(
      this.target,
      this.command,
      { ...this.options, timeout: ms }
    );
  }

  /**
   * Cognitive capabilities
   */
  async learn(examples: ShellExample[]): Promise<void> {
    // Integrate with cognitive system
    // Pattern recognition for shell commands
    // Learn common error patterns
    // Optimize retry strategies
  }

  explain(): ShellExplanation {
    return {
      command: this.command.command,
      effects: this.analyzeEffects(this.command),
      risks: this.analyzeRisks(),
      alternatives: this.suggestAlternatives(),
      documentation: this.generateDocs(),
    };
  }

  /**
   * Protected: Analyze effects
   */
  protected analyzeEffects(command: ShellCommand): Set<Effect> {
    const effects = new Set<Effect>();

    // Always has Process effect
    effects.add(Effects.process);

    // Analyze command for specific effects
    if (this.isFileSystemCommand(command)) {
      effects.add(Effects.fileSystem);
    }
    if (this.isNetworkCommand(command)) {
      effects.add(Effects.network);
    }
    if (this.isIOCommand(command)) {
      effects.add(Effects.io);
    }

    // Target-specific effects
    if (this.target.type !== 'local') {
      effects.add(Effects.remoteExecution);
    }

    return effects;
  }

  /**
   * Protected: Compute effect flags
   */
  protected computeFlags(): EffectFlags {
    let flags = EffectFlags.Process;

    for (const effect of this._effects) {
      flags |= effect.flags;
    }

    return flags;
  }

  /**
   * Protected: Prepare command for execution
   */
  protected prepareCommand(input: In): ShellCommand {
    // Command preparation logic
    return this.command;
  }

  /**
   * Protected: Process result
   */
  protected processResult(result: ExecutionResult): ShellResult {
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      signal: result.signal,
      duration: result.duration,
      target: this.target.type,
    };
  }
}

/**
 * Shell result type
 */
interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string;
  duration: number;
  target: string;
}

interface ShellChunk {
  stream: 'stdout' | 'stderr';
  data: string;
  timestamp: number;
}
```

### 2.2 Target-Specific Implementations

**Local Shell Flow**

```typescript
/**
 * Local shell execution
 */
export function local(options?: LocalTargetConfig): ShellContext {
  const target = new LocalTarget(options);
  return createShellContext(target);
}

interface LocalTargetConfig {
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

/**
 * Create shell context for a target
 */
function createShellContext(target: ExecutionTarget): ShellContext {
  const context = (strings: TemplateStringsArray, ...values: any[]) => {
    const command = buildCommand(strings, values);
    return new BaseShellFlow(target, command);
  };

  context.cd = (path: string) => {
    const newTarget = target.withCwd(path);
    return createShellContext(newTarget);
  };

  context.env = (vars: Record<string, string>) => {
    const newTarget = target.withEnv(vars);
    return createShellContext(newTarget);
  };

  context.config = (options: ShellOptions) => {
    const newTarget = target.withOptions(options);
    return createShellContext(newTarget);
  };

  context.engine = target.engine;

  return context;
}
```

**SSH Shell Flow**

```typescript
/**
 * SSH remote execution
 */
export function ssh(options: SSHTargetConfig): ShellContext {
  const target = new SSHTarget(options);
  return createShellContext(target);
}

interface SSHTargetConfig {
  host: string;
  port?: number;
  user?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  agent?: string;
  agentForward?: boolean;
  timeout?: number;
  keepalive?: boolean;
}

/**
 * SSH-specific operations
 */
export class SSHShellContext extends BaseShellContext {
  /**
   * Upload file to remote
   */
  upload(local: string, remote: string): Flow<void, void> {
    return flow(async () => {
      await this.target.upload(local, remote);
    });
  }

  /**
   * Download file from remote
   */
  download(remote: string, local: string): Flow<void, void> {
    return flow(async () => {
      await this.target.download(remote, local);
    });
  }

  /**
   * Port forwarding
   */
  forward(local: number, remote: number): Flow<void, Tunnel> {
    return flow(async () => {
      return await this.target.forward(local, remote);
    });
  }

  /**
   * Execute with sudo
   */
  sudo(password?: string): ShellContext {
    return createShellContext(
      this.target.withSudo(password)
    );
  }
}
```

**Docker Shell Flow**

```typescript
/**
 * Docker container execution
 */
export function docker(options: DockerTargetConfig): ShellContext {
  const target = new DockerTarget(options);
  return createShellContext(target);
}

interface DockerTargetConfig {
  // Ephemeral container
  image?: string;
  volumes?: string[];
  network?: string;
  env?: Record<string, string>;

  // Persistent container
  container?: string;

  // Common options
  user?: string;
  workdir?: string;
  platform?: string;
  pull?: boolean;
}

/**
 * Docker-specific operations
 */
export class DockerShellContext extends BaseShellContext {
  /**
   * Start container
   */
  start(): Flow<void, void> {
    return flow(async () => {
      await this.target.start();
    });
  }

  /**
   * Stop container
   */
  stop(): Flow<void, void> {
    return flow(async () => {
      await this.target.stop();
    });
  }

  /**
   * Get container logs
   */
  logs(): AsyncIterableIterator<string> {
    return this.target.logs();
  }

  /**
   * Copy file to container
   */
  copyTo(local: string, container: string): Flow<void, void> {
    return flow(async () => {
      await this.target.copyTo(local, container);
    });
  }

  /**
   * Copy file from container
   */
  copyFrom(container: string, local: string): Flow<void, void> {
    return flow(async () => {
      await this.target.copyFrom(container, local);
    });
  }
}
```

**Kubernetes Shell Flow**

```typescript
/**
 * Kubernetes pod execution
 */
export function k8s(options: K8sTargetConfig): ShellContext {
  const target = new KubernetesTarget(options);
  return createShellContext(target);
}

interface K8sTargetConfig {
  pod: string;
  container?: string;
  namespace?: string;
  context?: string;
  kubeconfig?: string;
}

/**
 * Kubernetes-specific operations
 */
export class K8sShellContext extends BaseShellContext {
  /**
   * Get pod status
   */
  status(): Flow<void, PodStatus> {
    return flow(async () => {
      return await this.target.status();
    });
  }

  /**
   * Scale deployment
   */
  scale(replicas: number): Flow<void, void> {
    return flow(async () => {
      await this.target.scale(replicas);
    });
  }

  /**
   * Get logs
   */
  logs(options?: LogOptions): AsyncIterableIterator<string> {
    return this.target.logs(options);
  }

  /**
   * Port forward
   */
  forward(local: number, remote: number): Flow<void, PortForward> {
    return flow(async () => {
      return await this.target.forward(local, remote);
    });
  }
}

interface PodStatus {
  phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';
  conditions: Condition[];
  containerStatuses: ContainerStatus[];
}

interface Condition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
}

interface ContainerStatus {
  name: string;
  ready: boolean;
  restartCount: number;
  state: ContainerState;
}
```

---

## Part III: Flow Modules

### 3.1 flow-fs: File System Operations

```typescript
/**
 * File system operations as flows
 */
export namespace fs {
  /**
   * Read file
   */
  export function read(path: string): ShellFlow<void, string> {
    return $shell`cat ${path}`;
  }

  /**
   * Write file
   */
  export function write(path: string, content: string): ShellFlow<void, void> {
    return flow(async () => {
      await $shell`echo ${content} > ${path}`;
    });
  }

  /**
   * Append to file
   */
  export function append(path: string, content: string): ShellFlow<void, void> {
    return flow(async () => {
      await $shell`echo ${content} >> ${path}`;
    });
  }

  /**
   * Copy file/directory
   */
  export function copy(source: string, dest: string, recursive = false): ShellFlow<void, void> {
    const flags = recursive ? '-r' : '';
    return $shell`cp ${flags} ${source} ${dest}`;
  }

  /**
   * Move file/directory
   */
  export function move(source: string, dest: string): ShellFlow<void, void> {
    return $shell`mv ${source} ${dest}`;
  }

  /**
   * Remove file/directory
   */
  export function remove(path: string, recursive = false): ShellFlow<void, void> {
    const flags = recursive ? '-rf' : '-f';
    return $shell`rm ${flags} ${path}`;
  }

  /**
   * Create directory
   */
  export function mkdir(path: string, parents = true): ShellFlow<void, void> {
    const flags = parents ? '-p' : '';
    return $shell`mkdir ${flags} ${path}`;
  }

  /**
   * List directory
   */
  export function ls(path: string, options?: LsOptions): ShellFlow<void, FileInfo[]> {
    const flags = buildLsFlags(options);
    return $shell`ls ${flags} ${path}`.pipe(parseLsOutput);
  }

  /**
   * Check if file exists
   */
  export function exists(path: string): ShellFlow<void, boolean> {
    return $shell`test -e ${path}`.pipe(
      flow((result: ShellResult) => result.exitCode === 0)
    );
  }

  /**
   * Get file info
   */
  export function stat(path: string): ShellFlow<void, FileInfo> {
    return $shell`stat ${path}`.pipe(parseStatOutput);
  }

  /**
   * Change permissions
   */
  export function chmod(path: string, mode: string): ShellFlow<void, void> {
    return $shell`chmod ${mode} ${path}`;
  }

  /**
   * Change ownership
   */
  export function chown(path: string, user: string, group?: string): ShellFlow<void, void> {
    const owner = group ? `${user}:${group}` : user;
    return $shell`chown ${owner} ${path}`;
  }

  /**
   * Find files
   */
  export function find(path: string, pattern: string): ShellFlow<void, string[]> {
    return $shell`find ${path} -name ${pattern}`.pipe(
      flow((result: ShellResult) => result.stdout.trim().split('\n'))
    );
  }

  /**
   * Grep in files
   */
  export function grep(pattern: string, path: string, recursive = false): ShellFlow<void, string[]> {
    const flags = recursive ? '-r' : '';
    return $shell`grep ${flags} ${pattern} ${path}`.pipe(
      flow((result: ShellResult) => result.stdout.trim().split('\n'))
    );
  }

  /**
   * Get disk usage
   */
  export function du(path: string): ShellFlow<void, DiskUsage> {
    return $shell`du -sh ${path}`.pipe(parseDuOutput);
  }

  /**
   * Get disk free space
   */
  export function df(path?: string): ShellFlow<void, DiskSpace> {
    const target = path || '/';
    return $shell`df -h ${target}`.pipe(parseDfOutput);
  }
}

interface FileInfo {
  path: string;
  size: number;
  mode: string;
  owner: string;
  group: string;
  mtime: Date;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

interface LsOptions {
  all?: boolean;
  long?: boolean;
  human?: boolean;
  sort?: 'name' | 'size' | 'time';
  reverse?: boolean;
}

interface DiskUsage {
  size: number;
  human: string;
}

interface DiskSpace {
  total: number;
  used: number;
  available: number;
  percent: number;
  mountpoint: string;
}
```

### 3.2 flow-process: Process Management

```typescript
/**
 * Process management operations
 */
export namespace process {
  /**
   * List processes
   */
  export function ps(options?: PsOptions): ShellFlow<void, ProcessInfo[]> {
    const flags = buildPsFlags(options);
    return $shell`ps ${flags}`.pipe(parsePsOutput);
  }

  /**
   * Kill process
   */
  export function kill(pid: number, signal = 'TERM'): ShellFlow<void, void> {
    return $shell`kill -${signal} ${pid}`;
  }

  /**
   * Kill process by name
   */
  export function killall(name: string, signal = 'TERM'): ShellFlow<void, void> {
    return $shell`killall -${signal} ${name}`;
  }

  /**
   * Get process info
   */
  export function info(pid: number): ShellFlow<void, ProcessInfo> {
    return $shell`ps -p ${pid} -o pid,ppid,user,%cpu,%mem,vsz,rss,tty,stat,start,time,command`.pipe(
      flow((result: ShellResult) => {
        const lines = result.stdout.trim().split('\n');
        return parseProcessLine(lines[1]!);
      })
    );
  }

  /**
   * Check if process is running
   */
  export function isRunning(pid: number): ShellFlow<void, boolean> {
    return $shell`ps -p ${pid}`.pipe(
      flow((result: ShellResult) => result.exitCode === 0)
    );
  }

  /**
   * Find process by name
   */
  export function findByName(name: string): ShellFlow<void, ProcessInfo[]> {
    return $shell`pgrep -fl ${name}`.pipe(parsePgrepOutput);
  }

  /**
   * Get top processes
   */
  export function top(count = 10): ShellFlow<void, ProcessInfo[]> {
    return $shell`ps aux --sort=-%cpu | head -n ${count + 1}`.pipe(parsePsOutput);
  }

  /**
   * Start background process
   */
  export function background(command: string): ShellFlow<void, number> {
    return $shell`${command} & echo $!`.pipe(
      flow((result: ShellResult) => parseInt(result.stdout.trim(), 10))
    );
  }

  /**
   * Wait for process
   */
  export function wait(pid: number): ShellFlow<void, void> {
    return $shell`tail --pid=${pid} -f /dev/null`;
  }

  /**
   * Get system load
   */
  export function load(): ShellFlow<void, LoadAverage> {
    return $shell`uptime`.pipe(parseUptimeOutput);
  }

  /**
   * Get memory usage
   */
  export function memory(): ShellFlow<void, MemoryInfo> {
    return $shell`free -h`.pipe(parseFreeOutput);
  }

  /**
   * Get CPU info
   */
  export function cpu(): ShellFlow<void, CpuInfo> {
    return $shell`lscpu`.pipe(parseLscpuOutput);
  }
}

interface ProcessInfo {
  pid: number;
  ppid: number;
  user: string;
  cpu: number;
  memory: number;
  vsz: number;
  rss: number;
  tty: string;
  stat: string;
  start: Date;
  time: string;
  command: string;
}

interface PsOptions {
  user?: string;
  full?: boolean;
  tree?: boolean;
  threads?: boolean;
}

interface LoadAverage {
  load1: number;
  load5: number;
  load15: number;
  uptime: number;
}

interface MemoryInfo {
  total: number;
  used: number;
  free: number;
  available: number;
  swap: {
    total: number;
    used: number;
    free: number;
  };
}

interface CpuInfo {
  model: string;
  cores: number;
  threads: number;
  architecture: string;
  mhz: number;
}
```

### 3.3 flow-package: Package Management

```typescript
/**
 * Package management operations
 */
export namespace pkg {
  /**
   * Install package
   */
  export function install(packages: string | string[]): ShellFlow<void, void> {
    const pkgList = Array.isArray(packages) ? packages.join(' ') : packages;
    return detectPackageManager().pipe(
      flow((pm: string) => {
        switch (pm) {
          case 'apt':
            return $shell`apt-get install -y ${pkgList}`;
          case 'yum':
            return $shell`yum install -y ${pkgList}`;
          case 'brew':
            return $shell`brew install ${pkgList}`;
          case 'npm':
            return $shell`npm install ${pkgList}`;
          case 'yarn':
            return $shell`yarn add ${pkgList}`;
          case 'pnpm':
            return $shell`pnpm add ${pkgList}`;
          default:
            throw new Error(`Unknown package manager: ${pm}`);
        }
      })
    );
  }

  /**
   * Remove package
   */
  export function remove(packages: string | string[]): ShellFlow<void, void> {
    const pkgList = Array.isArray(packages) ? packages.join(' ') : packages;
    return detectPackageManager().pipe(
      flow((pm: string) => {
        switch (pm) {
          case 'apt':
            return $shell`apt-get remove -y ${pkgList}`;
          case 'yum':
            return $shell`yum remove -y ${pkgList}`;
          case 'brew':
            return $shell`brew uninstall ${pkgList}`;
          case 'npm':
            return $shell`npm uninstall ${pkgList}`;
          case 'yarn':
            return $shell`yarn remove ${pkgList}`;
          case 'pnpm':
            return $shell`pnpm remove ${pkgList}`;
          default:
            throw new Error(`Unknown package manager: ${pm}`);
        }
      })
    );
  }

  /**
   * Update package
   */
  export function update(packages?: string | string[]): ShellFlow<void, void> {
    const pkgList = packages
      ? Array.isArray(packages) ? packages.join(' ') : packages
      : '';

    return detectPackageManager().pipe(
      flow((pm: string) => {
        switch (pm) {
          case 'apt':
            return pkgList
              ? $shell`apt-get install --only-upgrade -y ${pkgList}`
              : $shell`apt-get update && apt-get upgrade -y`;
          case 'yum':
            return pkgList
              ? $shell`yum update -y ${pkgList}`
              : $shell`yum update -y`;
          case 'brew':
            return pkgList
              ? $shell`brew upgrade ${pkgList}`
              : $shell`brew update && brew upgrade`;
          case 'npm':
            return pkgList
              ? $shell`npm update ${pkgList}`
              : $shell`npm update`;
          case 'yarn':
            return pkgList
              ? $shell`yarn upgrade ${pkgList}`
              : $shell`yarn upgrade`;
          case 'pnpm':
            return pkgList
              ? $shell`pnpm update ${pkgList}`
              : $shell`pnpm update`;
          default:
            throw new Error(`Unknown package manager: ${pm}`);
        }
      })
    );
  }

  /**
   * Search for package
   */
  export function search(query: string): ShellFlow<void, PackageInfo[]> {
    return detectPackageManager().pipe(
      flow((pm: string) => {
        switch (pm) {
          case 'apt':
            return $shell`apt-cache search ${query}`.pipe(parseAptSearch);
          case 'yum':
            return $shell`yum search ${query}`.pipe(parseYumSearch);
          case 'brew':
            return $shell`brew search ${query}`.pipe(parseBrewSearch);
          case 'npm':
            return $shell`npm search ${query}`.pipe(parseNpmSearch);
          default:
            throw new Error(`Unknown package manager: ${pm}`);
        }
      })
    );
  }

  /**
   * List installed packages
   */
  export function list(): ShellFlow<void, PackageInfo[]> {
    return detectPackageManager().pipe(
      flow((pm: string) => {
        switch (pm) {
          case 'apt':
            return $shell`dpkg -l`.pipe(parseDpkgList);
          case 'yum':
            return $shell`yum list installed`.pipe(parseYumList);
          case 'brew':
            return $shell`brew list`.pipe(parseBrewList);
          case 'npm':
            return $shell`npm list --depth=0`.pipe(parseNpmList);
          case 'yarn':
            return $shell`yarn list --depth=0`.pipe(parseYarnList);
          case 'pnpm':
            return $shell`pnpm list --depth=0`.pipe(parsePnpmList);
          default:
            throw new Error(`Unknown package manager: ${pm}`);
        }
      })
    );
  }

  /**
   * Detect package manager
   */
  export function detectPackageManager(): ShellFlow<void, string> {
    return flow(async () => {
      // Check for system package managers
      const aptExists = await $shell`which apt-get`.nothrow().exitCode();
      if (aptExists === 0) return 'apt';

      const yumExists = await $shell`which yum`.nothrow().exitCode();
      if (yumExists === 0) return 'yum';

      const brewExists = await $shell`which brew`.nothrow().exitCode();
      if (brewExists === 0) return 'brew';

      // Check for Node package managers
      const pnpmExists = await fs.exists('pnpm-lock.yaml');
      if (pnpmExists) return 'pnpm';

      const yarnExists = await fs.exists('yarn.lock');
      if (yarnExists) return 'yarn';

      const npmExists = await fs.exists('package-lock.json');
      if (npmExists) return 'npm';

      throw new Error('No package manager detected');
    });
  }
}

interface PackageInfo {
  name: string;
  version: string;
  description?: string;
  installed: boolean;
}
```

### 3.4 flow-archive: Archive Operations

```typescript
/**
 * Archive and compression operations
 */
export namespace archive {
  /**
   * Create tar archive
   */
  export function tar(source: string, dest: string, options?: TarOptions): ShellFlow<void, void> {
    const flags = buildTarFlags(options);
    return $shell`tar ${flags} ${dest} ${source}`;
  }

  /**
   * Extract tar archive
   */
  export function untar(source: string, dest?: string, options?: TarOptions): ShellFlow<void, void> {
    const flags = buildUntarFlags(options);
    const target = dest ? `-C ${dest}` : '';
    return $shell`tar ${flags} ${source} ${target}`;
  }

  /**
   * Create zip archive
   */
  export function zip(source: string, dest: string, recursive = true): ShellFlow<void, void> {
    const flags = recursive ? '-r' : '';
    return $shell`zip ${flags} ${dest} ${source}`;
  }

  /**
   * Extract zip archive
   */
  export function unzip(source: string, dest?: string): ShellFlow<void, void> {
    const target = dest ? `-d ${dest}` : '';
    return $shell`unzip ${source} ${target}`;
  }

  /**
   * Compress with gzip
   */
  export function gzip(source: string): ShellFlow<void, void> {
    return $shell`gzip ${source}`;
  }

  /**
   * Decompress gzip
   */
  export function gunzip(source: string): ShellFlow<void, void> {
    return $shell`gunzip ${source}`;
  }

  /**
   * Compress with bzip2
   */
  export function bzip2(source: string): ShellFlow<void, void> {
    return $shell`bzip2 ${source}`;
  }

  /**
   * Decompress bzip2
   */
  export function bunzip2(source: string): ShellFlow<void, void> {
    return $shell`bunzip2 ${source}`;
  }

  /**
   * List archive contents
   */
  export function list(archive: string): ShellFlow<void, string[]> {
    return flow(async () => {
      const ext = archive.split('.').pop()?.toLowerCase();

      switch (ext) {
        case 'tar':
        case 'gz':
        case 'tgz':
          return await $shell`tar -tf ${archive}`.pipe(
            flow((result: ShellResult) => result.stdout.trim().split('\n'))
          );
        case 'zip':
          return await $shell`unzip -l ${archive}`.pipe(
            flow((result: ShellResult) => {
              const lines = result.stdout.trim().split('\n');
              return lines.slice(3, -2).map(line => line.trim().split(/\s+/)[3]!);
            })
          );
        default:
          throw new Error(`Unsupported archive format: ${ext}`);
      }
    });
  }
}

interface TarOptions {
  compress?: 'gzip' | 'bzip2' | 'xz';
  verbose?: boolean;
  preserve?: boolean;
  exclude?: string[];
}
```

### 3.5 flow-os: OS-Level Operations

```typescript
/**
 * OS-level operations
 */
export namespace os {
  /**
   * Get OS information
   */
  export function info(): ShellFlow<void, OsInfo> {
    return flow(async () => {
      const name = await $shell`uname -s`.text();
      const version = await $shell`uname -r`.text();
      const arch = await $shell`uname -m`.text();
      const hostname = await $shell`hostname`.text();

      return {
        name: name.trim(),
        version: version.trim(),
        arch: arch.trim(),
        hostname: hostname.trim(),
      };
    });
  }

  /**
   * Get hostname
   */
  export function hostname(): ShellFlow<void, string> {
    return $shell`hostname`.pipe(
      flow((result: ShellResult) => result.stdout.trim())
    );
  }

  /**
   * Set hostname
   */
  export function setHostname(name: string): ShellFlow<void, void> {
    return $shell`hostnamectl set-hostname ${name}`;
  }

  /**
   * Get uptime
   */
  export function uptime(): ShellFlow<void, number> {
    return $shell`cat /proc/uptime`.pipe(
      flow((result: ShellResult) => {
        const seconds = parseFloat(result.stdout.trim().split(' ')[0]!);
        return seconds;
      })
    );
  }

  /**
   * Reboot system
   */
  export function reboot(delay = 0): ShellFlow<void, void> {
    return delay > 0
      ? $shell`shutdown -r +${delay}`
      : $shell`reboot`;
  }

  /**
   * Shutdown system
   */
  export function shutdown(delay = 0): ShellFlow<void, void> {
    return delay > 0
      ? $shell`shutdown -h +${delay}`
      : $shell`shutdown -h now`;
  }

  /**
   * Get environment variables
   */
  export function env(): ShellFlow<void, Record<string, string>> {
    return $shell`env`.pipe(
      flow((result: ShellResult) => {
        const lines = result.stdout.trim().split('\n');
        const env: Record<string, string> = {};
        for (const line of lines) {
          const [key, ...values] = line.split('=');
          if (key) {
            env[key] = values.join('=');
          }
        }
        return env;
      })
    );
  }

  /**
   * Set environment variable
   */
  export function setEnv(key: string, value: string): ShellFlow<void, void> {
    return $shell`export ${key}="${value}"`;
  }

  /**
   * Get users
   */
  export function users(): ShellFlow<void, UserInfo[]> {
    return $shell`cat /etc/passwd`.pipe(parsePasswdFile);
  }

  /**
   * Get groups
   */
  export function groups(): ShellFlow<void, GroupInfo[]> {
    return $shell`cat /etc/group`.pipe(parseGroupFile);
  }

  /**
   * Add user
   */
  export function addUser(username: string, options?: AddUserOptions): ShellFlow<void, void> {
    const flags = buildUserAddFlags(options);
    return $shell`useradd ${flags} ${username}`;
  }

  /**
   * Remove user
   */
  export function removeUser(username: string, removeHome = false): ShellFlow<void, void> {
    const flags = removeHome ? '-r' : '';
    return $shell`userdel ${flags} ${username}`;
  }

  /**
   * Get network interfaces
   */
  export function networkInterfaces(): ShellFlow<void, NetworkInterface[]> {
    return $shell`ip -json addr show`.pipe(
      flow((result: ShellResult) => JSON.parse(result.stdout))
    );
  }

  /**
   * Get DNS servers
   */
  export function dnsServers(): ShellFlow<void, string[]> {
    return $shell`cat /etc/resolv.conf`.pipe(
      flow((result: ShellResult) => {
        const lines = result.stdout.trim().split('\n');
        return lines
          .filter(line => line.startsWith('nameserver'))
          .map(line => line.split(/\s+/)[1]!)
          .filter(Boolean);
      })
    );
  }

  /**
   * Get routing table
   */
  export function routes(): ShellFlow<void, Route[]> {
    return $shell`ip -json route show`.pipe(
      flow((result: ShellResult) => JSON.parse(result.stdout))
    );
  }

  /**
   * Ping host
   */
  export function ping(host: string, count = 4): ShellFlow<void, PingResult> {
    return $shell`ping -c ${count} ${host}`.pipe(parsePingOutput);
  }

  /**
   * Get date/time
   */
  export function date(): ShellFlow<void, Date> {
    return $shell`date -Iseconds`.pipe(
      flow((result: ShellResult) => new Date(result.stdout.trim()))
    );
  }

  /**
   * Set date/time
   */
  export function setDate(date: Date): ShellFlow<void, void> {
    const iso = date.toISOString();
    return $shell`date -s "${iso}"`;
  }

  /**
   * Get timezone
   */
  export function timezone(): ShellFlow<void, string> {
    return $shell`timedatectl show -p Timezone --value`.pipe(
      flow((result: ShellResult) => result.stdout.trim())
    );
  }

  /**
   * Set timezone
   */
  export function setTimezone(tz: string): ShellFlow<void, void> {
    return $shell`timedatectl set-timezone ${tz}`;
  }
}

interface OsInfo {
  name: string;
  version: string;
  arch: string;
  hostname: string;
}

interface UserInfo {
  username: string;
  uid: number;
  gid: number;
  home: string;
  shell: string;
}

interface GroupInfo {
  name: string;
  gid: number;
  members: string[];
}

interface AddUserOptions {
  uid?: number;
  gid?: number;
  home?: string;
  shell?: string;
  groups?: string[];
}

interface NetworkInterface {
  ifname: string;
  flags: string[];
  mtu: number;
  addr_info: AddressInfo[];
}

interface AddressInfo {
  family: 'inet' | 'inet6';
  local: string;
  prefixlen: number;
  broadcast?: string;
}

interface Route {
  dst: string;
  gateway?: string;
  dev: string;
  protocol: string;
  metric?: number;
}

interface PingResult {
  host: string;
  transmitted: number;
  received: number;
  packetLoss: number;
  rttMin: number;
  rttAvg: number;
  rttMax: number;
  rttMdev: number;
}
```

---

## Part IV: Advanced Features

### 4.1 Cognitive Capabilities

```typescript
/**
 * Cognitive shell flow with learning capabilities
 */
export class CognitiveShellFlow<In, Out> extends BaseShellFlow<In, Out> {
  private readonly learner: ShellLearner;
  private readonly reasoner: ShellReasoner;
  private readonly knowledgeBase: ShellKnowledgeBase;

  /**
   * Learn from execution patterns
   */
  async learn(examples: ShellExample[]): Promise<void> {
    // Extract patterns from successful executions
    const patterns = await this.learner.extractPatterns(examples);

    // Learn optimal retry strategies
    const retryStrategies = await this.learner.learnRetryStrategies(examples);

    // Learn error recovery patterns
    const recoveryPatterns = await this.learner.learnRecoveryPatterns(examples);

    // Update knowledge base
    this.knowledgeBase.addPatterns(patterns);
    this.knowledgeBase.addRetryStrategies(retryStrategies);
    this.knowledgeBase.addRecoveryPatterns(recoveryPatterns);
  }

  /**
   * Explain shell command behavior
   */
  explain(): ShellExplanation {
    return {
      command: this.command.command,
      purpose: this.reasoner.inferPurpose(this.command),
      effects: this.analyzeEffects(this.command),
      risks: this.analyzeRisks(),
      alternatives: this.suggestAlternatives(),
      bestPractices: this.getBestPractices(),
      documentation: this.generateDocumentation(),
      examples: this.findSimilarExamples(),
    };
  }

  /**
   * Suggest command improvements
   */
  optimize(): ShellFlow<In, Out> {
    const improvements = this.reasoner.suggestImprovements(this.command);

    return flow(async (input: In) => {
      // Apply improvements
      const optimizedCommand = this.applyImprovements(this.command, improvements);

      // Execute optimized command
      const result = await this.target.execute(optimizedCommand);

      return this.processResult(result) as Out;
    });
  }

  /**
   * Auto-retry with learned strategies
   */
  smartRetry(): ShellFlow<In, Out> {
    return flow(async (input: In) => {
      const strategy = this.knowledgeBase.getOptimalRetryStrategy(this.command);

      for (let attempt = 0; attempt < strategy.maxAttempts; attempt++) {
        try {
          return await this(input);
        } catch (error) {
          if (this.shouldRetry(error, strategy)) {
            await this.delay(strategy.backoff(attempt));

            // Try recovery if available
            const recovery = this.knowledgeBase.getRecoveryPattern(error);
            if (recovery) {
              await recovery.execute();
            }
          } else {
            throw error;
          }
        }
      }

      throw new Error('Max retry attempts exceeded');
    });
  }

  /**
   * Self-healing execution
   */
  selfHeal(): ShellFlow<In, Out> {
    return flow(async (input: In) => {
      try {
        return await this(input);
      } catch (error) {
        // Analyze error
        const analysis = this.reasoner.analyzeError(error, this.command);

        // Find recovery strategy
        const recovery = this.knowledgeBase.findRecovery(analysis);

        if (recovery) {
          // Execute recovery
          await recovery.execute();

          // Retry original command
          return await this(input);
        }

        throw error;
      }
    });
  }
}

interface ShellExample {
  command: ShellCommand;
  result: ShellResult;
  context: ExecutionContext;
  success: boolean;
  metadata: Record<string, any>;
}

interface ShellExplanation {
  command: string;
  purpose: string;
  effects: ShellEffectAnalysis;
  risks: SecurityRisk[];
  alternatives: Alternative[];
  bestPractices: BestPractice[];
  documentation: Documentation;
  examples: ShellExample[];
}

interface Alternative {
  command: string;
  description: string;
  advantages: string[];
  disadvantages: string[];
}

interface BestPractice {
  title: string;
  description: string;
  rationale: string;
  example: string;
}

interface Documentation {
  summary: string;
  syntax: string;
  options: Option[];
  examples: Example[];
  relatedCommands: string[];
}

interface Option {
  flag: string;
  description: string;
  type: string;
  default?: any;
}

interface Example {
  command: string;
  description: string;
  output?: string;
}
```

### 4.2 Error Recovery & Resilience

```typescript
/**
 * Error recovery strategies
 */
export namespace recovery {
  /**
   * Auto-retry with exponential backoff
   */
  export function exponentialRetry(
    maxAttempts = 3,
    baseDelay = 1000,
    maxDelay = 30000
  ): FlowTransform {
    return (flow: ShellFlow) => {
      return new BaseShellFlow(
        flow.target,
        flow.command,
        {
          ...flow.options,
          retry: {
            maxAttempts,
            backoff: 'exponential',
            baseDelay,
            maxDelay,
          },
        }
      );
    };
  }

  /**
   * Fallback to alternative command
   */
  export function fallback(alternative: ShellFlow): FlowTransform {
    return (primary: ShellFlow) => {
      return flow(async (input: any) => {
        try {
          return await primary(input);
        } catch (error) {
          console.warn('Primary command failed, trying fallback:', error);
          return await alternative(input);
        }
      });
    };
  }

  /**
   * Circuit breaker pattern
   */
  export function circuitBreaker(options: CircuitBreakerOptions): FlowTransform {
    const breaker = new CircuitBreaker(options);

    return (flow: ShellFlow) => {
      return new BaseShellFlow(
        flow.target,
        flow.command,
        {
          ...flow.options,
          beforeExecute: async () => {
            await breaker.checkState();
          },
          afterExecute: async (result) => {
            breaker.recordSuccess();
          },
          onError: async (error) => {
            breaker.recordFailure();
            throw error;
          },
        }
      );
    };
  }

  /**
   * Graceful degradation
   */
  export function degrade(fallbackValue: any): FlowTransform {
    return (flow: ShellFlow) => {
      return flow.pipe(
        flow(async (result: ShellResult) => {
          if (result.exitCode !== 0) {
            console.warn('Command failed, using fallback value');
            return fallbackValue;
          }
          return result;
        })
      );
    };
  }

  /**
   * Health check with auto-recovery
   */
  export function healthCheck(
    check: Flow<void, boolean>,
    recover: Flow<void, void>
  ): FlowTransform {
    return (flow: ShellFlow) => {
      return new BaseShellFlow(
        flow.target,
        flow.command,
        {
          ...flow.options,
          beforeExecute: async () => {
            const healthy = await check();
            if (!healthy) {
              console.warn('Health check failed, attempting recovery');
              await recover();
            }
          },
        }
      );
    };
  }
}

interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  halfOpenRequests: number;
}

class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failures = 0;
  private lastFailureTime: number | null = null;
  private halfOpenRequests = 0;

  constructor(private options: CircuitBreakerOptions) {}

  async checkState(): Promise<void> {
    if (this.state === 'open') {
      const now = Date.now();
      if (
        this.lastFailureTime &&
        now - this.lastFailureTime > this.options.resetTimeout
      ) {
        this.state = 'half-open';
        this.halfOpenRequests = 0;
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    if (this.state === 'half-open') {
      if (this.halfOpenRequests >= this.options.halfOpenRequests) {
        throw new Error('Circuit breaker is half-open and at capacity');
      }
      this.halfOpenRequests++;
    }
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.state = 'closed';
      this.failures = 0;
      this.halfOpenRequests = 0;
    }
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.options.failureThreshold) {
      this.state = 'open';
    }
  }
}

type FlowTransform = (flow: ShellFlow) => ShellFlow;
```

### 4.3 Performance Optimization

```typescript
/**
 * Performance optimization strategies
 */
export namespace optimize {
  /**
   * Parallel execution of independent commands
   */
  export function parallel<T>(
    flows: ShellFlow[]
  ): Flow<T, ShellResult[]> {
    return flow(async (input: T) => {
      return Promise.all(flows.map(f => f(input)));
    });
  }

  /**
   * Batch multiple commands
   */
  export function batch<T>(
    commands: string[],
    separator = ';'
  ): ShellFlow<T, ShellResult> {
    const batchCommand = commands.join(` ${separator} `);
    return $shell`${batchCommand}`;
  }

  /**
   * Cache command results
   */
  export function cache(
    ttl = 60000,
    keyFn: (input: any) => string = JSON.stringify
  ): FlowTransform {
    const cache = new Map<string, { result: any; expires: number }>();

    return (flow: ShellFlow) => {
      return new Proxy(flow, {
        apply: async (target, thisArg, args) => {
          const key = keyFn(args[0]);
          const cached = cache.get(key);

          if (cached && Date.now() < cached.expires) {
            return cached.result;
          }

          const result = await target.apply(thisArg, args);
          cache.set(key, {
            result,
            expires: Date.now() + ttl,
          });

          return result;
        },
      }) as ShellFlow;
    };
  }

  /**
   * Debounce command execution
   */
  export function debounce(delayMs: number): FlowTransform {
    let timer: NodeJS.Timeout | null = null;
    let pendingResolves: Array<(value: any) => void> = [];

    return (flow: ShellFlow) => {
      return flow.pipe(
        flow(async (input: any) => {
          return new Promise((resolve) => {
            if (timer) clearTimeout(timer);
            pendingResolves.push(resolve);

            timer = setTimeout(async () => {
              const result = await flow(input);
              const resolves = pendingResolves;
              pendingResolves = [];
              timer = null;
              resolves.forEach(r => r(result));
            }, delayMs);
          });
        })
      );
    };
  }

  /**
   * Stream processing for large outputs
   */
  export function stream(): FlowTransform {
    return (flow: ShellFlow) => {
      return flow.pipe(
        flow(async (input: any) => {
          const chunks: string[] = [];

          for await (const chunk of flow.stdout()) {
            chunks.push(chunk);
          }

          return {
            stdout: chunks.join(''),
            stderr: '',
            exitCode: 0,
          };
        })
      );
    };
  }

  /**
   * Connection pooling for SSH
   */
  export function pool(options: PoolOptions): SSHTargetConfig {
    return {
      ...options,
      poolSize: options.poolSize || 10,
      keepalive: true,
      keepaliveInterval: options.keepaliveInterval || 5000,
    };
  }
}

interface PoolOptions extends SSHTargetConfig {
  poolSize?: number;
  keepaliveInterval?: number;
}
```

---

## Part V: Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)

**Goals**: Core infrastructure and basic execution

1. **Core Types & Interfaces** (Week 1)
   - [ ] Define all TypeScript interfaces
   - [ ] Create effect flag enums
   - [ ] Set up project structure
   - [ ] Configure build tooling

2. **Execution Targets** (Week 1-2)
   - [ ] Implement LocalTarget (wrap xec-core LocalAdapter)
   - [ ] Implement SSHTarget (wrap xec-core SSHAdapter)
   - [ ] Implement DockerTarget (wrap xec-core DockerAdapter)
   - [ ] Implement KubernetesTarget (wrap xec-core K8sAdapter)

3. **Basic Shell Flow** (Week 2)
   - [ ] Implement BaseShellFlow class
   - [ ] Implement template literal parsing
   - [ ] Implement basic composition (pipe)
   - [ ] Add effect tracking

**Deliverables**:
- Working shell execution on all targets
- Basic Flow composition
- Effect tracking

### Phase 2: Flow Modules (Weeks 3-4)

**Goals**: High-level flow modules for common operations

1. **flow-fs Module** (Week 3)
   - [ ] File operations (read, write, copy, move, delete)
   - [ ] Directory operations (list, mkdir, find)
   - [ ] Permission operations (chmod, chown)
   - [ ] Disk operations (du, df)

2. **flow-process Module** (Week 3)
   - [ ] Process listing and management
   - [ ] System resource monitoring
   - [ ] Background process management

3. **flow-package Module** (Week 4)
   - [ ] Package manager detection
   - [ ] Universal install/remove/update
   - [ ] Package search and list

4. **flow-archive Module** (Week 4)
   - [ ] Tar operations
   - [ ] Zip operations
   - [ ] Compression utilities

5. **flow-os Module** (Week 4)
   - [ ] OS information
   - [ ] User/group management
   - [ ] Network operations
   - [ ] System control

**Deliverables**:
- Complete flow-fs module with tests
- Complete flow-process module with tests
- Complete flow-package module with tests
- Complete flow-archive module with tests
- Complete flow-os module with tests

### Phase 3: Advanced Features (Weeks 5-6)

**Goals**: Cognitive capabilities, error recovery, optimization

1. **Cognitive Integration** (Week 5)
   - [ ] Shell learner implementation
   - [ ] Shell reasoner implementation
   - [ ] Knowledge base implementation
   - [ ] Pattern recognition

2. **Error Recovery** (Week 5)
   - [ ] Retry strategies
   - [ ] Circuit breaker
   - [ ] Health checks
   - [ ] Fallback mechanisms

3. **Performance Optimization** (Week 6)
   - [ ] Parallel execution
   - [ ] Batch operations
   - [ ] Caching layer
   - [ ] Connection pooling

4. **Stream Processing** (Week 6)
   - [ ] Line-by-line streaming
   - [ ] JSON stream processing
   - [ ] Filtered streaming
   - [ ] Transformed streaming

**Deliverables**:
- Cognitive shell flows
- Comprehensive error recovery
- Performance optimizations
- Stream processing utilities

### Phase 4: Production Hardening (Weeks 7-8)

**Goals**: Testing, documentation, examples

1. **Testing** (Week 7)
   - [ ] Unit tests for all modules (>90% coverage)
   - [ ] Integration tests for all targets
   - [ ] Performance benchmarks
   - [ ] Security audit

2. **Documentation** (Week 7-8)
   - [ ] API documentation (TSDoc)
   - [ ] Usage guides
   - [ ] Architecture documentation
   - [ ] Migration guide from xec-core

3. **Examples** (Week 8)
   - [ ] Basic usage examples
   - [ ] Advanced composition examples
   - [ ] Real-world use cases
   - [ ] Best practices guide

4. **Tooling** (Week 8)
   - [ ] CLI wrapper
   - [ ] VS Code extension
   - [ ] Debugging tools
   - [ ] Visualization tools

**Deliverables**:
- Complete test suite
- Comprehensive documentation
- Rich example library
- Developer tooling

---

## Part VI: Usage Examples

### Example 1: Simple Deployment Pipeline

```typescript
import { $shell, ssh, flow } from '@omnitron-dev/holon-flow/shell';

const deploy = flow<{ server: string; branch: string }, DeployResult>()
  .pipe(({ server, branch }) => ssh({ host: server }))
  .pipe($shell`cd /app`)
  .pipe($shell`git fetch origin`)
  .pipe(({ branch }) => $shell`git checkout ${branch}`)
  .pipe($shell`git pull origin ${branch}`)
  .pipe($shell`npm install`)
  .pipe($shell`npm run build`)
  .pipe($shell`pm2 restart app`)
  .pipe(flow(async () => ({
    success: true,
    timestamp: new Date(),
  })));

// Execute deployment
const result = await deploy({
  server: 'prod-server.com',
  branch: 'main',
});
```

### Example 2: Multi-Server Health Check

```typescript
import { parallel, ssh, flow } from '@omnitron-dev/holon-flow/shell';
import { process, os } from '@omnitron-dev/holon-flow/shell/modules';

const servers = ['web-1', 'web-2', 'api-1', 'api-2'];

const healthCheck = flow<string, ServerHealth>()
  .pipe(server => ssh({ host: server }))
  .pipe(parallel([
    process.load(),
    process.memory(),
    os.diskSpace('/'),
    process.ps({ user: 'app' }),
  ]))
  .pipe(([load, memory, disk, processes]) => ({
    load,
    memory,
    disk,
    processCount: processes.length,
    healthy: load.load1 < 5 && memory.percent < 80 && disk.percent < 90,
  }));

// Check all servers
const results = await Promise.all(
  servers.map(server => healthCheck(server))
);

// Report
results.forEach((health, i) => {
  console.log(`${servers[i]}: ${health.healthy ? 'OK' : 'WARNING'}`);
});
```

### Example 3: Backup with Cognitive Learning

```typescript
import { cognitiveFlow, fs, archive } from '@omnitron-dev/holon-flow/shell';

const backup = cognitiveFlow<BackupConfig, BackupResult>()
  .pipe(({ source, dest }) => fs.du(source))
  .pipe(({ size }) => {
    // Learn optimal compression based on size
    return size > 1e9 ? archive.tar(source, dest, { compress: 'gzip' })
                      : archive.tar(source, dest);
  })
  .pipe(() => archive.verify(dest))
  .pipe(result => ({
    success: result.verified,
    size: result.size,
    duration: result.duration,
  }))
  .smartRetry() // Use learned retry strategies
  .selfHeal();  // Auto-recover from errors

// Learn from previous backups
await backup.learn(previousBackups);

// Execute backup
const result = await backup({
  source: '/data/production',
  dest: '/backups/prod-2025-10-16.tar.gz',
});

// Get explanation
const explanation = backup.explain();
console.log(explanation.purpose);
```

### Example 4: Container Orchestration

```typescript
import { docker, k8s, flow } from '@omnitron-dev/holon-flow/shell';

const deployToKubernetes = flow<DeployConfig, K8sDeployment>()
  // Build Docker image
  .pipe(config => docker({ image: config.imageName }))
  .pipe($shell`docker build -t ${config.imageName} .`)

  // Push to registry
  .pipe($shell`docker push ${config.imageName}`)

  // Deploy to Kubernetes
  .pipe(config => k8s({ namespace: config.namespace }))
  .pipe($shell`kubectl set image deployment/${config.deployment} app=${config.imageName}`)

  // Wait for rollout
  .pipe($shell`kubectl rollout status deployment/${config.deployment}`)

  // Verify deployment
  .pipe(config => k8s.status(config.deployment))
  .pipe(status => ({
    deployed: status.phase === 'Running',
    replicas: status.replicas,
    timestamp: new Date(),
  }));

const result = await deployToKubernetes({
  imageName: 'myapp:v1.2.3',
  namespace: 'production',
  deployment: 'myapp',
});
```

---

## Conclusion

Flow-Shell provides a powerful, type-safe, and composable abstraction for shell automation across diverse execution environments. By integrating xec-core's battle-tested execution engine with Flow-Machine's compositional and cognitive architecture, it enables:

1. **Universal Execution** - Single API for local, SSH, Docker, and Kubernetes
2. **Type Safety** - Full TypeScript types with runtime validation
3. **Effect Tracking** - Automatic tracking of all side effects
4. **Composition** - Pipeline complex workflows with .pipe()
5. **Cognitive Capabilities** - Learning, reasoning, and self-improvement
6. **Production Ready** - Comprehensive error handling and resilience

The modular architecture allows for incremental adoption and extension, while maintaining full compatibility with existing xec-core code. This specification provides a clear roadmap for implementation, from foundational components through advanced cognitive features.

**Status**: Ready for implementation
**Target**: holon-flow package
**Dependencies**: xec-core, holon-flow core
**Timeline**: 8 weeks to full production readiness
