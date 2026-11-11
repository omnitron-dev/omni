#!/usr/bin/env node
// Compatibility entry. The release recipe is owned and run by Xec.
import { runRelease } from '../.xec/release.mjs';
await runRelease(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
