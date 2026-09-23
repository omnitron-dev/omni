/**
 * A process that logs the way paysys's deposit worker does, run by
 * `a-record-the-collector-cut-into-lines.spec.ts` as a child whose stdout is a
 * pipe — which is what a supervisor gives it.
 *
 * `deposit-worker.module.ts` states no `prettyPrint`, and its ConfigService
 * has no `environment` key, so the logger takes the development default.
 * `PRETTY=1` adds an explicit `prettyPrint: true`.
 */

import 'reflect-metadata';

import { LoggerService } from '../../../src/modules/logger/logger.service.js';

const config = { get: (_key: string, fallback?: unknown) => fallback };
const options = process.env['PRETTY'] === '1' ? { prettyPrint: true } : {};
const service = new LoggerService(options, undefined, undefined, config);

const failure = Object.assign(new Error('connect ECONNREFUSED 192.0.2.1:8332'), {
  code: 'ECONNREFUSED',
  cause: new Error('socket closed'),
});
service.logger.info({ cycle: 1 }, 'poll cycle started');
service.logger.error({ err: failure, context: { wallet: 'hot', attempt: 3 } }, 'Deposit poll cycle failed');

// Let the async destination drain before the process ends.
setTimeout(() => process.exit(0), 200);
