import React, { useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';

export interface PlaygroundSnapshot {
  result: unknown;
  code: string;
  signature?: string;
  timestamp?: number;
  provenance?: string;
}

export interface PlaygroundRpcClient {
  execute?: (payload: { service?: string; method?: string; code: string }) => Promise<unknown>;
  call?: (service: string, method: string, payload?: unknown) => Promise<unknown>;
  [key: string]: unknown;
}

export interface NetronPlaygroundProps {
  /** Target Titan Netron RPC service name (e.g. 'Lumen') */
  service?: string;
  /** Target RPC method name (e.g. 'search') */
  method?: string;
  /** Initial code snippet */
  initialSnippet?: string;
  /** Initial code (alias for initialSnippet) */
  initialCode?: string;
  /** Direct code string */
  code?: string;
  /** Direct script string */
  script?: string;
  /** Execution mode ('local' | 'server') */
  mode?: 'local' | 'server' | string;
  /** Runtime environment indicator ('node22' | 'browser' | string) */
  runtime?: string;
  /** Execution timeout in milliseconds (default: 5000) */
  timeoutMs?: number;
  /** Read-only mode */
  readOnly?: boolean;
  /** Remote Titan RPC endpoint URL */
  endpoint?: string;
  /** Direct RPC client instance */
  rpcClient?: PlaygroundRpcClient;
  /** Signed static snapshot for offline / fallback execution */
  snapshot?: PlaygroundSnapshot;
  /** Custom headers to send with RPC call */
  headers?: Record<string, string>;
  /** Disables main-thread fallback evaluation when Web Workers are unavailable */
  disableMainThreadFallback?: boolean;
  /** Explicitly permits local shadowed fallback in browser DOM when Web Workers are unavailable */
  allowUnsafeFallback?: boolean;
  /** Callback after execution finishes */
  onExecute?: (result: { code: string; result: unknown; error?: string; executionTimeMs: number }) => void;
  className?: string;
}

export interface SandboxExecutionOptions {
  disableMainThreadFallback?: boolean;
  allowUnsafeFallback?: boolean;
}

interface PrototypeSnapshot {
  target: object;
  initialKeys: Set<string | symbol>;
  initialDescriptors: Map<string | symbol, PropertyDescriptor>;
}

/**
 * Captures property snapshots of key built-in prototypes to enable generic cleanup
 * and restoration after sandboxed evaluation.
 */
function capturePrototypeSnapshots(): PrototypeSnapshot[] {
  const targets = [
    Object.prototype,
    Array.prototype,
    Function.prototype,
    String.prototype,
    Number.prototype,
    Boolean.prototype,
    RegExp.prototype,
    Promise.prototype,
    Map.prototype,
    Set.prototype,
  ];
  return targets.map((target) => {
    const keys = [...Object.getOwnPropertyNames(target), ...Object.getOwnPropertySymbols(target)];
    const initialDescriptors = new Map<string | symbol, PropertyDescriptor>();
    for (const key of keys) {
      const desc = Object.getOwnPropertyDescriptor(target, key);
      if (desc) {
        initialDescriptors.set(key, desc);
      }
    }
    return {
      target,
      initialKeys: new Set(keys),
      initialDescriptors,
    };
  });
}

/**
 * Restores prototypes by deleting any newly introduced properties
 * and restoring initial descriptors for modified or deleted properties.
 */
function restorePrototypeSnapshots(snapshots: PrototypeSnapshot[]): void {
  for (const { target, initialKeys, initialDescriptors } of snapshots) {
    const currentKeys = [...Object.getOwnPropertyNames(target), ...Object.getOwnPropertySymbols(target)];
    // 1. Delete any newly added properties
    for (const key of currentKeys) {
      if (!initialKeys.has(key)) {
        try {
          delete (target as any)[key];
        } catch {
          // Ignore non-configurable properties
        }
      }
    }
    // 2. Restore modified or deleted initial properties
    for (const [key, initialDesc] of initialDescriptors.entries()) {
      const currentDesc = Object.getOwnPropertyDescriptor(target, key);
      if (
        !currentDesc ||
        currentDesc.value !== initialDesc.value ||
        currentDesc.get !== initialDesc.get ||
        currentDesc.set !== initialDesc.set ||
        currentDesc.writable !== initialDesc.writable ||
        currentDesc.enumerable !== initialDesc.enumerable ||
        currentDesc.configurable !== initialDesc.configurable
      ) {
        try {
          Object.defineProperty(target, key, initialDesc);
        } catch {
          // Ignore if cannot be redefined
        }
      }
    }
  }
}

/**
 * Checks whether Web Worker creation from Blobs is supported in the current environment.
 */
function canUseWebWorker(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  );
}

