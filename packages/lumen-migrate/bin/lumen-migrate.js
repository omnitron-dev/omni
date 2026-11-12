#!/usr/bin/env node
try {
  const { runLumenMigrateCli } = await import('../dist/cli/index.js');
  await runLumenMigrateCli();
} catch (error) {
  console.error('Error:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
