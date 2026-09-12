/**
 * Re-export of the shared contract-input validator.
 *
 * The implementation moved to `netron/validate-input.ts` when the packet path
 * started using it too: it is not HTTP-specific, and a second copy under this
 * directory is what let the two drift into the same fail-open twice.
 */
export { validateMethodInput, resolveMethodContract } from '../../../validate-input.js';
