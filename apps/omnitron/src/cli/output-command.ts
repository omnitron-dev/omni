import { Command, CommanderError } from 'commander';
import { emitError, installJsonModeGuard } from '../commands/output.js';
import { setEnvOverride } from '../shared/env-config.js';

/** Output is part of an action's contract, admitted before its lazy handler runs. */
export class OutputCommand extends Command {
  private structuredOutput = false;

  override createCommand(name?: string): OutputCommand {
    return new OutputCommand(name);
  }

  override action(handler: (this: this, ...args: any[]) => void | Promise<void>): this {
    this.structuredOutput = false;
    return super.action(handler);
  }

  /** The handler emits one shared JSON result/error and suppresses human output. */
  structuredAction(handler: (this: this, ...args: any[]) => void | Promise<void>): this {
    this.structuredOutput = true;
    return super.action(handler);
  }

  supportsStructuredOutput(): boolean {
    return this.structuredOutput;
  }
}

/** Root preAction hook: refuse unsupported output before imports, prompts or mutations. */
export function prepareCommandOutput(action: Command): void {
  if (!action.optsWithGlobals()['json'] && process.env['OMNITRON_OUTPUT'] !== 'json') return;
  process.env['OMNITRON_OUTPUT'] = 'json';
  setEnvOverride({ OMNITRON_OUTPUT: 'json' });
  const segments: string[] = [];
  for (let current: Command | null = action; current; current = current.parent) {
    if (current.parent) segments.unshift(current.name());
  }
  const command = segments.join(' ') || action.name();
  if (!(action instanceof OutputCommand) || !action.supportsStructuredOutput()) {
    const message = `\`${command}\` does not support --json. No action was started.`;
    emitError(message, {
      code: 'JSON_OUTPUT_UNSUPPORTED',
      command,
      outcome: 'not-started',
      hint: 'Run this command without --json and without OMNITRON_OUTPUT=json.',
    });
    process.exitCode = 2;
    throw new CommanderError(2, 'omnitron.jsonUnsupported', message);
  }
  installJsonModeGuard(command);
}
