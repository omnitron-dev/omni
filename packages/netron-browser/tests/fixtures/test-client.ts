/**
 * Browser client script for E2E testing
 * This script runs in the browser and provides UI controls for testing
 */

import { HttpClient } from '../../src/client/http-client.js';
import { WebSocketClient } from '../../src/client/ws-client.js';

// Global state
let client: HttpClient | WebSocketClient | null = null;
let currentTransport: 'http' | 'websocket' = 'http';

// DOM elements
const statusEl = document.getElementById('status')!;
const outputEl = document.getElementById('output')!;
const serverUrlInput = document.getElementById('serverUrl') as HTMLInputElement;
const transportSelect = document.getElementById('transport') as HTMLSelectElement;
const connectBtn = document.getElementById('connect')!;
const disconnectBtn = document.getElementById('disconnect')!;

// Utility functions
function log(message: string, type: 'info' | 'success' | 'error' = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
  outputEl.textContent += `[${timestamp}] ${prefix} ${message}\n`;
  outputEl.scrollTop = outputEl.scrollHeight;
}

function updateStatus(state: 'disconnected' | 'connecting' | 'connected') {
  statusEl.className = `status ${state}`;
  statusEl.textContent = `Status: ${state.charAt(0).toUpperCase() + state.slice(1)}`;

  connectBtn.disabled = state === 'connected' || state === 'connecting';
  disconnectBtn.disabled = state !== 'connected';

  // Enable/disable test buttons
  const testButtons = document.querySelectorAll('.test-group button');
  testButtons.forEach((btn) => {
    (btn as HTMLButtonElement).disabled = state !== 'connected';
  });
}

// Connection handlers
connectBtn.addEventListener('click', async () => {
  try {
    updateStatus('connecting');
    log('Connecting to server...');

    const url = serverUrlInput.value;
    currentTransport = transportSelect.value as 'http' | 'websocket';

    if (currentTransport === 'http') {
      client = new HttpClient({ url });
      await client.connect();
    } else {
      client = new WebSocketClient({ url: url.replace('http:', 'ws:') });
      await client.connect();
    }

    updateStatus('connected');
    log(`Connected via ${currentTransport.toUpperCase()}`, 'success');
  } catch (error: any) {
    updateStatus('disconnected');
    log(`Connection failed: ${error.message}`, 'error');
  }
});

disconnectBtn.addEventListener('click', async () => {
  try {
    if (client) {
      await client.disconnect();
      client = null;
    }
    updateStatus('disconnected');
    log('Disconnected', 'info');
  } catch (error: any) {
    log(`Disconnect error: ${error.message}`, 'error');
  }
});

// Test handlers
async function invokeMethod(service: string, method: string, args: any[], description: string) {
  if (!client) {
    log('Not connected', 'error');
    return;
  }

  try {
    log(`Calling ${service}.${method}...`);
    const startTime = performance.now();
    const result = await client.invoke(service, method, args);
    const duration = (performance.now() - startTime).toFixed(2);

    log(`${description}\nResult: ${JSON.stringify(result, null, 2)}\nDuration: ${duration}ms`, 'success');
    return result;
  } catch (error: any) {
    log(`Error in ${service}.${method}: ${error.message}`, 'error');
    throw error;
  }
}

// Calculator tests
document.getElementById('calc-add')?.addEventListener('click', () => {
  invokeMethod('calculator@1.0.0', 'add', [5, 3], 'Add 5 + 3');
});

document.getElementById('calc-subtract')?.addEventListener('click', () => {
  invokeMethod('calculator@1.0.0', 'subtract', [10, 4], 'Subtract 10 - 4');
});

document.getElementById('calc-multiply')?.addEventListener('click', () => {
  invokeMethod('calculator@1.0.0', 'multiply', [6, 7], 'Multiply 6 * 7');
});

