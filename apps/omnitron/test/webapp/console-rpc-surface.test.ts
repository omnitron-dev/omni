/**
 * Every RPC the console calls must exist on the daemon.
 *
 * The console reaches the daemon through typed proxies built from the
 * interfaces in `shared/dto/services.ts`. Those are declarations: the
 * compiler checks that the console calls a method the interface names, and
 * nothing checks that the interface names a method the daemon exposes. A
 * commit earlier in this repo's history is titled "the web panel called
 * eight methods that never existed" — that is the gap, and it is invisible
 * until an operator clicks the button.
 *
 * The failure mode is quiet in a specific way: netron answers a call to a
 * missing method with an error, the page catches it, and the panel shows an
 * empty state. "No data" is a legitimate answer, so nobody reads it as a
 * missing method.
 *
 * This walks the three layers — what the console calls, what the DTO
 * declares, what an `@Public` decorator actually exposes — and requires them
 * to line up.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../../src');
const WEBAPP = path.resolve(here, '../../webapp/src');
const PACKAGES = path.resolve(here, '../../../..');

/** Members declared on an interface in `services.ts`. */
function interfaceMethods(source: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  let current: string | null = null;
  for (const line of source.split('\n')) {
    const start = /^export interface (I\w+)/.exec(line);
    if (start) {
      current = start[1]!;
      out.set(current, new Set());
      continue;
    }
    if (!current) continue;
    const member = /^ {2}(\w+)\(/.exec(line);
    if (member) out.get(current)!.add(member[1]!);
    if (line.startsWith('}')) current = null;
  }
  return out;
}

/** `export const metrics = daemonClient.daemon.OmnitronMetrics;` */
function clientAliases(source: string): Map<string, string> {
  return new Map(
    Array.from(source.matchAll(/export const (\w+) = daemonClient\.daemon\.(\w+);/g), (m) => [m[1]!, m[2]!])
  );
}

/** Read the same service-to-DTO mapping that types daemonClient.daemon. */
function clientInterfaces(source: string): Map<string, string> {
  const file = ts.createSourceFile('client.ts', source, ts.ScriptTarget.Latest);
  const schema = file.statements.find((node): node is ts.InterfaceDeclaration =>
    ts.isInterfaceDeclaration(node) && node.name.text === 'OmnitronConsoleSchema');
  const daemon = schema?.members.find((member): member is ts.PropertySignature =>
    ts.isPropertySignature(member) && ts.isIdentifier(member.name) && member.name.text === 'daemon')?.type;
  if (!daemon || !ts.isTypeLiteralNode(daemon)) throw Error('Missing OmnitronConsoleSchema.daemon');
  const services = new Map<string, string>();
  for (const member of daemon.members) {
    if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name) || !member.type ||
      !ts.isTypeReferenceNode(member.type) || !ts.isIdentifier(member.type.typeName))
      throw Error('Expected a named RPC interface in OmnitronConsoleSchema.daemon');
    services.set(member.name.text, member.type.typeName.text);
  }
  return services;
}

/**
 * Methods the console calls on each alias.
 *
 * Array and promise members are excluded by name: a local `const alerts =
 * [...]` shadows the client alias and would otherwise contribute `filter`
 * and `map` as if they were RPCs. The first version of this sweep reported
 * fourteen missing methods, and all fourteen were that.
 */
const NOT_AN_RPC = new Set([
  'filter', 'map', 'reduce', 'some', 'every', 'push', 'pop', 'slice', 'split',
  'join', 'find', 'forEach', 'sort', 'concat', 'includes', 'indexOf', 'then',
  'catch', 'finally', 'trim', 'replace', 'toString', 'flatMap', 'at',
]);

function consoleCalls(aliases: Map<string, string>): Map<string, Set<string>> {
  const calls = new Map<string, Set<string>>([...aliases.keys()].map((a) => [a, new Set<string>()]));
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      for (const alias of aliases.keys()) {
        for (const m of text.matchAll(new RegExp(String.raw`(?<![\w.])` + alias + String.raw`\.(\w+)\(`, 'g'))) {
          if (!NOT_AN_RPC.has(m[1]!)) calls.get(alias)!.add(m[1]!);
        }
      }
    }
  };
  walk(WEBAPP);
  return calls;
}

function decoratorCall(node: ts.ClassDeclaration | ts.MethodDeclaration, name: string) {
  return ts.getDecorators(node)?.map(decorator => decorator.expression).find((expression): expression is ts.CallExpression =>
    ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === name);
}

