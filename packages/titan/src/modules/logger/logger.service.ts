/**
 * Logger Service Implementation
 */

import os from 'node:os';
import { Writable } from 'node:stream';
import pino, { Logger as PinoLogger, multistream } from 'pino';
import prettyStream from 'pino-pretty';
import { Injectable, Inject, Optional } from '../../decorators/index.js';

/**
 * T#67: Wrap a user-provided stream so its `_write` cannot block
 * pino's multistream hot path. Deferring the inner write to a
 * `setImmediate` tick yields back to the event loop after each
 * dispatch and ensures one slow downstream consumer (or a fully
 * synchronous one) can't stall pino, the daemon, or its siblings.
 *
 * Already-wrapped streams are returned as-is via a marker symbol
 * so repeated initialisations (tests, hot-reload) don't pile up
 * forwarders.
 */
const ASYNC_WRAPPED = Symbol.for('@omnitron-dev/titan/logger/async-wrapped');

function wrapAsyncStream(dest: NodeJS.WritableStream): NodeJS.WritableStream {
  if (!dest || (dest as any)[ASYNC_WRAPPED]) return dest;
  const wrapper = new Writable({
    write(chunk: Buffer, _enc: BufferEncoding, callback: (err?: Error | null) => void) {
      // Defer to the next macrotask so a sync `_write` on the inner
      // stream can't run in the same tick as pino's logging call.
      setImmediate(() => {
        try {
          // Mirror Node's "drain"-style backpressure signal by
          // ignoring the return value — `_write` is non-blocking,
          // and bookkeeping on the inner stream is its own concern.
          dest.write(chunk);
          callback();
        } catch (err) {
          callback(err as Error);
        }
      });
    },
  });
  (wrapper as any)[ASYNC_WRAPPED] = true;
  return wrapper as unknown as NodeJS.WritableStream;
}

import { LOGGER_OPTIONS_TOKEN, LOGGER_TRANSPORTS_TOKEN, LOGGER_PROCESSORS_TOKEN } from './logger.tokens.js';

// Import directly from config.tokens to avoid circular dependency
// (config/index.js re-exports LOGGER_TOKEN which imports from logger/index.js)
import { CONFIG_SERVICE_TOKEN } from '../config/config.tokens.js';

import type {
  ILogger,
  ILoggerModule,
  ILoggerOptions,
  ILoggerModuleOptions,
  ITransport,
  ILogProcessor,
  LogLevel,
} from './logger.types.js';

/**
 * Logger implementation wrapping Pino
 */
class LoggerImpl implements ILogger {
  constructor(private readonly _pino: PinoLogger) {}

  trace(objOrMsg: object | string, ...args: any[]): void {
    if (typeof objOrMsg === 'object') {
      this._pino.trace(objOrMsg, ...args);
    } else {
      this._pino.trace(objOrMsg, ...args);
    }
  }

  debug(objOrMsg: object | string, ...args: any[]): void {
    if (typeof objOrMsg === 'object') {
      this._pino.debug(objOrMsg, ...args);
    } else {
      this._pino.debug(objOrMsg, ...args);
    }
  }

  info(objOrMsg: object | string, ...args: any[]): void {
    if (typeof objOrMsg === 'object') {
      this._pino.info(objOrMsg, ...args);
    } else {
      this._pino.info(objOrMsg, ...args);
    }
  }

  warn(objOrMsg: object | string, ...args: any[]): void {
    if (typeof objOrMsg === 'object') {
      this._pino.warn(objOrMsg, ...args);
    } else {
      this._pino.warn(objOrMsg, ...args);
    }
  }

  error(objOrMsg: object | string, ...args: any[]): void {
    if (typeof objOrMsg === 'object') {
      this._pino.error(objOrMsg, ...args);
    } else {
      this._pino.error(objOrMsg, ...args);
    }
  }

  fatal(objOrMsg: object | string, ...args: any[]): void {
    if (typeof objOrMsg === 'object') {
      this._pino.fatal(objOrMsg, ...args);
    } else {
      this._pino.fatal(objOrMsg, ...args);
    }
  }

  child(bindings: object): ILogger {
    return new LoggerImpl(this._pino.child(bindings));
  }