/**
 * Detects whether the current environment is a unit-test DOM shim (Happy-DOM / jsdom)
 * or non-DOM Node environment vs a real browser window.
 */
function isUnitTestOrNodeEnvironment(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return true;
  }
  return Boolean((window as unknown as Record<string, unknown>)['happyDOM']);
}

/**
 * Generates the isolated Web Worker bootstrap script that disables ambient network
 * and storage APIs before executing untrusted user snippets.
 */
export function createWorkerBootstrapSource(): string {
  return `
    (function bootstrapSandboxWorker() {
      var postMsg = self.postMessage.bind(self);
      var RealFunction = Function;

      var disabledApis = [
        'fetch',
        'XMLHttpRequest',
        'WebSocket',
        'EventSource',
        'importScripts',
        'indexedDB',
        'caches',
        'BroadcastChannel',
        'Worker',
        'SharedWorker'
      ];

      for (var i = 0; i < disabledApis.length; i++) {
        (function disableApi(apiName) {
          try {
            delete self[apiName];
          } catch (_) {
            // Ignore non-deletable properties
          }
          try {
            Object.defineProperty(self, apiName, {
              value: undefined,
              writable: false,
              configurable: false
            });
          } catch (_) {
            try {
              self[apiName] = undefined;
            } catch (__) {
              // Ignore non-writable intrinsics
            }
          }
        })(disabledApis[i]);
      }

      self.onmessage = function handleMessage(e) {
        var code = e && e.data ? e.data.code : '';
        try {
          var logs = [];
          var formatArgs = function formatArgs(argsList) {
            var arr = Array.prototype.slice.call(argsList);
            return arr.map(function formatItem(a) {
              if (typeof a === 'object' && a !== null) {
                try { return JSON.stringify(a); } catch (_) { return String(a); }
              }
              return String(a);
            }).join(' ');
          };

          var customConsole = {
            log: function log() { logs.push(formatArgs(arguments)); },
            warn: function warn() { logs.push('[WARN] ' + formatArgs(arguments)); },
            error: function error() { logs.push('[ERR] ' + formatArgs(arguments)); }
          };

          var sandboxedFn = new RealFunction(
            'console',
            'self',
            'globalThis',
            'fetch',
            'XMLHttpRequest',
            'WebSocket',
            'EventSource',
            'importScripts',
            'indexedDB',
            'caches',
            'Function',
            'eval',
            'return (async function runUserSnippet() {\\n"use strict";\\n' + code + '\\n})();'
          );

          var resPromise = sandboxedFn(
            customConsole,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined
          );

          if (resPromise && typeof resPromise.then === 'function') {
            resPromise.then(function onResolve(val) {
              postMsg({ ok: true, result: val !== undefined ? val : logs.join('\\n') });
            }).catch(function onReject(err) {
              postMsg({ ok: false, error: err && err.message ? err.message : String(err) });
            });
          } else {
            postMsg({ ok: true, result: resPromise !== undefined ? resPromise : logs.join('\\n') });
          }
        } catch (err) {
          postMsg({ ok: false, error: err && err.message ? err.message : String(err) });
        }
      };
    })();
  `;
}

