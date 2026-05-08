/**
 * `omnitron inspect <app> --graph [--format=...]` (C11).
 *
 * Pulls the live DI dependency graph from the running app via the
 * daemon RPC and renders it in the requested format. The default
 * format is Mermaid because (a) it pastes directly into mermaid.live
 * and (b) the syntax is readable in plain text — operators triaging
 * a failed init can scan it without leaving the terminal.
 *
 * Graph source: `Container.exportGraph()` on the running app's
 * `Application.container`. Walks local registrations only (the
 * module surface is what triage cares about).
 */

import { log, prism } from '@xec-sh/kit';
import { exportToDot, exportToMermaid, exportToJson, focusGraph } from '@omnitron-dev/titan/nexus';
import { createDaemonClient } from '../daemon/daemon-client.js';
import { emitJson, emitError, isJsonMode } from './output.js';

export interface InspectGraphOptions {
  format?: 'mermaid' | 'dot' | 'json';
  focus?: string;
  direction?: 'ancestors' | 'descendants' | 'both';
}

export async function inspectGraphCommand(
  appName: string,
  options: InspectGraphOptions,
): Promise<void> {
  const client = createDaemonClient();
  if (!(await client.isReachable())) {
    if (isJsonMode()) emitError('Daemon is not running');
    else log.warn('Daemon is not running');
    await client.disconnect();
    return;
  }

  try {
    const raw = await client.getDependencyGraph({ name: appName });
    if (!raw) {
      const msg = `No dependency graph available for '${appName}'. The app may not be running, may not be a bootstrap-mode app, or may be running an older worker that doesn't expose getDependencyGraph.`;
      if (isJsonMode()) emitError(msg, { app: appName });
      else log.warn(msg);
      return;
    }

    const focused = options.focus
      ? focusGraph(raw, options.focus, options.direction ?? 'both')
      : raw;

    const fmt = options.format ?? 'mermaid';
    let rendered: string;
    switch (fmt) {
      case 'json':
        rendered = exportToJson(focused, { pretty: true });
        break;
      case 'dot':
        rendered = exportToDot(focused);
        break;
      case 'mermaid':
      default:
        rendered = exportToMermaid(focused);
        break;
    }

    if (emitJson({ format: fmt, graph: focused, rendered })) return;

    // Header line summarises the graph; the rendered body follows.
    const headerParts = [
      prism.bold(`DI graph for ${appName}`),
      `${focused.nodes.length} node(s)`,
      `${focused.edges.length} edge(s)`,
      `format=${fmt}`,
    ];
    if (options.focus) {
      headerParts.push(`focus=${options.focus} (${options.direction ?? 'both'})`);
    }
    log.info(headerParts.join(prism.dim(' · ')));
    // eslint-disable-next-line no-console
    console.log(rendered);
  } catch (err) {
    emitError((err as Error).message, { app: appName });
  } finally {
    await client.disconnect();
  }
}
