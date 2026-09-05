/**
 * Every command a diagnostic tells an operator to run must exist.
 *
 * The remedy is the whole value of a finding — an operator who reaches one
 * has already been told something is wrong and has nothing else to go on. A
 * remedy naming a command the CLI does not have replaces a diagnosis with
 * `error: unknown command`.
 *
 * Two were wrong when this was written, and neither was a typo. The database
 * check — the one written for a fourteen-day outage, the most important
 * finding in the command — said `omnitron migrate`; migrations live under
 * `omnitron infra migrate`. The build check said `omnitron daemon restart`;
 * there is no `daemon` command at all. Both had been read many times. Prose
 * inside a string literal is the one part of a program that nothing executes,
 * so it is the one part that drifts without resistance.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '../../src/cli/omnitron.ts');
const DOCTOR = path.resolve(here, '../../src/commands/doctor.ts');

/**
 * Command paths the CLI registers, as space-joined strings: `doctor`,
 * `infra migrate`, `backup schedule`.
 *
 * Groups are declared as `const infra = program.command('infra')` and their
 * children as `infra.command('migrate [app]')`, so the receiver variable is
 * what says where a command hangs.
 */
function registeredCommands(source: string): Set<string> {
  const groups = new Map<string, string>();
  for (const m of source.matchAll(/const\s+(\w+)\s*=\s*program[\s\S]{0,80}?\.command\(\s*'([a-z][a-z-]*)/g)) {
    groups.set(m[1]!, m[2]!);
  }

  const commands = new Set<string>([...groups.values()]);
  for (const m of source.matchAll(/(?:^|\n)\s*(\w+)?\s*\n?\s*\.command\(\s*'([a-z][a-z-]*)/g)) {
    commands.add(m[2]!);
  }
  // Receiver-qualified form: `infra\n  .command('migrate ...')` and
  // `infra.command('migrate ...')`.
  for (const m of source.matchAll(/(\w+)\s*\n?\s*\.command\(\s*'([a-z][a-z-]*)/g)) {
    const receiver = m[1]!;
    const name = m[2]!;
    const group = groups.get(receiver);
    if (group) commands.add(`${group} ${name}`);
  }
  return commands;
}

/** `omnitron ...` invocations mentioned in the doctor's own prose. */
function mentionedCommands(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/`omnitron ((?:[a-z][a-z-]*)(?: [a-z][a-z-]*)?)/g)) {
    found.add(m[1]!.trim());
  }
  return [...found].sort();
}

const cliSrc = fs.readFileSync(CLI, 'utf8');
const doctorSrc = fs.readFileSync(DOCTOR, 'utf8');

describe('doctor remedies', () => {
  it('found both files and extracted something from each', () => {
    // Before any subset check means anything. An empty `mentioned` list would
    // otherwise pass the assertion below while proving nothing — which is the
    // exact failure this file is about, one level up.
    const registered = registeredCommands(cliSrc);
    const mentioned = mentionedCommands(doctorSrc);

    expect(registered, 'registered commands').toContain('doctor');
    expect(registered, 'nested commands').toContain('infra migrate');
    expect(registered.size).toBeGreaterThan(20);
    expect(mentioned.length).toBeGreaterThan(5);
  });

  it('names only commands the CLI registers', () => {
    const registered = registeredCommands(cliSrc);
    const mentioned = mentionedCommands(doctorSrc);

    // A two-word mention is valid if the pair is registered, or if the first
    // word is a command taking an argument (`omnitron inspect <app>` is
    // written as `omnitron inspect daos/dev/main`).
    const unknown = mentioned.filter((cmd) => {
      if (registered.has(cmd)) return false;
      const [head] = cmd.split(' ');
      return !registered.has(head!);
    });

    expect(unknown, 'named in a doctor remedy, not registered in the CLI').toEqual([]);
  });

  it('does not name the two that were wrong', () => {
    // Pinned by name: both survived many readings, so a generic subset check
    // that someone later loosens should still trip on these.
    expect(doctorSrc).not.toContain('`omnitron daemon restart`');
    expect(doctorSrc).not.toMatch(/`omnitron migrate`/);
  });

  it('still tells the operator how to run migrations and restart the daemon', () => {
    // The remedies exist at all — a check that only forbids wrong commands
    // is satisfied by removing every command.
    expect(doctorSrc).toContain('omnitron infra migrate');
    expect(doctorSrc).toContain('omnitron down && omnitron up');
  });
});