/**
 * Evaluates untrusted code in an isolated Web Worker with hard timeout termination
 * and disabled network/storage globals. Never retries failed worker code on the host window.
 */
function runInWorker(code: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const workerSource = createWorkerBootstrapSource();

    let blobUrl: string | null = null;
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (worker) {
        worker.terminate();
        worker = null;
      }
      if (blobUrl) {
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {
          // ignore
        }
        blobUrl = null;
      }
    };

    try {
      const blob = new Blob([workerSource], { type: 'application/javascript' });
      blobUrl = URL.createObjectURL(blob);
      worker = new Worker(blobUrl);

      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      worker.onmessage = (event: MessageEvent) => {
        const data = event.data;
        cleanup();
        if (data && data.ok) {
          resolve(data.result);
        } else {
          reject(new Error(data?.error || 'Execution error'));
        }
      };

      worker.onerror = (event: ErrorEvent) => {
        const message = event.message || 'Worker execution error';
        cleanup();
        reject(new Error(message));
      };

      worker.postMessage({ code });
    } catch (err) {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Evaluates code with shadowed ambient globals and generic prototype snapshotting
 * (used only in non-Worker unit-test environments or when allowUnsafeFallback is explicitly enabled).
 */
function runInLocalSandbox(code: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const snapshots = capturePrototypeSnapshots();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        restorePrototypeSnapshots(snapshots);
        reject(new Error(`Execution timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    try {
      const logs: string[] = [];
      const formatArg = (a: unknown): string => {
        if (typeof a === 'object' && a !== null) {
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        }
        return String(a);
      };

      const customConsole = {
        log: (...args: unknown[]) => logs.push(args.map(formatArg).join(' ')),
        warn: (...args: unknown[]) => logs.push('[WARN] ' + args.map(formatArg).join(' ')),
        error: (...args: unknown[]) => logs.push('[ERR] ' + args.map(formatArg).join(' ')),
      };

      // Outer non-strict wrapper permits shadowing `eval` alongside ambient globals;
      // inner async IIFE enforces strict mode (`this === undefined`).
      const sandboxedFn = new Function(
        'console',
        'window',
        'document',
        'globalThis',
        'self',
        'fetch',
        'XMLHttpRequest',
        'WebSocket',
        'EventSource',
        'localStorage',
        'sessionStorage',
        'indexedDB',
        'caches',
        'Function',
        'eval',
        `return (async function runIsolatedSnippet() {\n"use strict";\n${code}\n})();`
      );

      const resPromise = sandboxedFn(
        customConsole,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      );

      if (resPromise && typeof (resPromise as any).then === 'function') {
        (resPromise as Promise<unknown>)
          .then((val) => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              restorePrototypeSnapshots(snapshots);
              resolve(val !== undefined ? val : logs.join('\n'));
            }
          })
          .catch((err) => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              restorePrototypeSnapshots(snapshots);
              reject(err);
            }
          });
      } else if (!settled) {
        settled = true;
        clearTimeout(timer);
        restorePrototypeSnapshots(snapshots);
        resolve(resPromise !== undefined ? resPromise : logs.join('\n'));
      }
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        restorePrototypeSnapshots(snapshots);
        reject(err);
      }
    }
  });
}

/**
 * Sandboxed code executor:
 * - When Web Workers exist, executes inside a network-isolated Worker and NEVER retries on the host window.
 * - When Web Workers are unavailable, fails closed in real browsers unless allowUnsafeFallback is explicitly set,
 *   and runs with shadowed globals (`window`, `document`, `localStorage`, `fetch`, etc. = undefined) in unit tests.
 */
export async function executeSandboxedCode(
  code: string,
  timeoutMs: number,
  options?: SandboxExecutionOptions
): Promise<unknown> {
  if (canUseWebWorker()) {
    return runInWorker(code, timeoutMs);
  }

  if (options?.disableMainThreadFallback) {
    throw new Error('Isolated Web Worker runtime is unavailable');
  }

  if (!options?.allowUnsafeFallback && !isUnitTestOrNodeEnvironment()) {
    throw new Error('Isolated Web Worker runtime is unavailable');
  }

  return runInLocalSandbox(code, timeoutMs);
}

export function NetronPlayground({
  service = '',
  method = '',
  initialSnippet = '',
  initialCode = '',
  code: directCode,
  script: directScript,
  mode,
  runtime = 'browser',
  timeoutMs = 5000,
  readOnly = false,
  endpoint,
  rpcClient,
  snapshot,
  headers = {},
  disableMainThreadFallback = false,
  allowUnsafeFallback = false,
  onExecute,
  className,
}: NetronPlaygroundProps = {}): React.JSX.Element {
  const defaultSnippet = directCode || directScript || initialCode || initialSnippet || '';
  const [currentCode, setCurrentCode] = useState(defaultSnippet);
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState<unknown>(snapshot?.result ?? null);
  const [error, setError] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [activeProvenance, setActiveProvenance] = useState<string | null>(
    snapshot?.result !== undefined ? (snapshot.provenance ?? 'snapshot') : null
  );

  useEffect(() => {
    const controlled = directCode ?? directScript;
    if (controlled !== undefined) {
      setCurrentCode(controlled);
    }
  }, [directCode, directScript]);

  const executeSandbox = useCallback(async () => {
    if (readOnly || isRunning) return;
    setIsRunning(true);
    setError(null);
    const start = performance.now();

    const failClosed = (errMessage: string) => {
      const elapsed = Math.round(performance.now() - start);
      setOutput(null);
      setError(errMessage);
      setDurationMs(elapsed);
      onExecute?.({ code: currentCode, result: undefined, error: errMessage, executionTimeMs: elapsed });
    };

    try {
      const isRemoteMode = Boolean(endpoint || rpcClient || mode === 'server');

      // 1. Remote RPC execution: fail closed on any HTTP non-2xx or transport rejection (NEVER fall back to local eval!)
      if (isRemoteMode) {
        if (rpcClient) {
          try {
            let rpcResult: unknown;
            if (typeof rpcClient.execute === 'function') {
              rpcResult = await rpcClient.execute({ service, method, code: currentCode });
            } else if (typeof rpcClient.call === 'function') {
              rpcResult = await rpcClient.call(service, method || 'execute', { code: currentCode });
            } else {
              const dynamicMethod = rpcClient[method || 'execute'];
              if (typeof dynamicMethod !== 'function') {
                throw new Error(`RPC method "${method || 'execute'}" is not available on rpcClient`);
              }
              rpcResult = await (dynamicMethod as (payload: unknown) => Promise<unknown>)(currentCode);
            }
            const elapsed = Math.round(performance.now() - start);
            const unwrapped =
              rpcResult && typeof rpcResult === 'object' && 'result' in (rpcResult as Record<string, unknown>)
                ? (rpcResult as Record<string, unknown>)['result']
                : rpcResult;
            setOutput(unwrapped);
            setDurationMs(elapsed);
            onExecute?.({ code: currentCode, result: unwrapped, executionTimeMs: elapsed });
            return;
          } catch (rpcErr: any) {
            failClosed(rpcErr?.message || 'Remote RPC execution failed');
            return;
          }
        }

        if (endpoint) {
          try {
            const payload = { service, method, code: currentCode };
            const res = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...headers },
              body: JSON.stringify(payload),
            });

            if (!res.ok) {
              let detail = `Remote RPC error (HTTP ${res.status})`;
              try {
                const bodyJson = await res.json();
                if (bodyJson && typeof bodyJson === 'object') {
                  const serverMsg = bodyJson.error || bodyJson.message;
                  if (typeof serverMsg === 'string' && serverMsg.trim()) {
                    detail = `HTTP ${res.status}: ${serverMsg}`;
                  }
                }
              } catch {
                // Keep status code message when response body is not JSON
              }
              failClosed(detail);
              return;
            }

            const data = await res.json();
            const elapsed = Math.round(performance.now() - start);
            const finalResult = data && typeof data === 'object' && data.result !== undefined ? data.result : data;
            setOutput(finalResult);
            setDurationMs(elapsed);
            onExecute?.({ code: currentCode, result: finalResult, executionTimeMs: elapsed });
            return;
          } catch (fetchErr: any) {
            failClosed(fetchErr?.message || 'Remote RPC request failed');
            return;
          }
        }

        failClosed('Remote RPC endpoint is not configured for server mode');
        return;
      }

      // 2. Client-side sandboxed JS execution (Worker-isolated, never retried on host main thread)
      try {
        const result = await executeSandboxedCode(currentCode, timeoutMs, {
          disableMainThreadFallback,
          allowUnsafeFallback,
        });
        const elapsed = Math.round(performance.now() - start);
        setActiveProvenance('sandbox');
        setOutput(result);
        setDurationMs(elapsed);
        onExecute?.({ code: currentCode, result, executionTimeMs: elapsed });
      } catch (evalErr: any) {
        const snapshotMatchesCode = !snapshot?.code || snapshot.code.trim() === currentCode.trim();
        if (snapshot && snapshot.result !== undefined && snapshotMatchesCode) {
          const elapsed = Math.round(performance.now() - start);
          setActiveProvenance(snapshot.provenance ?? 'snapshot');
          setOutput(snapshot.result);
          setDurationMs(elapsed);
          onExecute?.({ code: currentCode, result: snapshot.result, executionTimeMs: elapsed });
        } else {
          setActiveProvenance(null);
          failClosed(evalErr?.message || 'Execution error');
        }
      }
    } catch (err: any) {
      failClosed(err?.message || 'Execution error');
    } finally {
      setIsRunning(false);
    }
  }, [
    currentCode,
    endpoint,
    rpcClient,
    mode,
    service,
    method,
    headers,
    timeoutMs,
    readOnly,
    isRunning,
    snapshot,
    disableMainThreadFallback,
    allowUnsafeFallback,
    onExecute,
  ]);

  return (
    <div
      className={clsx('lumen-netron-playground', className)}
      data-service={service || undefined}
      data-method={method || undefined}
      data-runtime={runtime}
      data-provenance={activeProvenance || undefined}
    >
      <header className="lumen-playground-header">
        <div className="lumen-playground-title">
          <span className="lumen-playground-badge">NETRON PLAYGROUND</span>
          {service && (
            <span className="lumen-playground-service">
              {service}.{method || 'execute'}
            </span>
          )}
          <span className="lumen-playground-runtime">{runtime}</span>
        </div>
        <div className="lumen-playground-actions">
          {!readOnly && (
            <button type="button" className="lumen-playground-run-btn" onClick={executeSandbox} disabled={isRunning}>
              {isRunning ? 'Running...' : 'Run ▶'}
            </button>
          )}
        </div>
      </header>

      <div className="lumen-playground-editor">
        <textarea
          className="lumen-playground-textarea"
          value={currentCode}
          onChange={(e) => setCurrentCode(e.target.value)}
          readOnly={readOnly}
          rows={Math.min(16, Math.max(4, currentCode.split('\n').length + 1))}
          placeholder="Enter code to execute..."
          spellCheck={false}
        />
      </div>

      {(output !== null || error !== null) && (
        <section className="lumen-playground-console">
          <div className="lumen-playground-console-header">
            <span>Console Output</span>
            {durationMs !== null && <span className="lumen-playground-duration">{durationMs}ms</span>}
          </div>
          {error ? (
            <pre className="lumen-playground-error">{error}</pre>
          ) : (
            <pre className="lumen-playground-result">
              {typeof output === 'object' ? JSON.stringify(output, null, 2) : String(output)}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}