  time(label?: string): () => void {
    const start = Date.now();
    const id = label || 'time-' + Math.random().toString(36).substr(2, 9);

    return () => {
      const duration = Date.now() - start;
      this._pino.info({ duration, label: id }, `Timer ${id} completed in ${duration}ms`);
    };
  }

  isLevelEnabled(level: LogLevel): boolean {
    return this._pino.isLevelEnabled(level);
  }

  setLevel(level: LogLevel): void {
    this._pino.level = level;
  }

  getLevel(): LogLevel {
    return this._pino.level as LogLevel;
  }
}

/**
 * Serialize an `error` / `cause` field the way pino serializes `err`, while
 * leaving anything that is not an Error untouched — plenty of call sites pass
 * `{ error: someMessage }` or a plain object, and those must survive verbatim.
 */
function serializeErrorField(value: unknown): unknown {
  return value instanceof Error ? pino.stdSerializers.err(value as Error & { type?: string }) : value;
}

/**
 * Logger Service
 */
@Injectable()
export class LoggerService implements ILoggerModule {
  private rootLogger!: PinoLogger;
  private globalLogger!: ILogger;
  private transports: ITransport[] = [];
  private processors: ILogProcessor[] = [];
  private transportFanout?: NodeJS.WritableStream;
  private context: object = {};
  private loggers = new Map<string, ILogger>();
  private initialized = false;

  constructor(
    @Optional() @Inject(LOGGER_OPTIONS_TOKEN) private options: ILoggerModuleOptions = {},
    @Optional() @Inject(LOGGER_TRANSPORTS_TOKEN) initialTransports?: ITransport[],
    @Optional() @Inject(LOGGER_PROCESSORS_TOKEN) initialProcessors?: ILogProcessor[],
    @Optional() @Inject(CONFIG_SERVICE_TOKEN) private configService?: any
  ) {
    // Register configured transports/processors BEFORE initialize() so the
    // root logger is built with knowledge of them (the multistream branch +
    // the transport fan-out are decided at init). `addTransport`/`addProcessor`
    // after init still work: processors are read by reference on every log, and
    // the fan-out stream (present whenever any transport was configured at
    // init) likewise reads the live transport list.
    //
    // Source order: the explicitly-injected args (DI tokens, also how
    // `forRoot` passes `options.transports`/`options.processors`) take
    // precedence; otherwise fall back to the `options` fields. The `??` avoids
    // double-adding when forRoot supplies both (it passes the same arrays).
    const transports = initialTransports ?? this.options.transports;
    const processors = initialProcessors ?? this.options.processors;
    if (transports) {
      this.transports.push(...transports);
    }
    if (processors) {
      this.processors.push(...processors);
    }

    this.initialize();
  }

