#!/usr/bin/env node

/**
 * Holon CLI - Command-line tools for Flow-Machine
 */

import { Command } from 'commander';
import { createRunCommand } from './commands/run.js';
import { createInspectCommand } from './commands/inspect.js';
import { createVisualizeCommand } from './commands/visualize.js';
import { createTestCommand } from './commands/test.js';

const program = new Command();

program.name('holon').description('Flow-Machine runtime CLI').version('0.1.0');

// Add commands
program.addCommand(createRunCommand());
program.addCommand(createInspectCommand());
program.addCommand(createVisualizeCommand());
program.addCommand(createTestCommand());

// Parse arguments
program.parse(process.argv);