/** Each service owns the public methods on its decorated class. */
function exposedMethods(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const roots = [SRC, path.join(PACKAGES, 'packages', 'titan-metrics', 'src')];
  const daemonId = fs.readFileSync(path.join(SRC, 'config/defaults.ts'), 'utf8')
    .match(/^export const DAEMON_SERVICE_ID = '([^']+)';/m)?.[1];

  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.ts')) continue;
      const raw = fs.readFileSync(full, 'utf8');
      if (!raw.includes('@Service')) continue;
      const file = ts.createSourceFile(full, raw, ts.ScriptTarget.Latest);
      for (const node of file.statements) {
        if (!ts.isClassDeclaration(node)) continue;
        const options = decoratorCall(node, 'Service')?.arguments[0];
        if (!options || !ts.isObjectLiteralExpression(options)) continue;
        const id = options.properties.find((property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === 'name')?.initializer;
        if (!id) continue;
        const service = ts.isStringLiteral(id) ? id.text :
          ts.isIdentifier(id) && id.text === 'DAEMON_SERVICE_ID' ? daemonId : undefined;
        if (!service) continue;
        const methods = out.get(service) ?? new Set<string>();
        for (const member of node.members) {
          if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && decoratorCall(member, 'Public'))
            methods.add(member.name.text);
        }
        out.set(service, methods);
      }
    }
  };
  roots.forEach(walk);
  return out;
}

const dtoDirectory = path.join(SRC, 'shared/dto');
const dtoSource = fs.readdirSync(dtoDirectory).filter((file) => file.endsWith('.ts'))
  .map((file) => fs.readFileSync(path.join(dtoDirectory, file), 'utf8')).join('\n');
const clientSource = fs.readFileSync(path.join(WEBAPP, 'netron/client.ts'), 'utf8');

const interfaces = interfaceMethods(dtoSource);
const aliases = clientAliases(clientSource);
const serviceInterfaces = clientInterfaces(clientSource);
const calls = consoleCalls(aliases);
const exposed = exposedMethods();

function declaredMethods(service: string): Set<string> {
  const name = serviceInterfaces.get(service);
  if (!name) throw Error(`Missing schema entry for ${service}`);
  const methods = interfaces.get(name);
  if (!methods) throw Error(`Missing DTO interface ${name} for ${service}`);
  return methods;
}

describe('console RPC surface', () => {
  it('found all three layers', () => {
    // Each of these was wrong on a first attempt: the interface lookup
    // matched `IInfraService` instead of `IOmnitronInfraService` and reported
    // six healthy methods as missing. A sweep that mismaps its own inputs
    // reports confidently and wrongly.
    expect(aliases.size, 'console client aliases').toBeGreaterThanOrEqual(15);
    expect(interfaces.size, 'DTO interfaces').toBeGreaterThanOrEqual(15);
    expect(exposed.size, 'services with @Public methods').toBeGreaterThanOrEqual(18);
    expect(exposed.get('OmnitronDaemon')?.size ?? 0, 'daemon methods').toBeGreaterThan(10);
    expect(exposed.get('OmnitronMetrics')?.size ?? 0, 'metrics methods (titan-metrics)').toBeGreaterThan(0);
  });

  it('calls only methods its DTO declares', () => {
    const undeclared: string[] = [];
    for (const [alias, service] of aliases) {
      const declared = declaredMethods(service);
      for (const method of calls.get(alias) ?? []) {
        if (!declared.has(method)) undeclared.push(`${alias}.${method}`);
      }
    }
    expect(undeclared.sort()).toEqual([]);
  });

  it('declares only methods the daemon exposes', () => {
    // The half that a compiler cannot check, and the one that produced
    // "eight methods that never existed".
    const phantom: string[] = [];
    for (const [, service] of aliases) {
      const declared = declaredMethods(service);
      const live = exposed.get(service);
      for (const method of declared) {
        if (!live?.has(method)) phantom.push(`${service}.${method}`);
      }
    }
    expect(phantom.sort(), 'declared in the DTO, not exposed by any @Public method').toEqual([]);
  });

  it('keeps peer transfer methods on the management service that exposes them', () => {
    for (const method of ['probe', 'receive']) {
      expect(exposed.get('OmnitronFlowReviewPeer')).toContain(method);
      expect(exposed.get('OmnitronFlowReviews')).not.toContain(method);
    }
  });

  it('reaches every service the console holds a client for', () => {
    // A client alias for a service that exposes nothing is a page wired to
    // an absence.
    const unreachable = [...aliases.values()].filter(
      (service) => !exposed.has(service) || exposed.get(service)!.size === 0
    );
    expect(unreachable.sort()).toEqual([]);
  });
});