  private initialize(): void {
    if (this.initialized) return;

    // Get configuration from options or config service
    const config = this.getConfiguration();

    // Create root logger with configuration
    const self = this;
    const pinoOptions: ILoggerOptions = {
      level: config.level || 'info',
      name: config.name || 'titan-app',
      // pino binds a serializer to a FIELD NAME, and `stdSerializers` only
      // defines `err`. Every `logger.error({ error: someError }, ...)` therefore
      // reached the log as `{"error":{}}` — Error's own properties (message,
      // stack) are non-enumerable, so plain JSON serialisation empties it. The
      // failure was reported; the cause was silently discarded. Verified
      // against pino 10: `{err}` carries type/message/stack, `{error}` and
      // `{cause}` both produce `{}`.
      //
      // Aliasing the two other names people actually reach for fixes every
      // existing call site and every future one, which renaming call sites
      // cannot: the next `error:` would reintroduce it.
      serializers: {
        ...pino.stdSerializers,
        error: serializeErrorField,
        cause: serializeErrorField,
      },
      redact: config.redact || [],
      base: {
        pid: process.pid,
        hostname: os.hostname(),
        ...config.base,
      },
      timestamp: (() => {
        const timestampConfig = config.timestamp ?? true;
        return !timestampConfig ? false : pino.stdTimeFunctions.isoTime;
      })(),
      messageKey: config.messageKey || 'msg',
      nestedKey: config.nestedKey,
      enabled: config.enabled !== false,
      // Wire the ILogProcessor pipeline. pino's `logMethod` hook runs on every
      // log call and is inherited by child loggers, so processors apply
      // everywhere. Each processor may transform the record or DROP the log by
      // returning null/undefined. Fast-path: with no processors registered this
      // is a single length check + passthrough, so the common case keeps pino's
      // native overhead. `this.processors` is read by reference, so
      // `addProcessor()` after init takes effect on the next log.
      hooks: {
        logMethod(this: PinoLogger, inputArgs: any[], method: (...a: any[]) => void, level: number): void {
          if (self.processors.length === 0) {
            method.apply(this, inputArgs);
            return;
          }
          self.runProcessors(this, inputArgs, method, level);
        },
      },
    } as ILoggerOptions;

    // Pretty (human-readable) output for development — pino-pretty as a
    // destination stream. Production stays on structured JSON.
    const prettyPrint =
      config.prettyPrint === true ||
      config.pretty === true ||
      (config.environment === 'development' && config.prettyPrint !== false && config.pretty !== false);
    const makeStdoutStream = (): NodeJS.WritableStream =>
      prettyPrint
        ? (prettyStream({ colorize: true }) as unknown as NodeJS.WritableStream)
        : (process.stdout as unknown as NodeJS.WritableStream);

    // Build destination. ITransport sinks and extra `destinations` both require
    // a multistream; a bare stdout uses the async-destination fast path (T#66).
    const destinations = this.options.destinations;
    const hasDestinations = !!(destinations && destinations.length > 0);
    const hasTransports = this.transports.length > 0;

    if (hasDestinations || hasTransports) {
      // T#67: pino's multistream calls `.write()` on every registered
      // stream synchronously within its hot path. If any of those
      // streams has a synchronous `_write` — or one that does a
      // blocking syscall (slow NFS, full disk on EBS, a transport
      // chaining back into another sync logger) — the daemon's
      // event loop stalls for the duration of that syscall. Wrap
      // every USER-supplied stream in an async forwarder so a slow
      // sub-stream can't block pino itself or its siblings. The
      // stdout stream (raw `process.stdout`, or the pino-pretty
      // stream) is left as-is: a TTY/host-managed sink.
      const streams: Array<{ stream: NodeJS.WritableStream; level?: string }> = [
        { stream: makeStdoutStream() },
      ];
      if (hasDestinations) {
        for (const dest of destinations!) {
          if ('stream' in dest && dest.stream) {
            streams.push({
              stream: wrapAsyncStream((dest as any).stream),
              level: (dest as any).level,
            });
          } else {
            streams.push({
              stream: wrapAsyncStream(dest as unknown as NodeJS.WritableStream),
            });
          }
        }
      }
      if (hasTransports) {
        // ITransport sinks receive the fully-serialised record off pino's hot
        // path via this fan-out stream (reads `this.transports` by reference).
        streams.push({ stream: this.createTransportFanout() });
      }
      this.rootLogger = pino(pinoOptions, multistream(streams as any));
    } else if (prettyPrint) {
      // Dev pretty output straight to stdout. pino-pretty manages its own
      // stdout writes, so the async-destination flush hook does not apply here.
      this.rootLogger = pino(pinoOptions, makeStdoutStream() as any);
    } else {
      // T#66: pino without a second-arg defaults to a SYNC stdout
      // destination — every `logger.info(...)` blocks the event
      // loop on the kernel's `write()` syscall. On a daemon that
      // logs heavily, or whose stdout is piped to a slow consumer
      // (file, network, sluggish terminal), each log call becomes
      // a multi-millisecond pause that adds up to seconds of total
      // stall. Use an explicit async destination instead; the cost
      // is that unflushed buffered lines can be lost if the
      // process is SIGKILL'd, but the shutdown hook below
      // (see `flushOnExit`) recovers what it can on clean exit.
      const asyncStdout = pino.destination({ dest: 1, sync: false });
      this.rootLogger = pino(pinoOptions, asyncStdout);
      this.installFlushOnExit(asyncStdout);
    }

    // Create global logger
    this.globalLogger = new LoggerImpl(this.rootLogger);

    // Apply initial context if provided
    if (this.options.context) {
      this.setContext(this.options.context);
    }

    this.initialized = true;
  }

