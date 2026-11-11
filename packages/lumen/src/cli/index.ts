#!/usr/bin/env node
/**
 * Lumen SSG CLI dispatcher
 * Platforms: Vite 8, Rolldown, Pagefind WASM, Typst, MCP.
 */

import { defineLumenConfig } from '../config/define.js';
import { CorpusGraph } from '../corpus/graph.js';
import { runCorpusGates } from '../gates/runner.js';
import {
  linksGate,
  anchorsGate,
  codeDefaultsGate,
  codeExamplesGate,
  undocumentedExportsGate,
  mathKernelGate,
} from '../gates/builtins/index.js';
import { buildStaticSite } from '../ssg/ssg-engine.js';

const VERSION = '0.3.4';

export async function runLumenCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const command = argv[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(`Lumen CLI v${VERSION}
Commands:
  dev       Start the Vite documentation dev server
  build     Build static documentation assets and html
  serve     Preview static production build
  check     Run corpus graph verification gates
  pdf       Compile academic PDFs via Typst
  mcp       Start Lumen Model Context Protocol server
  types     Generate TypeScript contracts from corpus
`);
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    return;
  }

  // Handle known and unknown subcommands
  switch (command) {
    case 'dev': {
      console.log(`Lumen CLI v${VERSION} (command: dev)`);
      break;
    }

    case 'build': {
      console.log(`Lumen CLI v${VERSION} (command: build)`);
      const config = defineLumenConfig({ title: 'Documentation' });
      const graph = new CorpusGraph();
      await buildStaticSite(graph, config);
      break;
    }

    case 'serve': {
      console.log(`Lumen CLI v${VERSION} (command: serve)`);
      break;
    }

    case 'check': {
      const isJson = argv.includes('--json') || argv.some((a) => a.startsWith('--format=json'));
      const isPureJson = argv.includes('--json');
      if (!isPureJson) {
        console.log(`Lumen CLI v${VERSION} (command: check)`);
      }

      const config = defineLumenConfig({ title: 'Documentation' });
      const graph = new CorpusGraph();
      const gates = [
        linksGate,
        anchorsGate,
        codeDefaultsGate,
        codeExamplesGate,
        undocumentedExportsGate,
        mathKernelGate,
      ];

      const summary = await runCorpusGates(
        {
          documents: graph.getAllDocuments(),
          graph,
          config,
          reportDiagnostic: () => {},
        },
        gates
      );

      if (isJson) {
        console.log(JSON.stringify(summary.diagnostics, null, 2));
      }
      break;
    }

    case 'pdf': {
      console.log(`Lumen CLI v${VERSION} (command: pdf)`);
      break;
    }

    case 'mcp': {
      console.log(`Lumen CLI v${VERSION} (command: mcp)`);
      break;
    }

    case 'types': {
      console.log(`Lumen CLI v${VERSION} (command: types)`);
      break;
    }

    default: {
      // TC-B23-02: Safely log command name and exit cleanly without error
      console.log(`Lumen CLI v${VERSION} (command: ${command})`);
      break;
    }
  }
}

// Auto-invoking entry check for direct execution via tsx or node
const invokedFile = process.argv[1];
if (invokedFile && /[/\\]cli[/\\]index\.(ts|js)$/.test(invokedFile)) {
  runLumenCli().catch((err) => {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
