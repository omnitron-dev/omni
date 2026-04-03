/**
 * Project Registry — Manages seed projects registered with omnitron
 *
 * A seed project is a monorepo with `omnitron.config.ts` at the root.
 * Omnitron can manage multiple projects simultaneously.
 *
 * Registry stored in ~/.omnitron/projects/registry.json
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ISeedProject, IProjectRegistry } from '../config/types.js';

const OMNITRON_HOME = path.join(process.env['HOME'] ?? '/tmp', '.omnitron');
const PROJECTS_DIR = path.join(OMNITRON_HOME, 'projects');
const REGISTRY_FILE = path.join(PROJECTS_DIR, 'registry.json');

export class ProjectRegistry {
  private registry: IProjectRegistry;

  constructor() {
    fs.mkdirSync(PROJECTS_DIR, { recursive: true });
    this.registry = this.load();
  }

  // ===========================================================================
  // CRUD
  // ===========================================================================

  add(name: string, projectPath: string): ISeedProject {
    const absPath = path.resolve(projectPath);

    const configPath = path.join(absPath, 'omnitron.config.ts');
    if (!fs.existsSync(configPath)) {
      throw new Error(`No omnitron.config.ts found at ${absPath}`);
    }

    if (this.registry.projects.some((p) => p.name === name)) {
      throw new Error(`Project '${name}' already registered. Use 'omnitron project remove ${name}' first.`);
    }

    const project: ISeedProject = {
      name,
      path: absPath,
      registeredAt: new Date().toISOString(),
    };

    this.registry.projects.push(project);
    this.persist();

    const projectDir = path.join(PROJECTS_DIR, name);
    fs.mkdirSync(projectDir, { recursive: true });

    return project;
  }

  remove(name: string): void {
    const idx = this.registry.projects.findIndex((p) => p.name === name);
    if (idx === -1) throw new Error(`Project '${name}' not found`);
    this.registry.projects.splice(idx, 1);
    this.persist();
  }

  updatePath(name: string, newPath: string): ISeedProject {
    const project = this.registry.projects.find((p) => p.name === name);
    if (!project) throw new Error(`Project '${name}' not found`);

    const absPath = path.resolve(newPath);
    const configPath = path.join(absPath, 'omnitron.config.ts');
    if (!fs.existsSync(configPath)) {
      throw new Error(`No omnitron.config.ts found at ${absPath}`);
    }

    // Derive new registry name from directory basename
    const newName = path.basename(absPath);
    if (newName !== name && this.registry.projects.some((p) => p.name === newName)) {
      throw new Error(`Project '${newName}' already registered`);
    }

    // Rename workspace directory if it exists
    if (newName !== name) {
      const oldDir = this.getWorkspaceDir(name);
      const newDir = this.getWorkspaceDir(newName);
      if (fs.existsSync(oldDir)) {
        fs.renameSync(oldDir, newDir);
      } else {
        fs.mkdirSync(newDir, { recursive: true });
      }
    }

    project.name = newName;
    project.path = absPath;
    this.persist();
    return project;
  }

  get(name: string): ISeedProject | null {
    return this.registry.projects.find((p) => p.name === name) ?? null;
  }

  list(): ISeedProject[] {
    return [...this.registry.projects];
  }

  getConfigPath(name: string): string | null {
    const project = this.get(name);
    if (!project) return null;
    return path.join(project.path, 'omnitron.config.ts');
  }

  getWorkspaceDir(name: string): string {
    return path.join(PROJECTS_DIR, name);
  }

  /**
   * Persist current in-memory state to disk.
   * Called by ProjectService when updating enabledStacks etc.
   */
  persist(): void {
    this.save();
  }

  // ===========================================================================
  // Auto-detect: if CWD has omnitron.config.ts, register it
  // ===========================================================================

  autoDetect(cwd: string = process.cwd()): ISeedProject | null {
    const configPath = path.join(cwd, 'omnitron.config.ts');
    if (!fs.existsSync(configPath)) return null;

    const existing = this.registry.projects.find((p) => p.path === cwd);
    if (existing) return existing;

    const name = path.basename(cwd);
    try {
      return this.add(name, cwd);
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private load(): IProjectRegistry {
    try {
      if (fs.existsSync(REGISTRY_FILE)) {
        const raw = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8'));
        // Migration: strip deprecated fields
        return {
          projects: (raw.projects ?? []).map((p: any) => ({
            name: p.name,
            path: p.path,
            registeredAt: p.registeredAt,
            enabledStacks: p.enabledStacks,
          })),
        };
      }
    } catch {
      // Corrupted — start fresh
    }
    return { projects: [] };
  }

  private save(): void {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(this.registry, null, 2), 'utf-8');
  }
}
