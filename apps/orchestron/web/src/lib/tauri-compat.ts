/**
 * Tauri API Compatibility Layer
 * Maps Tauri API calls to HTTP API client
 * This allows the existing code to work without massive refactoring
 */

import { apiClient } from './api-client';

// Mock Tauri API structure
export const invoke = async (command: string, args?: any): Promise<any> => {
  switch (command) {
    // Session commands
    case 'get_sessions':
      return apiClient.getSessions();
    case 'get_session':
      return apiClient.getSession(args.id);
    case 'create_session':
      return apiClient.createSession(args);
    case 'update_session':
      return apiClient.updateSession(args.id, args);
    case 'delete_session':
      return apiClient.deleteSession(args.id);

    // Agent commands
    case 'get_agents':
      return apiClient.getAgents();
    case 'get_agent':
      return apiClient.getAgent(args.id);
    case 'create_agent':
      return apiClient.createAgent(args);
    case 'update_agent':
      return apiClient.updateAgent(args.id, args);
    case 'delete_agent':
      return apiClient.deleteAgent(args.id);

    // Hook commands
    case 'get_hooks':
      return apiClient.getHooks();
    case 'get_hook':
      return apiClient.getHook(args.id);
    case 'create_hook':
      return apiClient.createHook(args);
    case 'update_hook':
      return apiClient.updateHook(args.id, args);
    case 'delete_hook':
      return apiClient.deleteHook(args.id);

    // File operations
    case 'read_file':
      return apiClient.readFile(args.path);
    case 'write_file':
      return apiClient.writeFile(args.path, args.content);
    case 'list_directory':
      return apiClient.listDirectory(args.path);

    // Shell commands
    case 'execute_command':
      return apiClient.executeCommand(args.command, args.args);

    // System operations
    case 'get_system_info':
      return apiClient.getSystemInfo();
    case 'open_external':
      return apiClient.openExternal(args.url);

    default:
      console.warn(`Unknown command: ${command}`);
      throw new Error(`Command not implemented: ${command}`);
  }
};

// Mock dialog API
export const dialog = {
  open: async (options?: any): Promise<string | null> => {
    return apiClient.selectFile(options);
  },
  save: async (options?: any): Promise<string | null> => {
    // Implement save dialog through API
    return apiClient.selectFile({ ...options, save: true });
  },
  message: async (message: string, options?: any): Promise<void> => {
    // For now, just use browser alert
    alert(message);
  },
};

// Mock shell API
export const shell = {
  open: async (url: string): Promise<void> => {
    return apiClient.openExternal(url);
  },
  Command: class {
    private command: string;
    private args: string[];

    constructor(command: string, args?: string[]) {
      this.command = command;
      this.args = args || [];
    }

    async execute(): Promise<any> {
      return apiClient.executeCommand(this.command, this.args);
    }

    async spawn(): Promise<any> {
      // For spawn, we can use the same execute but with streaming
      return apiClient.executeCommand(this.command, this.args);
    }
  },
};

// Mock global shortcut API
export const globalShortcut = {
  register: async (shortcut: string, callback: () => void): Promise<void> => {
    // Register keyboard shortcuts through the browser
    document.addEventListener('keydown', (e) => {
      // Parse shortcut and check if it matches
      // This is a simplified implementation
      if (matchesShortcut(e, shortcut)) {
        callback();
      }
    });
  },
  unregister: async (shortcut: string): Promise<void> => {
    // Unregister shortcuts
    console.log(`Unregistering shortcut: ${shortcut}`);
  },
};

// Helper function to match keyboard shortcuts
function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+').map(s => s.trim().toLowerCase());

  const modifiers = {
    cmd: event.metaKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
  };

  for (const part of parts) {
    if (part in modifiers) {
      if (!modifiers[part as keyof typeof modifiers]) {
        return false;
      }
    } else {
      // Check if the key matches
      if (event.key.toLowerCase() !== part) {
        return false;
      }
    }
  }

  return true;
}

// Mock event system
class EventEmitter {
  private listeners: Map<string, Set<Function>> = new Map();

  async listen(event: string, callback: Function): Promise<() => void> {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      const listeners = this.listeners.get(event);
      if (listeners) {
        listeners.delete(callback);
      }
    };
  }

  emit(event: string, payload: any): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach(callback => callback(payload));
    }
  }
}

export const event = new EventEmitter();

// Connect WebSocket for real-time events
apiClient.connectWebSocket((data) => {
  // Forward WebSocket messages to event emitter
  if (data.event) {
    (event as any).emit(data.event, data.payload);
  }
});

// Export a mock Tauri API object
export const tauri = {
  invoke,
  dialog,
  shell,
  globalShortcut,
  event,
};

// Also export as default for import compatibility
export default tauri;