document.getElementById('calc-divide')?.addEventListener('click', () => {
  invokeMethod('calculator@1.0.0', 'divide', [20, 4], 'Divide 20 / 4');
});

document.getElementById('calc-error')?.addEventListener('click', () => {
  invokeMethod('calculator@1.0.0', 'divide', [10, 0], 'Divide 10 / 0 (should error)');
});

// User tests
document.getElementById('user-list')?.addEventListener('click', () => {
  invokeMethod('user@1.0.0', 'listUsers', [], 'List all users');
});

document.getElementById('user-get')?.addEventListener('click', () => {
  invokeMethod('user@1.0.0', 'getUser', ['1'], 'Get user with ID 1');
});

document.getElementById('user-create')?.addEventListener('click', () => {
  const newUser = {
    name: 'Test User',
    email: 'test@example.com',
    role: 'user',
  };
  invokeMethod('user@1.0.0', 'createUser', [newUser], 'Create new user');
});

document.getElementById('user-update')?.addEventListener('click', () => {
  invokeMethod('user@1.0.0', 'updateUser', ['1', { name: 'Alice Updated' }], 'Update user #1');
});

document.getElementById('user-delete')?.addEventListener('click', () => {
  invokeMethod('user@1.0.0', 'deleteUser', ['3'], 'Delete user #3');
});

document.getElementById('user-error')?.addEventListener('click', () => {
  invokeMethod('user@1.0.0', 'getUser', ['999'], 'Get non-existent user (should error)');
});

// Echo tests
document.getElementById('echo-string')?.addEventListener('click', () => {
  invokeMethod('echo@1.0.0', 'echoString', ['Hello, Netron!'], 'Echo string');
});

document.getElementById('echo-number')?.addEventListener('click', () => {
  invokeMethod('echo@1.0.0', 'echoNumber', [42], 'Echo number');
});

document.getElementById('echo-object')?.addEventListener('click', () => {
  const obj = { name: 'Test', value: 123, nested: { key: 'value' } };
  invokeMethod('echo@1.0.0', 'echoObject', [obj], 'Echo object');
});

document.getElementById('echo-array')?.addEventListener('click', () => {
  invokeMethod('echo@1.0.0', 'echoArray', [[1, 2, 3, 'test', true]], 'Echo array');
});

document.getElementById('echo-error')?.addEventListener('click', () => {
  invokeMethod('echo@1.0.0', 'throwError', ['Test error message'], 'Throw error');
});

// Performance tests
document.getElementById('perf-sequential')?.addEventListener('click', async () => {
  if (!client) return;

  log('Running 10 sequential calls...');
  const startTime = performance.now();

  for (let i = 0; i < 10; i++) {
    await client.invoke('calculator@1.0.0', 'add', [i, i + 1]);
  }

  const duration = (performance.now() - startTime).toFixed(2);
  const avgLatency = (parseFloat(duration) / 10).toFixed(2);
  log(`Sequential: 10 calls in ${duration}ms (avg: ${avgLatency}ms per call)`, 'success');
});

document.getElementById('perf-parallel')?.addEventListener('click', async () => {
  if (!client) return;

  log('Running 10 parallel calls...');
  const startTime = performance.now();

  const promises = Array.from({ length: 10 }, (_, i) => client!.invoke('calculator@1.0.0', 'add', [i, i + 1]));

  await Promise.all(promises);

  const duration = (performance.now() - startTime).toFixed(2);
  log(`Parallel: 10 calls in ${duration}ms`, 'success');
});

// Initialize
updateStatus('disconnected');
log('Ready to connect');

// Expose client to window for Playwright tests
(window as any).__netronClient = {
  getClient: () => client,
  getStatus: () => statusEl.className.split(' ')[1],
  getOutput: () => outputEl.textContent,
  clearOutput: () => {
    outputEl.textContent = '';
  },
};

// Expose the NetronBrowser API for Playwright tests
(window as any).NetronBrowser = {
  HttpClient,
  WebSocketClient,
};
