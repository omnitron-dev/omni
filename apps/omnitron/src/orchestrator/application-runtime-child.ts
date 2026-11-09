/** Resolve an installed adapter using Node's current filesystem/module graph. */
import { resolveApplicationBootstrapRuntime } from './application-runtime-resolution.js';
import { initializeModuleReader, answerModuleRead } from '../shared/fresh-module-reader.js';

initializeModuleReader();


try {
  const bootstrap = process.argv[2];
  const fallback = process.argv[3];
  if (!bootstrap || !fallback) throw new Error('Application runtime entry paths were not supplied');
  answerModuleRead({ ok: true, value: resolveApplicationBootstrapRuntime(bootstrap, fallback, process.argv[4] === '--allow-sdkless-bootstrap') });
} catch (error) {
  answerModuleRead({ ok: false, error });
}
