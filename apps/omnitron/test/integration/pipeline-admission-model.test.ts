import { expect, it } from 'vitest';
import { readTraceBounds, recordTraceReceipt, verifyFiniteTraces, type FiniteTraceModel } from '@omnitron-dev/testing/helpers';
import {
  lanes, openPipelineTrace, type Lane, type Operation, type PipelineAction, type PipelineObservation,
} from '../fixtures/pipeline-model-driver.js';

type Phase = 'absent' | 'awaiting-review' | 'success';
interface State {
  auditAvailable: boolean;
  phases: Record<Lane, Phase>;
  effects: string[];
  intents: PipelineObservation['intents'];
  reply: PipelineObservation['reply'];
}

/** The specification uses command identity, a required intent journal and a single append effect. */
const model: FiniteTraceModel<State, PipelineAction, PipelineObservation> = {
  initial: () => ({
    auditAvailable: true, phases: { alpha: 'absent', beta: 'absent' }, effects: [], intents: [], reply: null,
  }),
  enabled(state) {
    const actions: PipelineAction[] = [state.auditAvailable ? 'audit.off' : 'audit.on'];
    for (const lane of lanes) {
      actions.push(`${lane}.prepare`, `${lane}.run`);
      if (state.phases[lane] !== 'absent') actions.push(`${lane}.start`);
    }
    return actions;
  },
  step(state, action) {
    if (action === 'audit.on' || action === 'audit.off') return { ...state, auditAvailable: action === 'audit.on' };
    if (!state.auditAvailable) return { ...state, reply: 'audit-unavailable' };
    const [lane, operation] = action.split('.') as [Lane, Operation];
    const previous = state.phases[lane];
    const phase = operation === 'prepare' && previous !== 'success' ? 'awaiting-review' : 'success';
    const requested = operation === 'run' ? ['prepare', 'start'] : [operation];
    return {
      ...state, phases: { ...state.phases, [lane]: phase },
      effects: phase === 'success' && previous !== 'success' ? [...state.effects, lane] : state.effects,
      intents: [...state.intents, ...requested.map(name => ({
        run: lane, action: `pipeline.${name}.requested`, actor: 'omnitron-local',
      }))],
      reply: { run: lane, definition: lane, status: phase === 'success' ? 'started' : phase, reviewBound: true },
    };
  },
  project(state) {
    return {
      runs: lanes.filter(lane => state.phases[lane] !== 'absent').map(lane => ({
        run: lane, definition: lane, status: state.phases[lane], actor: 'omnitron-local',
      })),
      effects: state.effects, intents: state.intents, reply: state.reply,
    };
  },
};

it('matches the reviewed agent request against run history, audit rows and local child effects', async () => {
  const options = readTraceBounds(process.env['OMNITRON_MODEL_OPTIONS'], { depth: 3, maxTraces: 200 });
  const report = await verifyFiniteTraces(model, openPipelineTrace, options);
  const receipt = await recordTraceReceipt('pipeline', report);
  console.log(receipt);
  expect(report.verdict, receipt).toBe('matched');
}, 120_000);
