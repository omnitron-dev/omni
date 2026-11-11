import React, { useState, useCallback } from 'react';
import clsx from 'clsx';

export interface PlaygroundSnapshot {
  result: unknown;
  code: string;
  signature?: string;
  timestamp?: number;
}

export interface NetronPlaygroundProps {
  /** Target Titan Netron RPC service name (e.g. 'LumenRpcService') */
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
  /** Runtime environment indicator ('node22' | 'browser' | string) */
  runtime?: string;
  /** Execution timeout in milliseconds (default: 5000) */
  timeoutMs?: number;
  /** Read-only mode */
  readOnly?: boolean;
  /** Remote Titan RPC endpoint URL */
  endpoint?: string;
  /** Signed static snapshot for offline / fallback execution */
  snapshot?: PlaygroundSnapshot;
  /** Custom headers to send with RPC call */
  headers?: Record<string, string>;
  /** Callback after execution finishes */
  onExecute?: (result: { code: string; result: unknown; executionTimeMs: number }) => void;
  className?: string;
}

interface PrototypeSnapshot {
  target: object;
  initialKeys: Set<string | symbol>;
  initialDescriptors: Map<string | symbol, PropertyDescriptor>;
}

/**
 * Captures property snapshots of key prototypes to enable generic cleanup
 * and restoration after sandboxed evaluation.
 */
function capturePrototypeSnapshots(): PrototypeSnapshot[] {
  const targets = [Object.prototype, Array.prototype, Function.prototype];
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
    typeof window !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  );
}

/**
 * Evaluates untrusted code in an isolated Web Worker with hard timeout termination.
 */
function runInWorker(code: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const workerSource = `
      self.onmessage = function(e) {
        var code = e.data.code;
        try {
          var logs = [];
          var customConsole = {
            log: function() {
              var args = Array.prototype.slice.call(arguments);
              logs.push(args.map(function(a) {
                if (typeof a === 'object' && a !== null) {
                  try { return JSON.stringify(a); } catch (_) { return String(a); }
                }
                return String(a);
              }).join(' '));
            },
            warn: function() {
              var args = Array.prototype.slice.call(arguments);
              logs.push('[WARN] ' + args.map(function(a) {
                if (typeof a === 'object' && a !== null) {
                  try { return JSON.stringify(a); } catch (_) { return String(a); }
                }
                return String(a);
              }).join(' '));
            },
            error: function() {
              var args = Array.prototype.slice.call(arguments);
              logs.push('[ERR] ' + args.map(function(a) {
                if (typeof a === 'object' && a !== null) {
                  try { return JSON.stringify(a); } catch (_) { return String(a); }
                }
                return String(a);
              }).join(' '));
            }
          };

          var sandboxedFn = new Function(
            'console',
            '"use strict";\\nreturn (async function() {\\n' + code + '\\n})();'
          );
          var resPromise = sandboxedFn(customConsole);

          if (resPromise && typeof resPromise.then === 'function') {
            resPromise.then(function(val) {
              self.postMessage({ ok: true, result: val !== undefined ? val : logs.join('\\n') });
            }).catch(function(err) {
              self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
            });
          } else {
            self.postMessage({ ok: true, result: resPromise !== undefined ? resPromise : logs.join('\\n') });
          }
        } catch (err) {
          self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
        }
      };
    `;

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
      reject(err);
    }
  });
}

/**
 * Evaluates code on the local thread with generic prototype snapshotting and restoration.
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
      const customConsole = {
        log: (...args: any[]) =>
          logs.push(args.map((a) => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' ')),
        warn: (...args: any[]) =>
          logs.push(
            '[WARN] ' + args.map((a) => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' ')
          ),
        error: (...args: any[]) =>
          logs.push(
            '[ERR] ' + args.map((a) => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' ')
          ),
      };

      const sandboxedFn = new Function('console', `"use strict";\nreturn (async function() {\n${code}\n})();`);
      const resPromise = sandboxedFn(customConsole);

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
      } else {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          restorePrototypeSnapshots(snapshots);
          resolve(resPromise !== undefined ? resPromise : logs.join('\n'));
        }
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
 * Sandboxed code executor supporting Web Workers where available and local prototype-guarded fallback.
 */
async function executeSandboxedCode(code: string, timeoutMs: number): Promise<unknown> {
  if (canUseWebWorker()) {
    try {
      return await runInWorker(code, timeoutMs);
    } catch (err: any) {
      if (err?.message?.includes('timed out')) {
        throw err;
      }
      return await runInLocalSandbox(code, timeoutMs);
    }
  }
  return await runInLocalSandbox(code, timeoutMs);
}

export function NetronPlayground({
  service = '',
  method = '',
  initialSnippet = '',
  initialCode = '',
  code: directCode,
  script: directScript,
  runtime = 'browser',
  timeoutMs = 5000,
  readOnly = false,
  endpoint,
  snapshot,
  headers = {},
  onExecute,
  className,
}: NetronPlaygroundProps = {}): React.JSX.Element {
  const defaultSnippet = directCode || directScript || initialCode || initialSnippet || '';
  const [currentCode, setCurrentCode] = useState(defaultSnippet);
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState<unknown>(snapshot?.result ?? null);
  const [error, setError] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);

  const executeSandbox = useCallback(async () => {
    if (readOnly || isRunning) return;
    setIsRunning(true);
    setError(null);
    const start = performance.now();

    try {
      // 1. If remote RPC endpoint is explicitly defined, attempt remote execution
      if (endpoint) {
        try {
          const payload = { service, method, code: currentCode };
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(payload),
          });
          if (res.ok) {
            const data = await res.json();
            const elapsed = Math.round(performance.now() - start);
            const finalResult = data.result !== undefined ? data.result : data;
            setOutput(finalResult);
            setDurationMs(elapsed);
            onExecute?.({ code: currentCode, result: finalResult, executionTimeMs: elapsed });
            return;
          }
        } catch {
          // Network failure or backend offline; proceed to fallback
        }

        // If backend RPC failed, fall back to static snapshot result if available
        if (snapshot && snapshot.result !== undefined) {
          const elapsed = Math.round(performance.now() - start);
          setOutput(snapshot.result);
          setDurationMs(elapsed);
          onExecute?.({ code: currentCode, result: snapshot.result, executionTimeMs: elapsed });
          return;
        }
      }

      // 2. Client-side sandboxed JS execution with prototype isolation & timeout termination
      try {
        const result = await executeSandboxedCode(currentCode, timeoutMs);
        const elapsed = Math.round(performance.now() - start);
        setOutput(result);
        setDurationMs(elapsed);
        onExecute?.({ code: currentCode, result, executionTimeMs: elapsed });
      } catch (evalErr: any) {
        // If client-side execution failed and a static snapshot result is provided, fall back to snapshot
        if (snapshot && snapshot.result !== undefined) {
          const elapsed = Math.round(performance.now() - start);
          setOutput(snapshot.result);
          setDurationMs(elapsed);
          onExecute?.({ code: currentCode, result: snapshot.result, executionTimeMs: elapsed });
        } else {
          setError(evalErr?.message || 'Execution error');
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Execution error');
    } finally {
      setIsRunning(false);
    }
  }, [currentCode, endpoint, service, method, headers, timeoutMs, readOnly, isRunning, snapshot, onExecute]);

  return (
    <div
      className={clsx('lumen-netron-playground', className)}
      data-service={service || undefined}
      data-method={method || undefined}
      data-runtime={runtime}
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
