/**
 * State Store — Persist/recover process state across daemon restarts
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AppStatus } from '../config/types.js';

export interface PersistedAppState {
  name: string;
  pid: number | null;
  status: AppStatus;
  mode: 'classic' | 'bootstrap';
  startedAt: number;
  restarts: number;
  port: number | null;
}

export interface PersistedState {
  version: string;
  updatedAt: number;
  apps: PersistedAppState[];
}

export class StateStore {
  constructor(private readonly stateFile: string) {}

  save(state: PersistedState): void {
    const dir = path.dirname(this.stateFile);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), 'utf-8');
  }

  load(): PersistedState | null {
    try {
      const data = fs.readFileSync(this.stateFile, 'utf-8');
      return JSON.parse(data) as PersistedState;
    } catch {
      return null;
    }
  }

  clear(): void {
    try {
      fs.unlinkSync(this.stateFile);
    } catch {
      // File may not exist
    }
  }
}
