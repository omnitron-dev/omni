import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import clsx from 'clsx';
import { PLAYGROUND_LIMITS } from '@omnitron-dev/lumen-ast/execution/limits';
import { executeSandboxedCode } from './playground-execution.js';

export interface PlaygroundSnapshot { result: unknown; code: string; timestamp?: number }
/** Matches the result of the canonical queried LumenService.executePlayground method. */
export interface PlaygroundServiceResult { code: string; result: unknown; error?: string }
export type PlaygroundExecutor = (code: string) => Promise<PlaygroundServiceResult>;
export interface PlaygroundExecutionResult extends PlaygroundServiceResult { executionTimeMs: number }

export interface NetronPlaygroundProps {
  /** The editable snippet. A changed prop resets the editor and cancels active execution. */
  code?: string;
  mode?: 'local' | 'server';
  /** Bind the executePlayground method from a service queried through Netron. */
  execute?: PlaygroundExecutor;
  /** Includes worker startup; the worker is terminated when this deadline expires. */
  timeoutMs?: number;
  readOnly?: boolean;
  /** Recorded output is labelled separately and is never substituted for a failed run. */
  snapshot?: PlaygroundSnapshot;
  onExecute?: (result: PlaygroundExecutionResult) => void;
  className?: string;
}

type RunState = { status: 'idle' | 'running' } | { status: 'complete'; execution: PlaygroundExecutionResult };

function formatResult(value: unknown): string {
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

export function NetronPlayground({ code = '', mode, execute, timeoutMs = PLAYGROUND_LIMITS.timeoutMs, readOnly = false, snapshot, onExecute, className }: NetronPlaygroundProps = {}): React.JSX.Element {
  const editorId = useId();
  const [currentCode, setCurrentCode] = useState(code);
  const [run, setRun] = useState<RunState>({ status: 'idle' });
  const active = useRef<AbortController | null>(null);
  const executionMode = mode ?? (execute ? 'server' : 'local');

  useEffect(() => {
    active.current?.abort();
    active.current = null;
    setCurrentCode(code);
    setRun({ status: 'idle' });
  }, [code]);
  useEffect(() => () => { active.current?.abort(); }, []);

  const executeCode = useCallback(async () => {
    if (readOnly || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setRun({ status: 'running' });
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let execution: PlaygroundExecutionResult;
    try {
      if (new TextEncoder().encode(currentCode).length > PLAYGROUND_LIMITS.codeBytes)
        throw new Error(`Playground code exceeds ${PLAYGROUND_LIMITS.codeBytes} bytes`);
      let result: unknown;
      if (executionMode === 'server') {
        if (!execute) throw new Error('A Netron executePlayground method is required for server execution');
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > PLAYGROUND_LIMITS.maxTimeoutMs)
          throw new Error(`Execution timeout must be between 1 and ${PLAYGROUND_LIMITS.maxTimeoutMs} ms`);
        const remote = await Promise.race([
          execute(currentCode),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Execution timed out after ${timeoutMs}ms`)), timeoutMs);
            onAbort = () => reject(new Error('Execution cancelled'));
            controller.signal.addEventListener('abort', onAbort, { once: true });
          }),
        ]);
        if (!remote || remote.code !== currentCode) throw new Error('The remote result does not match this snippet');
        if (remote.error) throw new Error(remote.error);
        result = remote.result;
        if (new TextEncoder().encode(formatResult(result)).length > PLAYGROUND_LIMITS.resultBytes)
          throw new Error('Result size limit exceeded');
      } else result = await executeSandboxedCode(currentCode, timeoutMs, controller.signal);
      if (controller.signal.aborted) return;
      execution = { code: currentCode, result, executionTimeMs: Math.round(performance.now() - start) };
    } catch (error) {
      if (controller.signal.aborted) return;
      execution = { code: currentCode, result: undefined, error: error instanceof Error ? error.message : String(error), executionTimeMs: Math.round(performance.now() - start) };
    } finally {
      clearTimeout(timer);
      if (onAbort) controller.signal.removeEventListener('abort', onAbort);
      if (active.current === controller) active.current = null;
    }
    setRun({ status: 'complete', execution });
    onExecute?.(execution);
  }, [currentCode, executionMode, execute, timeoutMs, readOnly, onExecute]);

  const execution = run.status === 'complete' ? run.execution : undefined;
  return (
    <div className={clsx('lumen-netron-playground', className)} data-runtime={executionMode}>
      <header className="lumen-playground-header">
        <div className="lumen-playground-title">
          <label className="lumen-playground-badge" htmlFor={editorId}>JavaScript playground</label>
          <span className="lumen-playground-runtime">{executionMode === 'server' ? 'Server' : 'Local'}</span>
        </div>
        {!readOnly && <button type="button" className="lumen-playground-run-btn" onClick={executeCode} disabled={run.status === 'running'}>Run code</button>}
      </header>
      <div className="lumen-playground-editor">
        <textarea id={editorId} className="lumen-playground-textarea" value={currentCode} onChange={event => setCurrentCode(event.target.value)} readOnly={readOnly || run.status === 'running'} rows={Math.min(16, Math.max(4, currentCode.split('\n').length + 1))} placeholder="Enter JavaScript to execute" spellCheck={false} />
      </div>
      {run.status === 'running' && <p role="status">Running code…</p>}
      {execution && (
        <section className="lumen-playground-console" aria-label="Execution result">
          <div className="lumen-playground-console-header"><span>Output</span><span className="lumen-playground-duration">{execution.executionTimeMs}ms</span></div>
          {execution.error
            ? <pre className="lumen-playground-error" role="alert">{execution.error}</pre>
            : <pre className="lumen-playground-result" role="status">{formatResult(execution.result)}</pre>}
        </section>
      )}
      {snapshot?.code === currentCode && (
        <details className="lumen-playground-snapshot"><summary>Recorded output</summary><pre>{formatResult(snapshot.result)}</pre></details>
      )}
    </div>
  );
}
