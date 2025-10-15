/**
 * CommandManager tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Schema } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';
import { CommandManager, ChainedCommands } from '../../../../src/components/editor/commands/CommandManager.js';
import { SchemaBuilder } from '../../../../src/components/editor/core/SchemaBuilder.js';

describe('CommandManager', () => {
  let schema: Schema;
  let view: EditorView;
  let commandManager: CommandManager;

  beforeEach(() => {
    const builder = new SchemaBuilder();
    schema = builder.build();

    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

    const state = EditorState.create({
      schema,
      doc,
    });

    const container = document.createElement('div');
    view = new EditorView(container, {
      state,
    });

    commandManager = new CommandManager(view);
  });

  describe('Instantiation', () => {
    it('should create CommandManager instance', () => {
      expect(commandManager).toBeDefined();
      expect(commandManager).toBeInstanceOf(CommandManager);
    });

    it('should initialize with empty command registry', () => {
      expect(commandManager.getCommandNames()).toEqual([]);
    });
  });

  describe('Command registration', () => {
    it('should register a command', () => {
      const testCommand = (state, dispatch) => {
        if (dispatch) {
          dispatch(state.tr.insertText('hello'));
        }
        return true;
      };

      commandManager.register('test', testCommand);
      expect(commandManager.getCommandNames()).toContain('test');
    });

    it('should register multiple commands', () => {
      const cmd1 = (state, dispatch) => true;
      const cmd2 = (state, dispatch) => true;

      commandManager.register('cmd1', cmd1);
      commandManager.register('cmd2', cmd2);

      const names = commandManager.getCommandNames();
      expect(names).toContain('cmd1');
      expect(names).toContain('cmd2');
      expect(names.length).toBe(2);
    });

    it('should overwrite existing command with same name', () => {
      const cmd1 = (state, dispatch) => {
        if (dispatch) dispatch(state.tr.insertText('first'));
        return true;
      };
      const cmd2 = (state, dispatch) => {
        if (dispatch) dispatch(state.tr.insertText('second'));
        return true;
      };

      commandManager.register('test', cmd1);
      commandManager.register('test', cmd2);

      expect(commandManager.getCommandNames().length).toBe(1);
    });
  });

  describe('Command execution', () => {
    it('should execute a registered command', () => {
      const testCommand = vi.fn((state, dispatch) => {
        if (dispatch) {
          dispatch(state.tr.insertText('hello'));
        }
        return true;
      });

      commandManager.register('test', testCommand);
      const result = commandManager.execute('test');

      expect(result).toBe(true);
      expect(testCommand).toHaveBeenCalled();
    });

    it('should return false for unknown command', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = commandManager.execute('unknown');

      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('Command "unknown" not found');

      consoleSpy.mockRestore();
    });

    it('should pass arguments to command', () => {
      const testCommand = vi.fn((state, dispatch, view, arg1, arg2) => {
        expect(arg1).toBe('foo');
        expect(arg2).toBe(42);
        return true;
      });

      commandManager.register('test', testCommand);
      commandManager.execute('test', 'foo', 42);

      expect(testCommand).toHaveBeenCalled();
    });

    it('should apply transaction when command executes', () => {
      const insertCommand = (state, dispatch) => {
        if (dispatch) {
          dispatch(state.tr.insertText(' world', state.doc.content.size - 1));
        }
        return true;
      };

      commandManager.register('insert', insertCommand);
      commandManager.execute('insert');

      expect(view.state.doc.textContent).toContain('world');
    });
  });

  describe('Command availability checking', () => {
    it('should check if command can execute', () => {
      const testCommand = (state, dispatch) => {
        // Command can always execute
        return true;
      };

      commandManager.register('test', testCommand);
      expect(commandManager.can('test')).toBe(true);
    });

    it('should return false for unavailable command', () => {
      const testCommand = (state, dispatch) => {
        // Command cannot execute
        return false;
      };

      commandManager.register('test', testCommand);
      expect(commandManager.can('test')).toBe(false);
    });

    it('should return false for unknown command', () => {
      expect(commandManager.can('unknown')).toBe(false);
    });

    it('should not dispatch when checking availability', () => {
      const testCommand = vi.fn((state, dispatch) => {
        if (dispatch) {
          dispatch(state.tr.insertText('hello'));
        }
        return true;
      });

      commandManager.register('test', testCommand);
      commandManager.can('test');

      // Command should be called but dispatch should be undefined
      expect(testCommand).toHaveBeenCalledWith(expect.anything(), undefined, expect.anything());
    });
  });

  describe('Command chaining', () => {
    it('should create a command chain', () => {
      const chain = commandManager.chain();
      expect(chain).toBeDefined();
      expect(chain).toBeInstanceOf(ChainedCommands);
    });

    it('should create new chain instance each time', () => {
      const chain1 = commandManager.chain();
      const chain2 = commandManager.chain();
      expect(chain1).not.toBe(chain2);
    });
  });

  describe('Command registry management', () => {
    it('should get all command names', () => {
      commandManager.register('cmd1', () => true);
      commandManager.register('cmd2', () => true);
      commandManager.register('cmd3', () => true);

      const names = commandManager.getCommandNames();
      expect(names).toEqual(expect.arrayContaining(['cmd1', 'cmd2', 'cmd3']));
      expect(names.length).toBe(3);
    });

    it('should clear all commands', () => {
      commandManager.register('cmd1', () => true);
      commandManager.register('cmd2', () => true);

      expect(commandManager.getCommandNames().length).toBe(2);

      commandManager.clear();

      expect(commandManager.getCommandNames().length).toBe(0);
    });

    it('should allow re-registration after clear', () => {
      commandManager.register('test', () => true);
      commandManager.clear();
      commandManager.register('test', () => true);

      expect(commandManager.getCommandNames()).toContain('test');
    });
  });
});

describe('ChainedCommands', () => {
  let schema: Schema;
  let view: EditorView;
  let chain: ChainedCommands;

  beforeEach(() => {
    const builder = new SchemaBuilder();
    schema = builder.build();

    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('test')])]);

    const state = EditorState.create({
      schema,
      doc,
    });

    const container = document.createElement('div');
    view = new EditorView(container, {
      state,
    });

    const commandManager = new CommandManager(view);
    chain = commandManager.chain();
  });

  describe('Instantiation', () => {
    it('should create ChainedCommands instance', () => {
      expect(chain).toBeDefined();
      expect(chain).toBeInstanceOf(ChainedCommands);
    });
  });

  describe('Chain execution', () => {
    it('should execute empty chain successfully', () => {
      const result = chain.run();
      expect(result).toBe(true);
    });

    it('should check empty chain availability', () => {
      const result = chain.can();
      expect(result).toBe(true);
    });
  });

  describe('Placeholder methods', () => {
    it('should have focus method', () => {
      expect(chain.focus).toBeDefined();
      expect(typeof chain.focus).toBe('function');
    });

    it('should have setContent method', () => {
      expect(chain.setContent).toBeDefined();
      expect(typeof chain.setContent).toBe('function');
    });

    it('should return this for method chaining on focus', () => {
      const result = chain.focus('start');
      expect(result).toBe(chain);
    });

    it('should return this for method chaining on setContent', () => {
      const result = chain.setContent('test');
      expect(result).toBe(chain);
    });

    it('should allow chaining placeholder methods', () => {
      expect(() => {
        chain.focus('start').setContent('test').focus('end');
      }).not.toThrow();
    });
  });

  describe('Transaction handling', () => {
    it('should apply transaction when run is called', () => {
      const initialText = view.state.doc.textContent;

      // Manually add a command using reflection for testing
      const insertCommand = (state, dispatch) => {
        if (dispatch) {
          dispatch(state.tr.insertText(' world', state.doc.content.size - 1));
        }
        return true;
      };

      // Access private commands array
      (chain as any).commands.push(insertCommand);

      chain.run();

      expect(view.state.doc.textContent).not.toBe(initialText);
      expect(view.state.doc.textContent).toContain('world');
    });

    it('should stop execution at first failing command', () => {
      const cmd1 = vi.fn((state, dispatch) => {
        if (dispatch) dispatch(state.tr.insertText('a'));
        return true;
      });
      const cmd2 = vi.fn(() => false); // This command fails
      const cmd3 = vi.fn((state, dispatch) => {
        if (dispatch) dispatch(state.tr.insertText('c'));
        return true;
      });

      (chain as any).commands.push(cmd1, cmd2, cmd3);

      const result = chain.run();

      expect(result).toBe(false);
      expect(cmd1).toHaveBeenCalled();
      expect(cmd2).toHaveBeenCalled();
      expect(cmd3).not.toHaveBeenCalled();
    });

    it('should accumulate transactions before dispatching', () => {
      const cmd1 = (state, dispatch) => {
        if (dispatch) dispatch(state.tr.insertText('a', state.doc.content.size - 1));
        return true;
      };
      const cmd2 = (state, dispatch) => {
        if (dispatch) dispatch(state.tr.insertText('b', state.doc.content.size - 1));
        return true;
      };

      (chain as any).commands.push(cmd1, cmd2);

      const initialText = view.state.doc.textContent;
      chain.run();

      expect(view.state.doc.textContent).not.toBe(initialText);
    });

    it('should not dispatch if no commands modify state', () => {
      const noopCommand = () => true;

      (chain as any).commands.push(noopCommand);

      const stateBefore = view.state;
      chain.run();
      const stateAfter = view.state;

      expect(stateAfter).toBe(stateBefore);
    });
  });

  describe('Can execution check', () => {
    it('should check if all commands can execute', () => {
      const cmd1 = () => true;
      const cmd2 = () => true;

      (chain as any).commands.push(cmd1, cmd2);

      expect(chain.can()).toBe(true);
    });

    it('should return false if any command cannot execute', () => {
      const cmd1 = () => true;
      const cmd2 = () => false;
      const cmd3 = () => true;

      (chain as any).commands.push(cmd1, cmd2, cmd3);

      expect(chain.can()).toBe(false);
    });

    it('should not dispatch when checking can', () => {
      const cmd = vi.fn((state, dispatch) => {
        expect(dispatch).toBeUndefined();
        return true;
      });

      (chain as any).commands.push(cmd);

      chain.can();

      expect(cmd).toHaveBeenCalled();
    });
  });
});
