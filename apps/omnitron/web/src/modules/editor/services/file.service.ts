/**
 * File Service
 *
 * Handles file operations for the code editor
 */

import { Injectable } from '@omnitron-dev/aether/di';
import { signal } from '@omnitron-dev/aether';

export interface EditorFile {
  id: string;
  name: string;
  language: string;
  content: string;
  path: string;
  isDirty?: boolean;
}

export interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  path: string;
  language?: string;
  children?: FileNode[];
}

/**
 * File Service for managing editor files
 */
@Injectable({ scope: 'module' })
export class FileService {
  private files = signal<EditorFile[]>([]);
  private activeFileId = signal<string | null>(null);
  private fileTree = signal<FileNode[]>([]);

  /**
   * Get all files
   */
  getFiles(): EditorFile[] {
    return this.files();
  }

  /**
   * Get active file ID
   */
  getActiveFileId(): string | null {
    return this.activeFileId();
  }

  /**
   * Get active file
   */
  getActiveFile(): EditorFile | null {
    const id = this.activeFileId();
    if (!id) return null;
    return this.files().find((f) => f.id === id) ?? null;
  }

  /**
   * Get file by ID
   */
  getFile(id: string): EditorFile | undefined {
    return this.files().find((f) => f.id === id);
  }

  /**
   * Set active file
   */
  setActiveFile(id: string): void {
    const file = this.getFile(id);
    if (file) {
      this.activeFileId.set(id);
    }
  }

  /**
   * Get file tree
   */
  getFileTree(): FileNode[] {
    return this.fileTree();
  }

  /**
   * Build file tree from flat file list
   */
  private buildFileTree(): FileNode[] {
    const tree: FileNode[] = [];
    const pathMap = new Map<string, FileNode>();

    // Create root folders first
    const folders = new Set<string>();
    this.files().forEach((file) => {
      const parts = file.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const folderPath = parts.slice(0, i).join('/');
        folders.add(folderPath);
      }
    });

    // Create folder nodes
    Array.from(folders)
      .sort()
      .forEach((folderPath) => {
        const parts = folderPath.split('/').filter(Boolean);
        const folderName = parts[parts.length - 1];
        const parentPath = parts.slice(0, -1).join('/');

        const folderNode: FileNode = {
          id: `folder-${folderPath}`,
          name: folderName,
          type: 'folder',
          path: folderPath,
          children: [],
        };

        pathMap.set(folderPath, folderNode);

        if (parentPath && pathMap.has(parentPath)) {
          pathMap.get(parentPath)!.children!.push(folderNode);
        } else {
          tree.push(folderNode);
        }
      });

    // Add file nodes
    this.files().forEach((file) => {
      const parts = file.path.split('/').filter(Boolean);
      const parentPath = parts.slice(0, -1).join('/');

      const fileNode: FileNode = {
        id: file.id,
        name: file.name,
        type: 'file',
        path: file.path,
        language: file.language,
      };

      if (parentPath && pathMap.has(parentPath)) {
        pathMap.get(parentPath)!.children!.push(fileNode);
      } else {
        tree.push(fileNode);
      }
    });