  /**
   * Global registry of destinations whose buffered lines should be
   * flushed on process exit (T#70).
   *
   * Pre-T#70 the flush hook was a single closure captured over the
   * FIRST `LoggerService` instance's destination, gated by a static
   * `flushHookInstalled` flag. Subsequent instances skipped
   * installation — but their destinations were therefore never
   * flushed at all, AND if the original instance was destroyed the
   * hook referenced a dead destination. With this registry, every
   * instance contributes its destination once; the single shared
   * exit hook iterates over all of them.
   *
   * Using a Set (not an Array) means destroying an instance and then
   * creating a fresh one with the same destination won't double-flush.
   */
  private static flushDestinations = new Set<{ flushSync?: () => void }>();
  private static flushHookInstalled = false;

  /**
   * Install a `beforeExit` / signal flush hook for an async pino
   * destination (T#66 + T#70). Recovers buffered lines on clean exit
   * so the operator doesn't lose the last batch of logs to a bare
   * `Ctrl+C`. SIGKILL still loses unflushed data — there's no
   * recovery in user-space for that.
   *
   * The actual exit hook is installed ONCE per process; later
   * instances just register their destination into the shared set.
   */
  private installFlushOnExit(destination: { flushSync?: () => void }): void {
    LoggerService.flushDestinations.add(destination);
    if (LoggerService.flushHookInstalled) return;
    LoggerService.flushHookInstalled = true;
    const flushAll = (): void => {
      for (const dest of LoggerService.flushDestinations) {
        try {
          dest.flushSync?.();
        } catch {
          /* best-effort */
        }
      }
    };
    process.once('beforeExit', flushAll);
    process.once('SIGTERM', flushAll);
    process.once('SIGINT', flushAll);
  }

  private getConfiguration(): any {
    const config: any = { ...this.options };

    // Try to get configuration from ConfigService if available
    // Note: ConfigService might not be initialized yet during construction
    if (this.configService && typeof this.configService.get === 'function') {
      try {
        config.level = this.configService.get('logger.level', config.level);
        config.prettyPrint = this.configService.get('logger.prettyPrint', config.prettyPrint);
        config.redact = this.configService.get('logger.redact', config.redact);
        config.base = this.configService.get('logger.base', config.base);
        config.timestamp = this.configService.get('logger.timestamp', config.timestamp);
        config.messageKey = this.configService.get('logger.messageKey', config.messageKey);
        config.nestedKey = this.configService.get('logger.nestedKey', config.nestedKey);
        config.enabled = this.configService.get('logger.enabled', config.enabled);
        config.pretty = this.configService.get('logger.pretty', config.pretty);
        config.environment = this.configService.get('environment', 'development');
        config.name = this.configService.get('name', config.name);
      } catch {
        // ConfigService might not be fully initialized, use defaults
        // This is expected during early initialization phase
      }
    }

    return config;
  }

  /**
   * Create a named logger
   */
  create(name: string, options?: ILoggerOptions): ILogger {
    if (this.loggers.has(name)) {
      return this.loggers.get(name)!;
    }

    const childLogger = this.rootLogger.child({
      name,
      ...this.context,
    });

    const logger = new LoggerImpl(childLogger);
    this.loggers.set(name, logger);

    return logger;
  }

  /**
   * Create a child logger with additional bindings
   */
  child(bindings: object): ILogger {
    return new LoggerImpl(
      this.rootLogger.child({
        ...this.context,
        ...bindings,
      })
    );
  }

  /**
   * Get the global logger
   */
  get logger(): ILogger {
    if (!this.initialized) {
      this.initialize();
    }
    return this.globalLogger;
  }

  /**
   * Set the log level
   */
  setLevel(level: LogLevel): void {
    this.rootLogger.level = level;

    // Update all child loggers
    for (const logger of this.loggers.values()) {
      logger.setLevel(level);
    }
  }

  /**
   * Add a transport
   */
  addTransport(transport: ITransport): void {
    this.transports.push(transport);
  }

  /**
   * Add a processor
   */
  addProcessor(processor: ILogProcessor): void {
    this.processors.push(processor);
  }

