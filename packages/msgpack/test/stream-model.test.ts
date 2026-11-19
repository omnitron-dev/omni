import { encode as referenceEncode } from '@msgpack/msgpack';
import { expect, it } from 'vitest';
import { readTraceBounds, verifyFiniteTraces, type FiniteTraceModel, type TraceSubject } from '../../testing/src/helpers/finite-traces.js';
import { recordTraceReceipt } from '../../testing/src/helpers/trace-receipt.js';
import { encode, Serializer, tryDecode } from '../src/index.js';
import { SmartBuffer } from '../src/smart-buffer.js';

const messages = { label: 'ok', status: { ready: true } } as const;
type Message = keyof typeof messages;
type Action = 'send.label' | 'send.status' | 'deliver.one' | 'deliver.four' | 'read';
const lengths = { label: referenceEncode(messages.label).length, status: referenceEncode(messages.status).length };

interface State {
  sent: Message[];
  delivered: number;
  read: number;
}

interface Observation {
  inTransit: number;
  available: number;
  preview: { value: unknown; bytesConsumed: number } | null;
  cursorAfterPreview: number;
  received: unknown[];
}

function byteCount(sent: Message[]): number {
  return sent.reduce((total, message) => total + lengths[message], 0);
}

const model: FiniteTraceModel<State, Action, Observation> = {
  initial: () => ({ sent: [], delivered: 0, read: 0 }),
  project({ sent, delivered, read }) {
    const consumed = sent.slice(0, read);
    const offset = byteCount(consumed);
    const available = delivered - offset;
    const next = sent[read];
    return {
      inTransit: byteCount(sent) - delivered,
      available,
      preview: next && available >= lengths[next] ? { value: messages[next], bytesConsumed: lengths[next] } : null,
      cursorAfterPreview: offset,
      received: consumed.map(message => messages[message]),
    };
  },
  enabled(state) {
    const { inTransit, preview } = this.project(state);
    const actions: Action[] = ['send.label', 'send.status'];
    if (inTransit > 0) actions.push('deliver.one');
    if (inTransit > 1) actions.push('deliver.four');
    if (preview) actions.push('read');
    return actions;
  },
  step(state, action) {
    switch (action) {
      case 'send.label': return { ...state, sent: [...state.sent, 'label'] };
      case 'send.status': return { ...state, sent: [...state.sent, 'status'] };
      case 'read': return { ...state, read: state.read + 1 };
      case 'deliver.one': return { ...state, delivered: state.delivered + 1 };
      case 'deliver.four': return { ...state, delivered: Math.min(byteCount(state.sent), state.delivered + 4) };
      default: throw new Error(`Unknown stream action ${action satisfies never}`);
    }
  },
};

function openStream(): TraceSubject<Action, Observation> {
  const input = new SmartBuffer();
  const reader = new Serializer();
  let pending: Buffer = Buffer.alloc(0);
  const received: unknown[] = [];
  return {
    act(action) {
      switch (action) {
        case 'send.label':
        case 'send.status': {
          const message = action === 'send.label' ? messages.label : messages.status;
          pending = Buffer.concat([pending, encode(message)]);
          break;
        }
        case 'deliver.one':
        case 'deliver.four': {
          const count = action === 'deliver.one' ? 1 : 4;
          input.write(pending.subarray(0, count));
          pending = pending.subarray(count);
          break;
        }
        case 'read': received.push(reader.decode(input)); break;
        default: throw new Error(`Unknown stream action ${action satisfies never}`);
      }
    },
    observe() {
      const available = input.length;
      const preview = tryDecode(input);
      return { inTransit: pending.length, available, preview, cursorAfterPreview: input.roffset, received: [...received] };
    },
    close() {},
  };
}

it('preserves frame order, partial reads, cursor position and exact byte counts across deliveries', async () => {
  const bounds = readTraceBounds(process.env['OMNITRON_MODEL_OPTIONS'], { depth: 6, maxTraces: 4096 });
  const report = await verifyFiniteTraces(model, openStream, bounds);
  const receipt = await recordTraceReceipt('msgpack', report);
  console.log(receipt);
  expect(report.verdict, receipt).toBe('matched');
});
