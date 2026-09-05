/**
 * Every command the product tells an operator to run must exist.
 *
 * Prose inside a string literal is the one part of a program that nothing
 * executes, so it is the one part that drifts without resistance. This file
 * executes it: it reads the CLI's own registrations and checks every
 * `omnitron …` written in code formatting anywhere in the daemon or the
 * console against them.
 *
 * The first version of this check covered `doctor.ts` alone, because that is
 * where two wrong remedies had been found: the database check — written for a
 * fourteen-day outage, the most important finding in the command — said
 * `omnitron migrate`, when migrations live under `omnitron infra migrate`;
 * the build check said `omnitron daemon restart`, and there is no `daemon`
 * command at all. Widening the same check to the rest of the tree found six
 * more in five files, in every register the product speaks in:
 *
 *   - the console's offline banner told the user to run `omnitron dev`, a
 *     command that has never existed, in the one screen shown to someone who
 *     has just discovered the daemon is down;
 *   - `omnitron status` answered an unreachable socket with
 *     `omnitron daemon kill`, when `omnitron down` already handles exactly
 *     that case — alive PID, dead socket — with SIGTERM then SIGKILL;
 *   - the PID-file collision error said `omnitron daemon stop`;
 *   - three comments named `omnitron daemon start`, `omnitron shutdown` and
 *     `omnitron dev -c`, mapping a command surface removed long ago.
 *
 * None was a typo. `daemon start|stop|ping|kill` was once real, and the
 * strings outlived it — including in a file whose own header still described
 * that surface. That is the shape of the defect: not a mistake at writing
 * time, but a true sentence that stopped being true and had nothing checking.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const CLI = path.join(root, 'src/cli/omnitron.ts');
const DOCTOR = path.join(root, 'src/commands/doctor.ts');

/**
 * Command paths the CLI registers, as space-joined strings: `doctor`,
 * `infra migrate`, `backup schedule` — plus group aliases, since `omnitron
 * proj list` and `omnitron ls` are as real as their long forms.
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
    const group = groups.get(m[1]!);
    if (group) commands.add(`${group} ${m[2]!}`);
  }
  for (const m of source.matchAll(/\.aliases\(\[([^\]]+)\]/g)) {
    for (const a of m[1]!.matchAll(/'([a-z][a-z-]*)'/g)) commands.add(a[1]!);
  }
  return commands;
}

/**
 * `omnitron …` invocations written as code — inside backticks (a template
 * literal, or markdown emphasis in a comment) or a `<code>` element.
 *
 * The formatting is the filter, and it is the right one: it is precisely how
 * a writer marks the difference between naming the product ("omnitron
 * provisions the container") and prescribing a command to type. Matching bare
 * prose instead yields 119 candidates, almost all of them sentences.
 */
function prescribedCommands(source: string): string[] {
  const found = new Set<string>();
  const re = /(?:`|<code[^>]*>)\s*omnitron ((?:[a-z][a-z-]*)(?: [a-z][a-z-]*)?)/g;
  for (const m of source.matchAll(re)) found.add(m[1]!.trim());
  return [...found].sort();
}

/** Every source file the daemon and the console are built from. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'dist') walk(p);
      } else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) {
        out.push(p);
      }
    }
  };
  walk(path.join(root, 'src'));
  walk(path.join(root, 'webapp/src'));
  return out;
}

const cliSrc = fs.readFileSync(CLI, 'utf8');
const registered = registeredCommands(cliSrc);

describe('commands the product prescribes', () => {
  it('extracted a command surface worth checking against', () => {
    // Before any subset check means anything. An empty `registered` set would
    // fail everything; an empty file list would pass everything — which is
    // the exact failure this file is about, one level up.
    expect(registered, 'top-level').toContain('doctor');
    expect(registered, 'nested').toContain('infra migrate');
    expect(registered, 'alias').toContain('ls');
    expect(registered.size).toBeGreaterThan(20);
    expect(sourceFiles().length).toBeGreaterThan(200);
  });

  it('names only commands the CLI registers, anywhere in daemon or console', () => {
    const unknown: string[] = [];
    for (const file of sourceFiles()) {
      for (const cmd of prescribedCommands(fs.readFileSync(file, 'utf8'))) {
        // A two-word mention is valid if the pair is registered, or if the
        // first word is a command taking an argument (`omnitron inspect
        // <app>` is written as `omnitron inspect daos/dev/main`).
        if (registered.has(cmd) || registered.has(cmd.split(' ')[0]!)) continue;
        unknown.push(`omnitron ${cmd}  (${path.relative(root, file)})`);
      }
    }

    expect(unknown, 'prescribed in a string, not registered in the CLI').toEqual([]);
  });

  it('does not name the surface that was removed', () => {
    // Pinned by name: all of these survived many readings, so a generic
    // subset check that someone later loosens should still trip on them.
    for (const file of sourceFiles()) {
      const src = fs.readFileSync(file, 'utf8');
      const rel = path.relative(root, file);
      expect(src, rel).not.toMatch(/`omnitron daemon (start|stop|restart|kill)`/);
      expect(src, rel).not.toMatch(/`omnitron migrate`/);
      expect(src, rel).not.toMatch(/[`>]omnitron dev[`<\s]/);
    }
  });

  it('still tells the operator how to run migrations and restart the daemon', () => {
    // The remedies exist at all — a check that only forbids wrong commands
    // is satisfied by removing every command.
    const doctorSrc = fs.readFileSync(DOCTOR, 'utf8');
    expect(doctorSrc).toContain('omnitron infra migrate');
    expect(doctorSrc).toContain('omnitron down && omnitron up');
  });
});
