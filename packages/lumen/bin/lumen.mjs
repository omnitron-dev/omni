#!/usr/bin/env node
import('../dist/cli/index.js').then(({ runLumenCli }) => {
  runLumenCli().catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
});
