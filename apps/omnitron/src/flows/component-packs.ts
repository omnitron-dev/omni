import { createHash } from 'node:crypto';
import { constants, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { OMNITRON_HOME } from '../config/defaults.js';
import { stableJson } from '../shared/canonical-json.js';
import { checkFlowConfig, FlowRegistry, type FlowField, type FlowComponent } from '../shared/dto/flows.js';

const identifier = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/)
  .refine((x) => !['constructor', 'prototype', '__proto__'].includes(x));
const field = z
  .strictObject({
    key: identifier,
    label: z.string().trim().min(1).max(100),
    type: z.enum(['text', 'number', 'fields', 'scalar']),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  })
  .refine(
    (f) =>
      ((f.min === undefined && f.max === undefined) || f.type === 'number') &&
      (f.min === undefined || f.max === undefined || f.min <= f.max)
  );
const entry = z.strictObject({
  type: z.string().regex(/^[a-z][a-z0-9.-]{1,78}@[1-9][0-9]*$/),
  label: z.string().trim().min(1).max(100),
  fields: z.array(field).max(16),
  steps: z
    .array(
      z.strictObject({
        type: z.string().min(1).max(100),
        config: z.record(identifier, z.unknown()),
        bind: z.record(identifier, identifier).optional(),
      })
    )
    .min(1)
    .max(16),
});
const manifest = z.strictObject({ version: z.literal(1), components: z.array(entry).max(64) });
const limit = 256 * 1024;

function compose(declaration: z.infer<typeof entry>, primitives: FlowRegistry): FlowComponent {
  const fields: FlowField[] = declaration.fields.map(({ key, label, type, min, max }) => ({
    key,
    label,
    type,
    ...(min !== undefined && { min }),
    ...(max !== undefined && { max }),
  }));
  const exposed = new Map(fields.map((f) => [f.key, f]));
  if (exposed.size !== fields.length) throw Error('Duplicate component parameter in ' + declaration.type);
  const used = new Set<string>();
  const stages = declaration.steps.map((step, index) => {
    const component = primitives.get(step.type);
    if (!(
      component.group === 'transform' ||
      (index === declaration.steps.length - 1 && component.group === 'decision')
    ))
      throw Error('A component pack can compose transformations and one final decision');
    const bind = step.bind ?? {};
    const names = [...Object.keys(step.config), ...Object.keys(bind)];
    if (names.length !== component.fields.length || component.fields.some((f) => !names.includes(f.key)))
      throw Error('Configure every field of ' + step.type + ' exactly once');
    for (const [target, name] of Object.entries(bind)) {
      const supplied = exposed.get(name);
      const required = component.fields.find((f) => f.key === target);
      if (
        !supplied ||
        !required ||
        (required.type !== supplied.type && !(required.type === 'scalar' && ['number', 'text'].includes(supplied.type)))
      )
        throw Error('Incompatible parameter binding in ' + declaration.type);
      used.add(name);
    }
    if (!Object.keys(bind).length) checkFlowConfig(component, step.config);
    return {
      component,
      configure: (parameters: Record<string, unknown>) => ({
        ...step.config,
        ...Object.fromEntries(Object.entries(bind).map(([target, name]) => [target, parameters[name]])),
      }),
    };
  });
  if (used.size !== exposed.size) throw Error('Every declared parameter must configure a component');
  const last = stages.at(-1)!.component;
  const implementationRevision = createHash('sha256')
    .update(
      stableJson({
        declaration,
        dependencies: stages.map((s) => s.component.implementationRevision ?? s.component.type),
      })
    )
    .digest('hex');
  return {
    type: declaration.type,
    label: declaration.label,
    group: last.group,
    fields,
    ports: [...last.ports],
    implementationRevision,
    validate(config) {
      for (const s of stages) checkFlowConfig(s.component, s.configure(config));
    },
    evaluate(config, input, previous) {
      let data = input;
      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i]!;
        const decision = stage.component.evaluate(
          stage.configure(config),
          data,
          i === stages.length - 1 ? previous : undefined
        );
        if (i === stages.length - 1) return decision;
        if (decision.effect || decision.state !== undefined || decision.deliveries?.length !== 1)
          throw Error('Intermediate component must forward one value');
        data = decision.deliveries[0]!.data;
      }
      throw Error('Empty component composition');
    },
  };
}

/** Build a private registry for this controller. A rejected manifest cannot partly install a library. */
export function registryFromFlowPack(input: unknown): FlowRegistry {
  const pack = manifest.parse(input);
  const primitives = new FlowRegistry(),
    registry = new FlowRegistry();
  for (const component of pack.components) registry.register(compose(component, primitives));
  return registry;
}
function readFlowRegistry(home: string): FlowRegistry {
  const file = join(home, 'flow-components.json');
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new FlowRegistry();
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > limit ||
      (process.geteuid && (stat.uid !== process.geteuid() || (stat.mode & 0o022) !== 0))
    )
      throw Error('The flow library must be an operator-owned regular file of at most 256 KiB');
    const buffer = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
    let count = 0;
    while (count < buffer.length) {
      const bytes = readSync(fd, buffer, count, buffer.length - count, null);
      if (!bytes) break;
      count += bytes;
    }
    if (count !== stat.size) throw Error('The flow component library changed during loading');
    let document: unknown;
    try {
      document = JSON.parse(buffer.subarray(0, count).toString('utf8'));
    } catch {
      throw Error('Invalid JSON in flow-components.json');
    }
    return registryFromFlowPack(document);
  } finally {
    closeSync(fd);
  }
}

/** Bad operator extensions are visible in the catalog without interrupting core services. */
export function loadHostFlowRegistry(home = OMNITRON_HOME): FlowRegistry {
  try {
    return readFlowRegistry(home);
  } catch (error) {
    const reason =
      error instanceof z.ZodError
        ? error.issues
            .slice(0, 3)
            .map((issue) => issue.path.join('.') + ' ' + issue.code)
            .join(', ')
        : error instanceof Error
          ? error.message.slice(0, 260)
          : 'invalid component library';
    return new FlowRegistry(undefined, ['Operator flow components are unavailable. ' + reason]);
  }
}