    return tree;
  }

  /**
   * Update file tree
   */
  private updateFileTree(): void {
    this.fileTree.set(this.buildFileTree());
  }

  /**
   * Create a new file
   */
  createFile(name?: string, language = 'plaintext', content = '', path?: string): EditorFile {
    const fileName = name ?? `untitled-${this.files().length + 1}.txt`;
    const filePath = path ? `${path}/${fileName}` : `/${fileName}`;

    const newFile: EditorFile = {
      id: Date.now().toString(),
      name: fileName,
      language,
      content,
      path: filePath,
      isDirty: false,
    };

    this.files.update((files) => [...files, newFile]);
    this.updateFileTree();
    this.setActiveFile(newFile.id);

    console.log(`[FileService] Created file: ${fileName} at ${filePath}`);
    return newFile;
  }

  /**
   * Create a new folder
   */
  createFolder(name: string, parentPath = ''): void {
    const folderPath = parentPath ? `${parentPath}/${name}` : `/${name}`;
    console.log(`[FileService] Created folder: ${folderPath}`);
    this.updateFileTree();
  }

  /**
   * Rename a file
   */
  renameFile(id: string, newName: string): void {
    const file = this.getFile(id);
    if (file) {
      const pathParts = file.path.split('/');
      pathParts[pathParts.length - 1] = newName;
      const newPath = pathParts.join('/');

      this.files.update((files) => files.map((f) => (f.id === id ? { ...f, name: newName, path: newPath } : f)));
      this.updateFileTree();
      console.log(`[FileService] Renamed file: ${file.name} → ${newName}`);
    }
  }

  /**
   * Update file content
   */
  updateFileContent(id: string, content: string): void {
    this.files.update((files) => files.map((f) => (f.id === id ? { ...f, content, isDirty: true } : f)));
  }

  /**
   * Save file
   */
  saveFile(id: string): void {
    const file = this.getFile(id);
    if (file) {
      this.files.update((files) => files.map((f) => (f.id === id ? { ...f, isDirty: false } : f)));
      console.log(`[FileService] Saved file: ${file.name}`);
    }
  }

  /**
   * Delete file
   */
  deleteFile(id: string): void {
    const file = this.getFile(id);
    if (file) {
      this.files.update((files) => files.filter((f) => f.id !== id));
      this.updateFileTree();

      // If deleted file was active, select another file
      if (this.activeFileId() === id) {
        const remaining = this.files();
        if (remaining.length > 0) {
          this.setActiveFile(remaining[0].id);
        } else {
          this.activeFileId.set(null);
        }
      }

      console.log(`[FileService] Deleted file: ${file.name}`);
    }
  }

  /**
   * Load sample files (for demo purposes)
   */
  loadSampleFiles(): void {
    const samples: EditorFile[] = [
      {
        id: '1',
        name: 'index.ts',
        language: 'typescript',
        path: '/src/index.ts',
        content: 'export default function main() {\n  console.log("Hello, Omnitron!");\n}',
        isDirty: false,
      },
      {
        id: '2',
        name: 'App.tsx',
        language: 'tsx',
        path: '/src/components/App.tsx',
        content:
          'import { defineComponent } from "@omnitron-dev/aether";\n\nexport const App = defineComponent(() => {\n  return () => <div>App</div>;\n});',
        isDirty: false,
      },
      {
        id: '3',
        name: 'Button.tsx',
        language: 'tsx',
        path: '/src/components/Button.tsx',
        content:
          'import { defineComponent } from "@omnitron-dev/aether";\n\nexport const Button = defineComponent(() => {\n  return () => <button>Click me</button>;\n});',
        isDirty: false,
      },
      {
        id: '4',
        name: 'styles.css',
        language: 'css',
        path: '/src/styles/styles.css',
        content: '.container {\n  display: flex;\n  gap: 1rem;\n}',
        isDirty: false,
      },
      {
        id: '5',
        name: 'README.md',
        language: 'markdown',
        path: '/README.md',
        content: '# Omnitron Project\n\nWelcome to Omnitron!',
        isDirty: false,
      },
    ];

    this.files.set(samples);
    this.updateFileTree();

    if (samples.length > 0) {
      this.setActiveFile(samples[0].id);
    }

    console.log('[FileService] Loaded sample files');
  }

  /**
   * Check if any files have unsaved changes
   */
  hasUnsavedChanges(): boolean {
    return this.files().some((f) => f.isDirty);
  }

  /**
   * Clear all files
   */
  clear(): void {
    this.files.set([]);
    this.fileTree.set([]);
    this.activeFileId.set(null);
    console.log('[FileService] Cleared all files');
  }
}