  /**
   * Run the processor pipeline for a single log call (invoked from pino's
   * `logMethod` hook). Builds the record the processors see — the child
   * bindings merged with the per-call fields plus `level`/`time`/`msg`/`err`
   * meta — runs each processor in order, and either drops the log (a processor
   * returned null/undefined) or forwards the transformed fields to pino.
   *
   * A top-level `Error` argument is preserved as-is so pino's native error
   * serialiser still applies; the meta `level`/`time` are stripped before the
   * call so pino emits its own.
   */
  private runProcessors(
    pinoLogger: PinoLogger,
    args: any[],
    method: (...a: any[]) => void,
    level: number
  ): void {
    const errorFirst = args.length > 0 && args[0] instanceof Error;
    const objFirst = !errorFirst && args.length > 0 && typeof args[0] === 'object' && args[0] !== null;
    const mergeObj: Record<string, any> = objFirst ? (args[0] as Record<string, any>) : {};
    const hasLead = objFirst || errorFirst;
    const msg = hasLead ? args[1] : args[0];
    const interp = args.slice(hasLead ? 2 : 1);

    const levelLabel = (pinoLogger as any).levels?.labels?.[level] ?? String(level);
    let record: any = {
      level: levelLabel,
      time: Date.now(),
      ...pinoLogger.bindings(),
      ...mergeObj,
    };
    if (errorFirst) record.err = args[0];
    if (msg !== undefined) record.msg = msg;

    for (const processor of this.processors) {
      record = processor.process(record);
      if (record === null || record === undefined) {
        return; // a processor dropped the log — emit nothing
      }
    }

    // Reconstruct the pino call from the (possibly transformed) record. `level`
    // and `time` are pino-managed and must not be passed back as fields.
    const outObj: Record<string, any> = { ...record };
    delete outObj['level'];
    delete outObj['time'];
    const outMsg = outObj['msg'];
    delete outObj['msg'];

    if (errorFirst) {
      // Keep pino's native top-level-Error handling: pass the original Error
      // back. If processors added other fields, carry them on the merge object
      // under the standard `err` key so the serialiser still applies.
      delete outObj['err'];
      const lead = Object.keys(outObj).length > 0 ? { ...outObj, err: args[0] } : args[0];
      const outArgs: any[] = [lead];
      if (outMsg !== undefined) outArgs.push(outMsg);
      method.apply(pinoLogger, outArgs.concat(interp));
      return;
    }

    const outArgs: any[] = [outObj];
    if (outMsg !== undefined) outArgs.push(outMsg);
    method.apply(pinoLogger, outArgs.concat(interp));
  }

  /**
   * Create (once) the fan-out stream that delivers each serialised log record
   * to every registered `ITransport`. It sits in the root multistream, so it
   * receives exactly what pino emits — after the processor pipeline, and only
   * for logs that passed the level filter. Work is deferred to a `setImmediate`
   * macrotask (T#67) so a slow or synchronous `transport.write` can never block
   * pino's hot path, and each transport is isolated in try/catch so a throwing
   * transport can't break logging. The live `this.transports` list is read on
   * every write, so `addTransport()` after init is honoured.
   */
  private createTransportFanout(): NodeJS.WritableStream {
    if (this.transportFanout) return this.transportFanout;
    const self = this;
    const fanout = new Writable({
      write(chunk: Buffer, _enc: BufferEncoding, callback: (err?: Error | null) => void) {
        const transports = self.transports;
        if (transports.length === 0) {
          callback();
          return;
        }
        const line = chunk.toString();
        setImmediate(() => {
          let record: any;
          try {
            record = JSON.parse(line);
          } catch {
            record = line;
          }
          for (const transport of transports) {
            try {
              const result = transport.write(record);
              if (result && typeof (result as Promise<void>).then === 'function') {
                (result as Promise<void>).catch(() => {
                  /* a transport's async failure must never break logging */
                });
              }
            } catch {
              /* a transport must never break logging */
            }
          }
        });
        callback();
      },
    });
    this.transportFanout = fanout as unknown as NodeJS.WritableStream;
    return this.transportFanout;
  }

  /**
   * Set global context
   */
  setContext(context: object): void {
    this.context = { ...this.context, ...context };

    // Update global logger
    this.globalLogger = new LoggerImpl(this.rootLogger.child(this.context));
  }

  /**
   * Create logger with additional context
   */
  withContext(context: object): ILogger {
    return new LoggerImpl(this.rootLogger.child({ ...this.context, ...context }));
  }

  /**
   * Flush all transports
   */
  async flush(): Promise<void> {
    await Promise.all(this.transports.filter((t) => t.flush).map((t) => t.flush!()));
  }
}
